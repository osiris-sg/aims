// Push pending AIMS changes to the 70 Xero drafts: new invoice numbers (strict
// A-Z layout) + individualized line items. Skips non-DRAFT invoices. Idempotent.
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
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push" && (d.config as any)?.xeroStatus !== "AUTHORISED");
  console.log(`${ours.length} drafts to sync (authorised 009 excluded)`);
  // status pre-check
  const statusById = new Map<string, any>();
  for (let i = 0; i < ours.length; i += 40) {
    const ids = ours.slice(i, i + 40).map(d => (d.config as any).xeroInvoiceId).join(",");
    const r = await xero("GET", `/Invoices?IDs=${ids}&summaryOnly=true`);
    for (const inv of r.Invoices || []) statusById.set(inv.InvoiceID, inv);
    await sleep(1100);
  }
  let ok = 0, skip = 0, fail = 0;
  for (const d of ours) {
    const c: any = d.config;
    const live = statusById.get(c.xeroInvoiceId);
    if (!live) { console.log(`  ✗ ${d.name}: not found in Xero`); fail++; continue; }
    if (live.Status !== "DRAFT") { console.log(`  ⚠ ${d.name}: Xero status ${live.Status} — skipped`); skip++; continue; }
    const needsNumber = live.InvoiceNumber !== d.name;
    const LineItems = (c.items || []).map((it: any) => {
      const amt = Number(it.amount) || 0;
      if (amt === 0 && !(Number(it.unitPrice) || 0)) return { Description: it.description || " " };
      return {
        Description: it.description || " ",
        Quantity: Number(it.quantity) || 1,
        UnitAmount: Number(it.unitPrice) || amt,
        AccountCode: it.accountCode,
        TaxType: (Number(it.tax) || 0) > 0 ? "TAX001" : "NONE",
      };
    });
    if (DRY) { console.log(`  [DRY] ${live.InvoiceNumber} → ${d.name}, ${LineItems.length} lines`); ok++; continue; }
    try {
      const r = await xero("POST", `/Invoices/${c.xeroInvoiceId}`, { InvoiceNumber: d.name, LineAmountTypes: "Exclusive", LineItems });
      const inv = r.Invoices?.[0];
      const totalOk = Math.abs((inv?.Total ?? 0) - c.nettTotal) <= 0.02;
      if (inv?.InvoiceNumber === d.name && totalOk) {
        ok++;
        const { pendingXeroRenumber, ...rest } = c;
        await prisma.document.update({ where: { id: d.id }, data: { config: { ...rest, xeroInvoiceNumber: d.name, xeroGross: inv.Total } } });
        console.log(`  ✓ ${needsNumber ? live.InvoiceNumber + " → " : ""}${d.name} $${inv.Total} (${LineItems.length} lines)`);
      } else { fail++; console.log(`  ✗ ${d.name}: got ${inv?.InvoiceNumber} $${inv?.Total} vs AIMS $${c.nettTotal}`); }
    } catch (e: any) { fail++; console.log(`  ✗ ${d.name}: ${String(e?.message).slice(0, 150)}`); }
    await sleep(1100);
  }
  console.log(`\nDONE: ${ok} synced, ${skip} skipped (non-draft), ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
