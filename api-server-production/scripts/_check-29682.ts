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
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "BILL", name: "GB2600029682" }, select: { config: true, status: true } });
  const c: any = d!.config;
  console.log(`AIMS: [${d!.status}] billStatus=${c.billStatus} xeroBillId=${c.xeroBillId} xeroStatus=${c.xeroStatus} syncedBy=${c.xeroSyncedBy} total=${c.totalAmount}`);
  // by ID
  if (c.xeroBillId) {
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${c.xeroBillId}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await r.json().catch(() => ({}));
    const inv = j.Invoices?.[0];
    console.log(`Xero by ID: ${r.status} → ${inv ? `${inv.InvoiceNumber} [${inv.Status}] $${inv.Total} due=$${inv.AmountDue} updated=${inv.UpdatedDateUTC}` : "NOT FOUND"}`);
  }
  // by number
  const r2 = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=GB2600029682&summaryOnly=true`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
  const j2: any = await r2.json();
  console.log(`Xero by number: ${(j2.Invoices || []).length} match(es):`, (j2.Invoices || []).map((i: any) => `${i.InvoiceNumber} [${i.Status}] $${i.Total}`).join("; ") || "none");
  process.exit(0);
})();
