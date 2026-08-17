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
  if (!res.ok) throw new Error(`refresh ${res.status}`);
  const n: any = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
  return { at: upd.accessToken, tid: upd.tenantId };
}
(async () => {
  const TK = await tokens();
  for (const name of ["BI2026080181", "BI2026080187"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name } });
    const c: any = d!.config;
    // AIMS side: stamp tax 9 on amount lines
    c.items = (c.items || []).map((it: any) => (Number(it.amount) ? { ...it, tax: 9 } : it));
    await prisma.document.update({ where: { id: d!.id }, data: { config: c } });
    // Xero side: re-send lines with TAX001
    const LineItems = (c.items || []).map((it: any) => {
      const amt = Number(it.amount) || 0;
      if (!amt && !(Number(it.unitPrice) || 0)) return { Description: it.description || " " };
      return { Description: it.description || " ", Quantity: Number(it.quantity) || 1, UnitAmount: Number(it.unitPrice) || amt, AccountCode: it.accountCode, TaxType: "TAX001" };
    });
    const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${c.xeroInvoiceId}`, {
      method: "POST", headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ LineAmountTypes: "Exclusive", LineItems }),
    });
    const j: any = await res.json();
    const inv = j.Invoices?.[0];
    console.log(`${name}: Xero now Total=${inv?.Total} Tax=${inv?.TotalTax} (AIMS nett ${c.nettTotal})`);
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, xeroGross: inv?.Total } } });
    await sleep(1200);
  }
  process.exit(0);
})();
