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
  const xeroInvs: any[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent('Type=="ACCREC"')}&page=${page}&summaryOnly=true`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await res.json();
    const invs = j.Invoices || [];
    xeroInvs.push(...invs);
    if (invs.length < 100) break;
    await sleep(1100);
  }
  const aims = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { name: true, config: true } });
  const aimsIds = new Set(aims.map(d => (d.config as any)?.xeroInvoiceId).filter(Boolean));
  const missing = xeroInvs.filter(i => !aimsIds.has(i.InvoiceID));
  const byStatus: Record<string, any[]> = {};
  for (const m of missing) (byStatus[m.Status] = byStatus[m.Status] || []).push(m);
  console.log(`Xero ACCREC total: ${xeroInvs.length} · in AIMS by ID: ${xeroInvs.length - missing.length} · missing: ${missing.length}`);
  for (const [st, list] of Object.entries(byStatus)) {
    console.log(`\n${st} (${list.length}):`);
    for (const m of list.slice(0, 15)) console.log(`  ${m.InvoiceNumber} ${m.DateString?.slice(0,10)} $${m.Total} due=$${m.AmountDue}`);
    if (list.length > 15) console.log(`  … +${list.length - 15} more`);
  }
  process.exit(0);
})();
