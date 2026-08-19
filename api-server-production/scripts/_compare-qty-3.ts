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
  for (const name of ["BIPL-JPSG-INV-20260817-0071", "BIPL-JPSG-INV-20260817-0072", "BIPL-JPSG-INV-20260817-0075"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name }, select: { config: true } });
    const c: any = d!.config;
    console.log(`\n═══ ${name}`);
    console.log("  AIMS lines:");
    for (const it of (c.items || [])) if (Number(it.amount)) console.log(`    qty=${it.quantity} unit=${it.unitPrice} amt=${it.amount} · ${(it.description || "").slice(0, 50).replace(/\n/g, " ")}`);
    const r = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${c.xeroInvoiceId}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await r.json();
    const inv = j.Invoices?.[0];
    console.log(`  XERO now [${inv?.Status}] updated=${inv?.UpdatedDateUTC}:`);
    for (const l of inv?.LineItems || []) if (Number(l.LineAmount)) console.log(`    qty=${l.Quantity} unit=${l.UnitAmount} amt=${l.LineAmount} tax=${l.TaxAmount} · ${(l.Description || "").slice(0, 50).replace(/\n/g, " ")}`);
    console.log(`  totals: AIMS $${c.nettTotal} vs Xero $${inv?.Total}`);
    await new Promise(r2 => setTimeout(r2, 1100));
  }
  process.exit(0);
})();
