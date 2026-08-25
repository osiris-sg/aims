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
  // all AIMS rows for Debenho
  const rows = await prisma.customer.findMany({ where: { organizationId: ORG, name: { contains: "Debenho" } }, select: { id: true, name: true, address: true, xeroId: true } });
  console.log(`AIMS rows: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.id.slice(0, 8)} "${r.name}" xeroId=${(r as any).xeroId?.slice(0, 8) || "—"} address=${JSON.stringify((r as any).address)?.slice(0, 80)}`);
  // Xero contact
  const TK = await tokens();
  const full = rows.find(r => (r as any).xeroId);
  const resp = await fetch(`https://api.xero.com/api.xro/2.0/Contacts/${(full as any).xeroId}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
  const j: any = await resp.json();
  const c = j.Contacts?.[0];
  console.log(`\nXero contact "${c?.Name}": ${(c?.Addresses || []).length} addresses`);
  for (const a of c?.Addresses || []) console.log(` `, JSON.stringify(a));
  process.exit(0);
})();
