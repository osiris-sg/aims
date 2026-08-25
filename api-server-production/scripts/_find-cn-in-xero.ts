import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
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
  // ALL ACCREC credit notes recent first
  const r = await fetch(`https://api.xero.com/api.xro/2.0/CreditNotes?where=${encodeURIComponent('Type=="ACCRECCREDIT"')}&order=UpdatedDateUTC%20DESC&page=1`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
  const j: any = await r.json();
  console.log("most recent ACCREC credit notes in Xero:");
  for (const cn of (j.CreditNotes || []).slice(0, 12)) console.log(`  ${cn.CreditNoteNumber} [${cn.Status}] $${cn.Total} · ${cn.Contact?.Name?.slice(0, 30)} · date=${cn.DateString?.slice(0, 10)}`);
  // any doc history: our other CN pushes?
  const cns = await prisma.document.findMany({ where: { organizationId: ORG, type: "CREDIT_NOTE", createdAt: { gte: new Date("2026-08-01") } }, select: { name: true, status: true, config: true } });
  console.log("\nAIMS credit notes since 1 Aug:");
  for (const d of cns) { const c: any = d.config; console.log(`  ${d.name} [${d.status}] $${c.nettTotal} xeroId=${c.xeroCreditNoteId ? "✓" : "—"} syncedBy=${c.xeroSyncedBy || "—"} imported=${!!c.xeroImported}`); }
  process.exit(0);
})();
