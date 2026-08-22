// Push the 22 AIMS-confirmed Jurong Port docs to Xero as AUTHORISED via app2.
// 20 bills → ACCPAY invoices; 2 credit notes (name ends CN) → ACCPAYCREDIT.
// Line coding mirrors each doc's local journal exactly (acct + GST split).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const XT2_FILE = __dirname + "/_xero2-tokens.json";
async function tokens() {
  const t = JSON.parse(fs.readFileSync(XT2_FILE, "utf8"));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return { at: t.accessToken, tid: t.tenantId };
  const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`);
  const n: any = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
  return { at: upd.accessToken, tid: upd.tenantId };
}
let TK: any;
async function xero(method: string, path: string, body?: any) {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try { res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { method, headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get("Retry-After") || "60", 10); if (w > 600) throw new Error(`DAILY_CAP:${w}`); console.log(`  ⏸ 429 ${w}s`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
  throw new Error("gave up");
}
(async () => {
  TK = await tokens();
  const live = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, status: "POSTED", OR: [{ postedBy: null }, { NOT: { postedBy: "xero-import" } }], sourceDocumentId: { not: null } },
    select: { sourceDocumentId: true, lines: { select: { debit: true, credit: true, account: { select: { code: true } } } } },
  } as any);
  const jeByDoc = new Map((live as any[]).map(j => [j.sourceDocumentId, j]));
  const docs = await prisma.document.findMany({ where: { id: { in: [...jeByDoc.keys()] as string[] } } });
  const toPush = docs.filter(d => { const c: any = d.config; return !c.xeroBillId && !c.xeroInvoiceId && !c.xeroCreditNoteId; });
  const sup = await prisma.supplier.findFirst({ where: { organizationId: ORG, name: { contains: "Jurong Port" } }, select: { xeroId: true } as any });
  // idempotency: check existing numbers in Xero (bills + CNs)
  const names = toPush.map(d => d.name!);
  const existing = new Set<string>();
  for (let i = 0; i < names.length; i += 40) {
    const r = await xero("GET", `/Invoices?InvoiceNumbers=${encodeURIComponent(names.slice(i, i + 40).join(","))}&summaryOnly=true`);
    for (const inv of r.Invoices || []) existing.add(inv.InvoiceNumber);
  }
  const cnq = await xero("GET", `/CreditNotes?where=${encodeURIComponent('Type=="ACCPAYCREDIT"')}&order=Date%20DESC&page=1`);
  for (const cn of cnq.CreditNotes || []) existing.add(cn.CreditNoteNumber);

  let ok = 0, fail = 0, skip = 0;
  for (const d of toPush.sort((a, b) => a.name!.localeCompare(b.name!))) {
    const c: any = d.config;
    if (existing.has(d.name!)) { console.log(`= ${d.name} already in Xero`); skip++; continue; }
    const je: any = jeByDoc.get(d.id);
    const isCN = /CN$/.test(d.name!);
    // journal → expense lines (debits for bills, credits for CNs, excluding AP 800 and GST 820)
    const sideLines = je.lines.filter((l: any) => l.account?.code && l.account.code !== "800" && l.account.code !== "820");
    const gstLine = je.lines.find((l: any) => l.account?.code === "820");
    const gst = gstLine ? Math.abs(Number(gstLine.debit) - Number(gstLine.credit)) : 0;
    const LineItems = sideLines.map((l: any) => {
      const amt = Math.abs(Number(l.debit) - Number(l.credit));
      return { Description: (c.description || c.items?.[0]?.description || d.name).slice(0, 500), Quantity: 1, UnitAmount: amt, AccountCode: l.account.code, TaxType: gst > 0 ? "TAX002" : "NONE" };
    });
    // TAX002 = 9% input tax? verify below in dry run; fall back NONE + explicit gross if unsure
    const net = LineItems.reduce((s: number, l: any) => s + l.UnitAmount, 0);
    const total = Number(c.totalAmount) || net + gst;
    const payload: any = isCN
      ? { Type: "ACCPAYCREDIT", Contact: { ContactID: (sup as any).xeroId }, CreditNoteNumber: d.name, Date: c.billDate || c.date, Status: "AUTHORISED", LineAmountTypes: "Exclusive", CurrencyCode: "SGD", LineItems }
      : { Type: "ACCPAY", Contact: { ContactID: (sup as any).xeroId }, InvoiceNumber: d.name, Date: c.billDate || c.date, DueDate: c.dueDate || c.billDate || c.date, Status: "AUTHORISED", LineAmountTypes: "Exclusive", CurrencyCode: "SGD", LineItems };
    if (DRY) { console.log(`[DRY] ${d.name} ${isCN ? "CN" : "BILL"}: net=${net.toFixed(2)} gst=${gst.toFixed(2)} total=${total} accts=${[...new Set(LineItems.map((l: any) => l.AccountCode))].join(",")}`); continue; }
    try {
      const r = await xero("POST", isCN ? "/CreditNotes?SummarizeErrors=false" : "/Invoices?SummarizeErrors=false", isCN ? { CreditNotes: [payload] } : { Invoices: [payload] });
      const res = isCN ? r.CreditNotes?.[0] : r.Invoices?.[0];
      if (res?.ValidationErrors?.length) { console.log(`✗ ${d.name}: ${res.ValidationErrors.map((e: any) => e.Message).join("; ").slice(0, 150)}`); fail++; continue; }
      const match = Math.abs((res.Total ?? 0) - total) <= 0.02;
      console.log(`${match ? "✓" : "⚠"} ${d.name} → ${isCN ? "CN" : "BILL"} AUTHORISED $${res.Total} (AIMS $${total})`);
      ok++;
      const idField = isCN ? { xeroCreditNoteId: res.CreditNoteID } : { xeroBillId: res.InvoiceID };
      await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, ...idField, xeroStatus: "AUTHORISED", xeroGross: res.Total, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: "app2-jp-batch" } } });
      await sleep(1200);
    } catch (e: any) { console.log(`✗ ${d.name}: ${String(e?.message).slice(0, 150)}`); fail++; }
  }
  console.log(`\nDONE: ${ok} pushed, ${skip} already-in-Xero, ${fail} failed`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
