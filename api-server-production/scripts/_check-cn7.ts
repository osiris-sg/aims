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
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "CREDIT_NOTE", name: "CN202608-0007" }, select: { status: true, config: true } });
  const c: any = d!.config;
  console.log(`AIMS: [${d!.status}] xeroCreditNoteId=${c.xeroCreditNoteId} syncedBy=${c.xeroSyncedBy} nett=${c.nettTotal} appliesTo=${(c.reference || "").slice(0, 60)}`);
  const r = await fetch(`https://api.xero.com/api.xro/2.0/CreditNotes/${c.xeroCreditNoteId}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
  const j: any = await r.json().catch(() => ({}));
  const cn = j.CreditNotes?.[0];
  console.log(`Xero /CreditNotes by ID: ${r.status} → ${cn ? `${cn.CreditNoteNumber} [${cn.Status}] $${cn.Total} remaining=$${cn.RemainingCredit} allocated=${(cn.Allocations || []).length}` : "NOT FOUND"}`);
  process.exit(0);
})();
