// Renumber the 71 pushed drafts from 4-digit (BI20260801xx) into the free
// 3-digit slots of Xero's native BI202608NNN series (gap-fill, ascending).
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
const DRY = process.argv.includes("--dry");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
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
async function xero(method: string, path: string, body?: any) {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try { res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { method, headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get("Retry-After") || "60", 10); if (w > 600) throw new Error(`DAILY_CAP:${w}`); console.log(`  ⏸ 429 ${w}s`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
  throw new Error("gave up");
}
(async () => {
  TK = await tokens();
  // 1. every BI202608* number in Xero, any status (deleted/voided numbers stay reserved).
  // StartsWith filter 400s — probe the whole 001-999 range + our 4-digit ones by exact number list.
  const used = new Set<number>();
  let ourXero = new Map<string, any>();
  const probes: string[] = [];
  for (let n = 1; n <= 250; n++) probes.push(`BI202608${String(n).padStart(3, "0")}`);
  for (let n = 117; n <= 187; n++) probes.push(`BI2026080${n}`);
  for (let i = 0; i < probes.length; i += 40) {
    const r = await xero("GET", `/Invoices?InvoiceNumbers=${encodeURIComponent(probes.slice(i, i + 40).join(","))}&summaryOnly=true`);
    for (const inv of r.Invoices || []) {
      const m3 = /^BI202608(\d{3})$/.exec(inv.InvoiceNumber);
      if (m3) used.add(parseInt(m3[1], 10));
      if (/^BI2026080\d{3}$/.test(inv.InvoiceNumber)) ourXero.set(inv.InvoiceNumber, inv);
    }
    await sleep(1100);
  }
  console.log(`Xero 3-digit numbers in use: ${[...used].sort((a, b) => a - b).join(",")}`);
  // 2. our 71 docs in AIMS
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  console.log(`${ours.length} of our pushed drafts found in AIMS; ${ourXero.size} matching 4-digit invoices seen in Xero`);
  // 3. free slots ascending from 009
  const free: number[] = [];
  for (let n = 1; n <= 999 && free.length < ours.length + 5; n++) if (!used.has(n)) free.push(n);
  // 4. assign + rename
  let i = 0, done = 0, skip = 0;
  for (const d of ours) {
    const c: any = d.config;
    if (/^BI202608\d{3}$/.test(d.name!)) { console.log(`  = ${d.name} already 3-digit`); continue; }
    const xinv = ourXero.get(d.name!);
    const status = xinv?.Status;
    if (status && status !== "DRAFT") { console.log(`  ✗ ${d.name} is ${status} in Xero — leaving untouched`); skip++; i++; continue; }
    const newNo = `BI202608${String(free[i]).padStart(3, "0")}`;
    if (DRY) { console.log(`  [DRY] ${d.name} → ${newNo}`); i++; continue; }
    const r = await xero("POST", `/Invoices/${c.xeroInvoiceId}`, { InvoiceNumber: newNo });
    const got = r.Invoices?.[0]?.InvoiceNumber;
    if (got !== newNo) { console.log(`  ✗ ${d.name}: Xero returned ${got}`); skip++; i++; continue; }
    await prisma.document.update({ where: { id: d.id }, data: { name: newNo, config: { ...c, documentNumber: newNo, xeroInvoiceNumber: newNo, renumberedFrom: d.name } } });
    console.log(`  ✓ ${d.name} → ${newNo}`);
    done++; i++;
    await sleep(1100);
  }
  console.log(`\n${DRY ? "[DRY] " : ""}renamed ${done}, skipped ${skip}`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
