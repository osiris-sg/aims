// Push the 2 AIMS-confirmed TI2 bills to Xero as AUTHORISED (guru 2026-08-19:
// AIMS approval carries the authority — no second draft review in Xero).
// Lines mirror config.lines with accountId→code resolution; no GST.
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
const NAMES = ["TI2202607-004", "TI2202607-006"];
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
(async () => {
  const TK = await tokens();
  const xero = async (method: string, path: string, body?: any) => {
    const res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { method, headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(j).slice(0, 400)}`);
    return j;
  };
  // idempotency
  const pre = await xero("GET", `/Invoices?InvoiceNumbers=${encodeURIComponent(NAMES.join(","))}&summaryOnly=true`);
  const existing = new Set((pre.Invoices || []).map((i: any) => i.InvoiceNumber));
  for (const name of NAMES) {
    if (existing.has(name)) { console.log(`= ${name} already in Xero — skipped`); continue; }
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "BILL", name } });
    const c: any = d!.config;
    const sup = await prisma.supplier.findUnique({ where: { id: c.supplierId }, select: { name: true, xeroId: true } as any });
    const acctIds = [...new Set((c.lines || []).map((l: any) => l.accountId).filter(Boolean))] as string[];
    const accts = await prisma.chartOfAccount.findMany({ where: { id: { in: acctIds } }, select: { id: true, code: true } });
    const codeById = new Map(accts.map(a => [a.id, a.code]));
    const LineItems = (c.lines || []).map((l: any) => ({
      Description: l.description || " ",
      Quantity: Number(l.quantity) || 1,
      UnitAmount: Number(l.unitPrice) || Number(l.amount) || 0,
      AccountCode: codeById.get(l.accountId),
      TaxType: "NONE",
    }));
    const missing = LineItems.filter((l: any) => !l.AccountCode).length;
    if (missing) { console.log(`✗ ${name}: ${missing} lines missing account code — not pushed`); continue; }
    const payload = {
      Type: "ACCPAY", Contact: { ContactID: (sup as any).xeroId }, InvoiceNumber: name,
      Date: c.billDate || "2026-08-03", DueDate: c.dueDate || c.billDate || "2026-08-03",
      Status: "AUTHORISED", LineAmountTypes: "Exclusive", CurrencyCode: c.currency || "SGD", LineItems,
    };
    if (DRY) { console.log(`[DRY] ${name}: ${LineItems.length} lines → AUTHORISED, expect $${c.totalAmount}, accounts ${[...new Set(LineItems.map((l: any) => l.AccountCode))].join(",")}`); continue; }
    const r = await xero("POST", "/Invoices?SummarizeErrors=false", { Invoices: [payload] });
    const inv = r.Invoices?.[0];
    if (inv?.ValidationErrors?.length) { console.log(`✗ ${name}: ${inv.ValidationErrors.map((e: any) => e.Message).join("; ")}`); continue; }
    const ok = Math.abs((inv.Total ?? 0) - c.totalAmount) <= 0.02;
    console.log(`${ok ? "✓" : "⚠"} ${name} → Xero AUTHORISED $${inv.Total} (AIMS $${c.totalAmount})`);
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, xeroBillId: inv.InvoiceID, xeroStatus: "AUTHORISED", xeroGross: inv.Total, xeroBalance: inv.AmountDue, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: "app2-ti2-push" } } });
    await sleep(1200);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
