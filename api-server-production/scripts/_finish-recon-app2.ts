// 1) Delete the 4 wrong local journals (guru-approved 2026-08-17).
// 2) Finish the interrupted reconcile's AR + AP sections via app2 (main app is
//    quota-blocked). Mirrors reconcile-xero-biofuel.ts logic exactly.
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const R = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ASOF = new Date(); // today
const XT2_FILE = __dirname + "/_xero2-tokens.json";
async function tokens() {
  const t = JSON.parse(fs.readFileSync(XT2_FILE, "utf8"));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return { at: t.accessToken, tid: t.tenantId };
  const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString("base64");
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`);
  const n: any = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
  return { at: upd.accessToken, tid: upd.tenantId };
}
let TK: any;
async function xeroGet(path: string) {
  for (let i = 0; i < 8; i++) {
    let res: Response;
    try { res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } }); }
    catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get("Retry-After") || "60", 10); if (w > 900) throw new Error(`DAILY_CAP:${w}`); console.log(`  ⏸ 429 ${w}s`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}`);
    return json;
  }
  throw new Error("gave up");
}
async function pullAmountDue(type: string) {
  let total = 0, count = 0;
  const asofMs = ASOF.getTime();
  for (let page = 1; ; page++) {
    const r = await xeroGet(`/Invoices?where=${encodeURIComponent(`Type=="${type}"`)}&page=${page}&summaryOnly=true`);
    const invs: any[] = r.Invoices || [];
    if (!invs.length) break;
    for (const inv of invs) {
      if (["VOIDED", "DELETED", "DRAFT", "SUBMITTED"].includes(inv.Status)) continue;
      if (inv.DateString && new Date(inv.DateString).getTime() > asofMs) continue;
      const due = Number(inv.AmountDue) || 0;
      if (due <= 0.005) continue;
      total += due; count++;
    }
    if (invs.length < 100) break;
    await sleep(1100);
  }
  return { total: R(total), count };
}
(async () => {
  // ---- 1. delete the 4 journals
  const nums = ["JV-000020", "JV-000021", "JV-000022", "JV-000023"];
  const jes = await prisma.journalEntry.findMany({ where: { organizationId: ORG, journalNumber: { in: nums } }, select: { id: true, journalNumber: true, totalDebit: true } });
  for (const j of jes) {
    await prisma.journalEntry.delete({ where: { id: j.id } });
    console.log(`✓ deleted ${j.journalNumber} ($${j.totalDebit})`);
  }
  // ---- 2. AR + AP via app2
  TK = await tokens();
  console.log("\n===== AR (app2) =====");
  const xAR = await pullAmountDue("ACCREC");
  const invoices = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { config: true } });
  let aimsAR = 0, nAR = 0;
  for (const inv of invoices) {
    const c: any = inv.config || {};
    if (c.voided) continue;
    if (["DRAFT", "SUBMITTED"].includes((c.xeroStatus || "").toUpperCase())) continue;
    if (c.date && new Date(c.date).getTime() > ASOF.getTime()) continue;
    const owed = Number(c.xeroBalance ?? 0);
    if (owed <= 0.005) continue;
    aimsAR += owed; nAR++;
  }
  aimsAR = R(aimsAR);
  console.log(`  Xero Σ AmountDue : ${xAR.total.toLocaleString()} (${xAR.count})`);
  console.log(`  AIMS Σ xeroBalance: ${aimsAR.toLocaleString()} (${nAR})`);
  console.log(`  Δ = ${R(xAR.total - aimsAR).toLocaleString()} ${Math.abs(xAR.total - aimsAR) <= 0.01 ? "✓ MATCH" : "✗"}`);
  console.log("\n===== AP (app2) =====");
  const xAP = await pullAmountDue("ACCPAY");
  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: "BILL" }, select: { config: true } });
  let aimsAP = 0, nAP = 0;
  for (const b of bills) {
    const c: any = b.config || {};
    const bdate = c.billDate || c.date;
    if (bdate && new Date(bdate).getTime() > ASOF.getTime()) continue;
    let bs = (c.billStatus || "").toUpperCase();
    if (!bs) {
      const xs = (c.xeroStatus || "").toUpperCase();
      bs = xs === "PAID" ? "PAID" : xs === "VOIDED" || xs === "DELETED" ? "VOID" : xs === "DRAFT" ? "DRAFT" : "POSTED";
    }
    if (!["POSTED", "PAID"].includes(bs)) continue;
    const totalAmount = Number(c.totalAmount ?? c.xeroGross ?? 0);
    const amountPaid = c.amountPaid !== undefined ? Number(c.amountPaid) : c.xeroBalance !== undefined ? R(totalAmount - Number(c.xeroBalance)) : Number(c.xeroAmountPaid ?? 0);
    const outstanding = R(totalAmount - amountPaid);
    if (outstanding <= 0.005) continue;
    aimsAP += outstanding; nAP++;
  }
  aimsAP = R(aimsAP);
  console.log(`  Xero Σ AmountDue : ${xAP.total.toLocaleString()} (${xAP.count})`);
  console.log(`  AIMS Σ outstanding: ${aimsAP.toLocaleString()} (${nAP})`);
  console.log(`  Δ = ${R(xAP.total - aimsAP).toLocaleString()} ${Math.abs(xAP.total - aimsAP) <= 0.01 ? "✓ MATCH" : "✗"}`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
