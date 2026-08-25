// Full audit: every AIMS doc we pushed (any app2-*/jpsg-push stamp) verified
// against live Xero; plus Xero-side duplicate-number scan (accountant manual
// re-keys); plus AIMS-born confirmed docs never linked to Xero.
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
let TK: any;
async function xget(path: string) {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try { res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } }); }
    catch { await sleep((i + 1) * 10000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get("Retry-After") || "60", 10); if (w > 600) throw new Error(`DAILY_CAP:${w}`); await sleep(w * 1000); continue; }
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}`);
    return j;
  }
  throw new Error("gave up");
}
(async () => {
  TK = await tokens();
  // pull ALL Xero invoices both types (summary)
  const xall: any[] = [];
  for (const type of ["ACCREC", "ACCPAY"]) {
    for (let page = 1; ; page++) {
      const r = await xget(`/Invoices?where=${encodeURIComponent(`Type=="${type}"`)}&page=${page}&summaryOnly=true`);
      const invs = r.Invoices || [];
      xall.push(...invs.map((i: any) => ({ ...i, _type: type })));
      if (invs.length < 100) break;
      await sleep(1100);
    }
  }
  const byId = new Map(xall.map(i => [i.InvoiceID, i]));
  const byNum = new Map<string, any[]>();
  for (const i of xall) { const n = (i.InvoiceNumber || "").trim(); if (n) byNum.set(n, [...(byNum.get(n) || []), i]); }

  // AIMS docs we pushed
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: { in: ["INVOICE", "BILL", "CREDIT_NOTE"] } }, select: { name: true, type: true, status: true, config: true } });
  const pushed = docs.filter(d => /app2|jpsg-push/.test((d.config as any)?.xeroSyncedBy || ""));
  console.log(`${pushed.length} AIMS docs carry a push stamp. Verifying against ${xall.length} Xero docs...\n`);
  const problems: string[] = [];
  for (const d of pushed) {
    const c: any = d.config;
    const id = c.xeroInvoiceId || c.xeroBillId || c.xeroCreditNoteId;
    const live = id ? byId.get(id) : null;
    const dups = (byNum.get(d.name!) || []).filter(x => !["DELETED", "VOIDED"].includes(x.Status));
    if (!live && !c.xeroCreditNoteId) { problems.push(`✗ ${d.name} [${d.type}]: pushed but ID ${id?.slice(0, 8)} NOT in Xero pull (deleted?)`); continue; }
    if (live && ["DELETED", "VOIDED"].includes(live.Status)) problems.push(`✗ ${d.name}: Xero copy is ${live.Status} (AIMS still ${c.xeroStatus})`);
    if (live && live.InvoiceNumber !== d.name) problems.push(`⚠ ${d.name}: number differs in Xero (${live.InvoiceNumber})`);
    if (dups.length > 1) problems.push(`⚠ ${d.name}: ${dups.length} live copies in Xero — ${dups.map(x => `${x._type} ${x.Status} $${x.Total} (${x.InvoiceID.slice(0, 8)})`).join(" | ")}`);
  }
  // Xero-side duplicate numbers overall (accountant re-keys of anything)
  console.log("── Xero duplicate live numbers (any doc):");
  for (const [n, list] of byNum) {
    const live = list.filter(x => !["DELETED", "VOIDED"].includes(x.Status));
    if (live.length > 1) console.log(`  ${n}: ${live.map(x => `${x._type} ${x.Status} $${x.Total}`).join(" | ")}`);
  }
  // AIMS-born confirmed, no xero link at all
  console.log("\n── AIMS-born confirmed docs with NO Xero link:");
  for (const d of docs) {
    const c: any = d.config;
    if (c.xeroImported || c.xeroInvoiceId || c.xeroBillId || c.xeroCreditNoteId) continue;
    if (!["confirmed", "pending_payment", "paid"].includes(d.status as any)) continue;
    if (/ZZTEST/i.test(JSON.stringify(c.items || []).slice(0, 800))) { console.log(`  (test) ${d.name}`); continue; }
    console.log(`  ${d.name} [${d.type}/${d.status}] $${c.nettTotal ?? c.totalAmount ?? "?"} · ${(c.customerName || c.customer?.name || c.supplier?.name || "?").slice(0, 30)}`);
  }
  console.log(`\n── push-stamp problems (${problems.length}):`);
  for (const p of problems) console.log("  " + p);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
