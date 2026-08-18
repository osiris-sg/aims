// Push the 3 Heimen soil-disposal invoices (17 Aug) to Xero as DRAFTs via app2.
// Disposal coding: acct 202, TAX001 9%. Cleans editor-leaked HTML from
// descriptions (both in the Xero payload AND back into AIMS).
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
const NAMES = ["BIPL-JPSG-INV-20260817-0071", "BIPL-JPSG-INV-20260817-0072", "BIPL-JPSG-INV-20260817-0075"];
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
    if (res.status === 429) { const w = parseInt(res.headers.get("Retry-After") || "60", 10); if (w > 600) throw new Error(`DAILY_CAP:${w}`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
  throw new Error("gave up");
}
const cleanHtml = (s: string) => (s || "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<div>/gi, "\n").replace(/<\/div>/gi, "")
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();
(async () => {
  TK = await tokens();
  // idempotency
  const pre = await xero("GET", `/Invoices?InvoiceNumbers=${encodeURIComponent(NAMES.join(","))}&summaryOnly=true`);
  const existing = new Set((pre.Invoices || []).map((i: any) => i.InvoiceNumber));
  for (const name of NAMES) {
    if (existing.has(name)) { console.log(`= ${name} already in Xero — skipped`); continue; }
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name } });
    const c: any = d!.config;
    const cust = await prisma.customer.findUnique({ where: { id: c.customerId || c.customer?.id }, select: { name: true, xeroId: true } });
    // clean HTML in AIMS items
    let dirty = false;
    const items = (c.items || []).map((it: any) => {
      const cleaned = cleanHtml(it.description || "");
      if (cleaned !== (it.description || "").trim()) dirty = true;
      return { ...it, description: cleaned };
    });
    const LineItems = items.map((it: any) => {
      const amt = Number(it.amount) || 0;
      if (!amt && !(Number(it.unitPrice) || 0)) return { Description: it.description || " " };
      return { Description: it.description || " ", Quantity: Number(it.quantity) || 1, UnitAmount: Number(it.unitPrice) || amt, AccountCode: it.accountCode || "202", TaxType: "TAX001" };
    });
    const payload = {
      Type: "ACCREC", Contact: { ContactID: cust!.xeroId }, InvoiceNumber: name,
      Reference: (c.reference || c.referenceNo || "").slice(0, 255),
      Date: (c.date || "2026-08-17").slice(0, 10), DueDate: (c.dueDate || c.date || "2026-08-17").slice(0, 10),
      Status: "DRAFT", LineAmountTypes: "Exclusive", CurrencyCode: c.currency || "SGD", LineItems,
    };
    if (DRY) { console.log(`[DRY] ${name} → ${LineItems.length} lines, expect total ${c.nettTotal}`); continue; }
    const r = await xero("POST", "/Invoices?SummarizeErrors=false", { Invoices: [payload] });
    const inv = r.Invoices?.[0];
    if (inv?.ValidationErrors?.length) { console.log(`✗ ${name}: ${inv.ValidationErrors.map((e: any) => e.Message).join("; ")}`); continue; }
    const ok = Math.abs((inv.Total ?? 0) - c.nettTotal) <= 0.02;
    console.log(`${ok ? "✓" : "⚠"} ${name} → Xero DRAFT $${inv.Total} (AIMS $${c.nettTotal})${ok ? "" : " TOTAL MISMATCH"}`);
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, items, xeroInvoiceId: inv.InvoiceID, xeroInvoiceNumber: name, xeroStatus: "DRAFT", xeroGross: inv.Total, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: "app2-jpsg-push" } } });
    if (dirty) console.log(`  (cleaned editor HTML from descriptions in AIMS too)`);
    await sleep(1200);
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
