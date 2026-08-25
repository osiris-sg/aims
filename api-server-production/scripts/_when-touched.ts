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
  const rows: any[] = [];
  for (let i = 0; i < ours.length; i += 40) {
    const ids = ours.slice(i, i + 40).map(d => (d.config as any).xeroInvoiceId).join(",");
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?IDs=${ids}&summaryOnly=true`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await r.json();
    for (const inv of j.Invoices || []) {
      const ms = parseInt(/\/Date\((\d+)/.exec(inv.UpdatedDateUTC)?.[1] || "0", 10);
      rows.push({ num: inv.InvoiceNumber, status: inv.Status, updated: new Date(ms) });
    }
    await sleep(1100);
  }
  rows.sort((a, b) => a.updated.getTime() - b.updated.getTime());
  const byDay: Record<string, number> = {};
  for (const r of rows) { const d = r.updated.toISOString().slice(0, 10); byDay[d] = (byDay[d] || 0) + 1; }
  console.log("updates by day (UTC):", JSON.stringify(byDay));
  const cutoff = new Date("2026-08-14T06:00:00Z");
  const hers = rows.filter(r => r.updated > cutoff);
  console.log(`\ntouched AFTER our last write (14 Aug): ${hers.length}`);
  for (const r of hers) console.log(`  ${r.updated.toISOString().replace("T", " ").slice(0, 16)}Z · ${r.num} [${r.status}]`);
  process.exit(0);
})();
