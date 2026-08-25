// Complete CN reconciliation: every Xero credit note (both types) vs AIMS.
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
  const xcns: any[] = [];
  for (let page = 1; ; page++) {
    const r = await fetch(`https://api.xero.com/api.xro/2.0/CreditNotes?page=${page}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } });
    const j: any = await r.json();
    const cns = j.CreditNotes || [];
    xcns.push(...cns);
    if (cns.length < 100) break;
    await sleep(1100);
  }
  const aims = await prisma.document.findMany({ where: { organizationId: ORG }, select: { name: true, config: true } });
  const names = new Set(aims.map(d => d.name));
  const ids = new Set(aims.map(d => (d.config as any)?.xeroCreditNoteId).filter(Boolean));
  const missing = xcns.filter(cn => !["DELETED", "VOIDED"].includes(cn.Status) && !ids.has(cn.CreditNoteID) && !names.has(cn.CreditNoteNumber));
  console.log(`Xero CNs: ${xcns.length} total; live: ${xcns.filter(c => !["DELETED", "VOIDED"].includes(c.Status)).length}; MISSING from AIMS: ${missing.length}`);
  for (const cn of missing) console.log(`  ✗ ${cn.CreditNoteNumber} [${cn.Type} ${cn.Status}] $${cn.Total} remaining=$${cn.RemainingCredit} · ${cn.Contact?.Name?.slice(0, 32)} · ${cn.DateString?.slice(0, 10)} · updated=${cn.UpdatedDateUTC}`);
  process.exit(0);
})();
