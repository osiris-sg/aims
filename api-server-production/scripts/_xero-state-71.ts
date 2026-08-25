// Live Xero state of all 71: what's authorised (and its number), what's still
// draft, what numbers/letter codes she's assigned. Grouped for the renumber plan.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const XT2_FILE = __dirname + "/_xero2-tokens.json";
async function tokens() {
  const t = JSON.parse(fs.readFileSync(XT2_FILE, "utf8"));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return { at: t.accessToken, tid: t.tenantId };
  const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }) });
  const n: any = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
  return { at: upd.accessToken, tid: upd.tenantId };
}
(async () => {
  const TK = await tokens();
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, select: { name: true, config: true }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  const custIds = [...new Set(ours.map(d => (d.config as any).customerId).filter(Boolean))] as string[];
  const custs = await prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } });
  const custById = new Map(custs.map(c => [c.id, c.name]));
  const out: any[] = [];
  for (let i = 0; i < ours.length; i += 40) {
    const chunk = ours.slice(i, i + 40);
    const ids = chunk.map(d => (d.config as any).xeroInvoiceId).join(",");
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?IDs=${ids}&summaryOnly=true`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await r.json();
    const byId = new Map((j.Invoices || []).map((x: any) => [x.InvoiceID, x]));
    for (const d of chunk) {
      const c: any = d.config;
      const live: any = byId.get(c.xeroInvoiceId);
      out.push({ aims: d.name, cust: (custById.get(c.customerId) || "?").slice(0, 32), xero: live?.InvoiceNumber, status: live?.Status, total: live?.Total });
    }
    await sleep(1100);
  }
  const auth = out.filter(o => o.status === "AUTHORISED").sort((a, b) => (a.xero || "").localeCompare(b.xero || ""));
  const draft = out.filter(o => o.status === "DRAFT").sort((a, b) => (a.xero || "").localeCompare(b.xero || ""));
  console.log(`AUTHORISED in Xero: ${auth.length}`);
  for (const o of auth) console.log(`  Xero ${String(o.xero).padEnd(16)} ← AIMS ${o.aims} · ${o.cust} · $${o.total}`);
  console.log(`\nStill DRAFT in Xero: ${draft.length}`);
  for (const o of draft) console.log(`  Xero ${String(o.xero).padEnd(16)} ← AIMS ${o.aims} · ${o.cust} · $${o.total}`);
  // all BI202608 numeric numbers used in Xero (any doc, any status except deleted)
  const used = new Set<number>();
  for (let n = 1; n <= 260; n += 40) {
    const nums = Array.from({ length: 40 }, (_, k) => `BI202608${String(n + k).padStart(3, "0")}`).filter(x => n <= 260).join(",");
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=${encodeURIComponent(nums)}&summaryOnly=true`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await r.json();
    for (const inv of j.Invoices || []) { const m = /^BI202608(\d{3})$/.exec(inv.InvoiceNumber); if (m && inv.Status !== "DELETED") used.add(parseInt(m[1], 10)); }
    await sleep(1100);
  }
  console.log(`\nnumeric BI202608NNN used in Xero: ${[...used].sort((a, b) => a - b).join(",")}`);
  console.log(`highest: ${Math.max(...used)}`);
  process.exit(0);
})();
