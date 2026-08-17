// Push the 71 recurring-generated Aug invoices (BI2026080117-0187) to Xero as DRAFTs via app2.
// Idempotent: pre-checks InvoiceNumbers. Validates account codes + totals before pushing.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const XERO_API = "https://api.xero.com/api.xro/2.0";
const DRY = process.argv.includes("--dry");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const XT2_FILE = __dirname + "/_xero2-tokens.json";
async function tokens() {
  const t = JSON.parse(fs.readFileSync(XT2_FILE, "utf8"));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return { at: t.accessToken, tid: t.tenantId };
  const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }) });
  if (!res.ok) throw new Error(`app2 refresh ${res.status}: ${await res.text()}`);
  const n: any = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
  return { at: upd.accessToken, tid: upd.tenantId };
}
let TK: any;
async function xero(method: string, path: string, body?: any) {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try { res = await fetch(`${XERO_API}${path}`, { method, headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) {
      const w = parseInt(res.headers.get("Retry-After") || "60", 10);
      if (w > 600) throw new Error(`DAILY_CAP:${w}`); // tenant cap — abort, rerun after reset (idempotent)
      console.log(`  ⏸ 429 ${w}s`); await sleep(w * 1000); continue;
    }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    return json;
  }
  throw new Error("gave up");
}

(async () => {
  TK = await tokens();

  // -- valid Xero account codes + 9% output tax type
  const accts = await xero("GET", "/Accounts");
  const validCodes = new Set((accts.Accounts || []).filter((a: any) => a.Status === "ACTIVE").map((a: any) => a.Code).filter(Boolean));
  const taxRates = await xero("GET", "/TaxRates");
  const out9 = (taxRates.TaxRates || []).find((r: any) => r.TaxType === "TAX001" && Math.abs(r.EffectiveRate - 9) < 0.001);
  const OUTPUT_TAX = out9 ? "TAX001" : (taxRates.TaxRates || []).find((r: any) => Math.abs(r.EffectiveRate - 9) < 0.001 && /output|sales/i.test(r.Name))?.TaxType;
  if (!OUTPUT_TAX) throw new Error("no 9% output TaxType found");
  console.log(`output tax type: ${OUTPUT_TAX}; ${validCodes.size} active account codes`);

  // -- load the 71 docs + customers
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") }, name: { startsWith: "BI20260801" } }, orderBy: { name: "asc" } });
  const custIds = [...new Set(docs.map(d => (d.config as any)?.customerId).filter(Boolean))] as string[];
  const custs = await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true, xeroId: true } });
  const custById = new Map(custs.map(c => [c.id, c]));

  // -- idempotency: which numbers already exist in Xero?
  const existing = new Set<string>();
  for (let i = 0; i < docs.length; i += 40) {
    const nums = docs.slice(i, i + 40).map(d => d.name).join(",");
    const r = await xero("GET", `/Invoices?InvoiceNumbers=${encodeURIComponent(nums)}&summaryOnly=true`);
    for (const inv of r.Invoices || []) existing.add(inv.InvoiceNumber);
  }
  console.log(`${existing.size} of ${docs.length} already in Xero (will skip)`);

  // -- build + validate payloads
  const payloads: any[] = [];
  const skipped: string[] = [];
  for (const d of docs) {
    if (existing.has(d.name!)) continue;
    const c: any = d.config;
    const cust = custById.get(c.customerId);
    const probs: string[] = [];
    if (!cust?.xeroId) probs.push("no xero contact");
    const items: any[] = c.items || [];
    const amtLines = items.filter(it => (Number(it.amount) || 0) !== 0 || (Number(it.unitPrice) || 0) !== 0);
    if (!amtLines.length) probs.push("no amount lines");
    for (const it of amtLines) if (!it.accountCode) probs.push(`line missing accountCode: "${(it.description || "").slice(0, 40)}"`);
    for (const it of amtLines) if (it.accountCode && !validCodes.has(it.accountCode)) probs.push(`account ${it.accountCode} not active in Xero`);
    const sum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    if (Math.abs(sum - (c.subTotal ?? sum)) > 0.02) probs.push(`line sum ${sum} != subTotal ${c.subTotal}`);
    if (Math.abs((c.subTotal + c.gstAmount) - c.nettTotal) > 0.02) probs.push(`sub+gst != nett`);
    if (probs.length) { skipped.push(`${d.name}: ${probs.join("; ")}`); continue; }

    const LineItems = items.map(it => {
      const amt = Number(it.amount) || 0;
      const qty = Number(it.quantity) || 1;
      if (amt === 0 && !(Number(it.unitPrice) || 0)) return { Description: it.description || " " };
      const taxed = (Number(it.tax) || 0) > 0 || (Number(it.taxAmount) || 0) > 0;
      return {
        Description: it.description || " ",
        Quantity: qty,
        UnitAmount: Number(it.unitPrice) || amt / qty,
        AccountCode: it.accountCode,
        TaxType: taxed ? OUTPUT_TAX : "NONE",
        ...(Number(it.discount) > 0 ? { DiscountRate: Number(it.discount) } : {}),
      };
    });
    payloads.push({
      _docId: d.id, _nett: c.nettTotal,
      Type: "ACCREC",
      Contact: { ContactID: cust!.xeroId },
      InvoiceNumber: d.name,
      Reference: (c.reference || "").slice(0, 255),
      Date: (typeof c.date === "string" ? c.date : "2026-08-10").slice(0, 10),
      DueDate: "2026-08-31",
      Status: "DRAFT",
      LineAmountTypes: "Exclusive",
      CurrencyCode: c.currency || "SGD",
      LineItems,
    });
  }
  console.log(`\n${payloads.length} to push, ${skipped.length} validation-skipped`);
  for (const s of skipped) console.log("  ✗ SKIP", s);
  if (DRY) {
    for (const p of payloads.slice(0, 3)) console.log(JSON.stringify(p, null, 1).slice(0, 1200));
    console.log("[DRY] no push"); process.exit(0);
  }

  // -- push in batches of 20
  let ok = 0, fail = 0;
  for (let i = 0; i < payloads.length; i += 20) {
    const batch = payloads.slice(i, i + 20);
    const clean = batch.map(({ _docId, _nett, ...rest }) => rest);
    const r = await xero("POST", "/Invoices?SummarizeErrors=false", { Invoices: clean });
    for (let k = 0; k < (r.Invoices || []).length; k++) {
      const res = r.Invoices[k]; const src = batch[k];
      if (res.ValidationErrors?.length || res.HasErrors) {
        fail++; console.log(`  ✗ ${src.InvoiceNumber}: ${(res.ValidationErrors || []).map((e: any) => e.Message).join("; ").slice(0, 200)}`);
        continue;
      }
      ok++;
      const warn = Math.abs((res.Total ?? 0) - src._nett) > 0.02 ? `  ⚠ total ${res.Total} vs AIMS ${src._nett}` : "";
      console.log(`  ✓ ${src.InvoiceNumber} $${res.Total} DRAFT${warn}`);
      const doc = await prisma.document.findUnique({ where: { id: src._docId } });
      const cfg: any = doc!.config;
      await prisma.document.update({ where: { id: src._docId }, data: { config: { ...cfg, xeroInvoiceId: res.InvoiceID, xeroInvoiceNumber: res.InvoiceNumber, xeroStatus: "DRAFT", xeroGross: res.Total, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: "app2-recurring-push" } } });
    }
    console.log(`batch ${i / 20 + 1}: ${ok} ok, ${fail} failed so far`);
  }
  console.log(`\nDONE: ${ok} pushed as DRAFT, ${fail} failed, ${skipped.length} validation-skipped`);
  process.exit(0);
})().catch(e => {
  if (String(e?.message).startsWith("DAILY_CAP:")) {
    console.error(`\n⛔ Xero daily cap still active (retry-after ${e.message.split(":")[1]}s). Re-run after reset — script is idempotent.`);
  } else console.error("FATAL", e?.message || e);
  process.exit(1);
});
