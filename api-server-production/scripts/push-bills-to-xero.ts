/**
 * Push AIMS bills to Xero as DRAFT ACCPAY invoices (guru 2026-09-30).
 *
 * Scope: unconfirmed BILLs with no xeroBillId, EXCLUDING the JP pass
 * applications (named JP########, $20 admin fees) — the accountant asked for
 * Jurong Port and Tenda only.
 *
 * DRAFT deliberately: a Xero draft posts no journal, so this cannot recreate
 * the AIMS-native + Xero-imported double-posting that had to be cleaned up on
 * the AR side. The accountant reviews and approves in Xero.
 *
 * Accounts are NOT inferred — each line already carries an accountId, which is
 * resolved to its code. A line with no account is sent without one for the
 * accountant to complete in Xero rather than guessed at.
 *
 * Idempotent: skips any bill whose name already exists as a Xero ACCPAY.
 * Usage: npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/push-bills-to-xero.ts [--apply] [--only=NAME]
 */
import { createScriptPrisma, getXeroTokens, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const R = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tk: any = await getXeroTokens(prisma, ORG);
  let H = { Authorization: `Bearer ${tk.accessToken}`, "Xero-Tenant-Id": tk.tenantId, Accept: "application/json", "Content-Type": "application/json" };
  const call = async (method: string, path: string, body?: any) => {
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
      if (res.status === 429) { const w = parseInt(res.headers.get("Retry-After") || "60", 10); console.log(`  ⏸ 429 ${w}s`); await sleep(w * 1000); continue; }
      const txt = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${txt.slice(0, 300)}`);
      return txt.trim() ? JSON.parse(txt) : {};
    }
    throw new Error("gave up " + path);
  };

  // existing Xero bills → idempotency
  const existing = new Set<string>();
  for (let page = 1; ; page++) {
    const j: any = await call("GET", `/Invoices?where=${encodeURIComponent('Type=="ACCPAY"')}&page=${page}&summaryOnly=true`);
    const l = j.Invoices || [];
    for (const i of l) if (i.InvoiceNumber) existing.add(i.InvoiceNumber);
    if (l.length < 100) break;
    await sleep(500);
  }
  console.log(`Xero already has ${existing.size} ACCPAY bills`);

  const accounts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true } });
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));
  const suppliers = await prisma.supplier.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, xeroId: true } });
  const supById = new Map(suppliers.map((s) => [s.id, s]));

  const bills = await prisma.document.findMany({
    where: { organizationId: ORG, type: "BILL", status: "unconfirmed" },
    select: { id: true, name: true, config: true },
    orderBy: { name: "asc" },
  });

  let pushed = 0, skipped = 0, blocked = 0, noAcctLines = 0;
  const payloads: any[] = [];
  for (const b of bills) {
    const c: any = b.config || {};
    const name = b.name || "";
    if (ONLY && name !== ONLY) continue;
    if (c.xeroBillId) { skipped++; continue; }
    if (/^JP[0-9]/.test(name)) { skipped++; continue; }          // JP passes — excluded by request
    if (existing.has(name)) { skipped++; continue; }

    const problems: string[] = [];
    const sup = c.supplierId ? supById.get(c.supplierId) : null;
    if (!sup?.xeroId) problems.push("supplier has no Xero contact");
    const date = String(c.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`bad date ${c.date}`);
    if (date > "2027-01-01") problems.push(`date ${date} is in the future — fix before pushing`);
    const items: any[] = Array.isArray(c.items) && c.items.length ? c.items : Array.isArray(c.lines) ? c.lines : [];
    if (!items.length) problems.push("no lines");
    if (problems.length) { blocked++; console.log(`  ✗ ${name}: ${problems.join("; ")}`); continue; }

    // A bill with no tax on it is tax-free regardless of how `amountsAre` is
    // labelled: GB2600000433CN/435CN are EXCLUSIVE but carry taxAmount 0, and
    // applying 9% made Xero read 109.00 against AIMS's 100.00 (guru 2026-09-30).
    const noTax = String(c.amountsAre || "").toUpperCase() === "NO_TAX" || R(c.taxAmount) === 0;
    const LineItems = items.map((it) => {
      const code = it.accountId ? codeById.get(it.accountId) : undefined;
      if (!code) noAcctLines++;
      // `amount` is AUTHORITATIVE — it ties to the bill header's subtotal,
      // while qty x unitPrice does NOT on every line (5 of 151 disagree, e.g.
      // LT2600000878 qty 8 x 400 but amount 12,800). Sending qty x unit would
      // have understated these bills by $60,070.81. So the unit rate is derived
      // from the amount, and LineAmount is sent explicitly so Xero uses the
      // AIMS figure rather than recomputing it.
      const qty = Number(it.quantity) || 1;
      const amount = R(it.amount ?? (Number(it.unitPrice) || 0) * qty);
      return {
        Description: String(it.description || "(no description)").slice(0, 3900),
        Quantity: qty,
        UnitAmount: R(amount / (qty || 1)),
        LineAmount: amount,
        ...(code ? { AccountCode: code } : {}),
        TaxType: noTax ? "NONE" : "INPUTY24",
      };
    });
    payloads.push({
      _name: name,
      Type: "ACCPAY",
      Contact: { ContactID: sup!.xeroId },
      InvoiceNumber: name,
      ...(c.reference || c.referenceNo ? { Reference: String(c.reference || c.referenceNo).slice(0, 255) } : {}),
      Date: date,
      DueDate: String(c.dueDate || c.date || "").slice(0, 10) || date,
      Status: "DRAFT",
      LineAmountTypes: noTax ? "NoTax" : "Exclusive",
      CurrencyCode: c.currency || "SGD",
      LineItems,
    });
  }

  const total = payloads.reduce((t, p) => t + p.LineItems.reduce((s: number, l: any) => s + l.LineAmount, 0), 0);
  console.log(`\n${payloads.length} bill(s) to push · net ${R(total)} · ${noAcctLines} line(s) with no account · blocked ${blocked} · skipped ${skipped}`);
  if (!APPLY) {
    for (const p of payloads.slice(0, 8)) console.log(`  [dry] ${p._name.padEnd(16)} ${p.Date} ${String(p.LineAmountTypes).padEnd(9)} ${p.LineItems.length} line(s)  ${p.LineItems.map((l: any) => l.AccountCode || "—").join(",")}`);
    console.log("[DRY] nothing written");
    process.exit(0);
  }
  for (let i = 0; i < payloads.length; i += 20) {
    const chunk = payloads.slice(i, i + 20).map(({ _name, ...rest }) => rest);
    const res: any = await call("POST", "/Invoices?summarizeErrors=false", { Invoices: chunk });
    for (const inv of res.Invoices || []) {
      if (inv.HasErrors) { blocked++; console.log(`  ✗ ${inv.InvoiceNumber}: ${inv.ValidationErrors?.map((e: any) => e.Message).join(" | ").slice(0, 160)}`); }
      else {
        pushed++;
        const doc = bills.find((b) => b.name === inv.InvoiceNumber);
        if (doc) await prisma.document.update({ where: { id: doc.id }, data: { config: { ...(doc.config as any), xeroBillId: inv.InvoiceID, xeroBillNumber: inv.InvoiceNumber, xeroStatus: inv.Status, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: "push-bills-to-xero" } as any } });
      }
    }
    await sleep(1200);
  }
  console.log(`\nDONE: ${pushed} pushed as DRAFT · ${blocked} failed`);
  process.exit(0);
})().catch((e) => { console.error("FATAL", String(e?.message).slice(0, 300)); process.exit(1); });
