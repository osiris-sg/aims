// Mirror the July Xero convention: zero-amount EQUIPMENT lines get qty=1,
// unit=0, amount=0 (like July); annotation lines stay fully blank.
// Match each AIMS line to its July source line (desc-prefix after bumps).
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
    if (res.status === 429) { const w = parseInt(res.headers.get("Retry-After") || "60", 10); if (w > 600) throw new Error("DAILY_CAP"); await sleep(w * 1000); continue; }
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}`);
    return j;
  }
  throw new Error("gave up");
}
const suffix = (n: number) => { const t = n % 100; if (t >= 11 && t <= 13) return "th"; return ["th","st","nd","rd"][n % 10] || "th"; };
const bumpOrd = (s: string) => s.replace(/(\d+)(st|nd|rd|th)(\s*)(mth|month)/gi, (_m, n, _sf, sp, w) => { const v = parseInt(n, 10) + 1; return `${v}${suffix(v)}${sp}${w}`; });
const bumpDates = (s: string, june: boolean) => s.split("\n").map(line => {
  if (/dated/i.test(line)) return line;
  if (june) return line.replace(/30\/06\/2026/g, "31/07/2026").replace(/(\b\d{2})\/06\/2026/g, "$1/07/2026");
  return line.replace(/(\b\d{2})\/07\/2026/g, "$1/08/2026");
}).join("\n");
const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 45);
(async () => {
  TK = await tokens();
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG, sourceDocumentId: { not: null }, lastRunDocumentId: { not: null } }, select: { sourceDocumentId: true, lastRunDocumentId: true } });
  const srcDocs = await prisma.document.findMany({ where: { id: { in: tpls.map(t => t.sourceDocumentId!) } }, select: { id: true, name: true } });
  const srcNameById = new Map(srcDocs.map(d => [d.id, d.name!]));
  const srcNameByGenId = new Map(tpls.map(t => [t.lastRunDocumentId!, srcNameById.get(t.sourceDocumentId!)!]));
  const srcNames = [...new Set([...srcNameByGenId.values()])];
  const xeroByNum = new Map<string, any>();
  for (let i = 0; i < srcNames.length; i += 40) {
    for (let page = 1; ; page++) {
      const r = await xget(`/Invoices?InvoiceNumbers=${encodeURIComponent(srcNames.slice(i, i + 40).join(","))}&page=${page}`);
      for (const inv of r.Invoices || []) xeroByNum.set(inv.InvoiceNumber, inv);
      if ((r.Invoices || []).length < 100) break;
    }
    await sleep(1100);
  }
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  let changed = 0, restored = 0;
  for (const d of ours) {
    const c: any = d.config;
    const srcName = srcNameByGenId.get(d.id);
    const src = srcName ? xeroByNum.get(srcName) : null;
    if (!src) continue;
    const julyLines: any[] = src.LineItems || [];
    const june = julyLines.some(l => /\b\d{2}\/06\/2026\s*(to|-|–)/.test(l.Description || ""));
    // map: bumped-normalized july desc prefix → july line (item lines only, qty present)
    const julyItems = julyLines.filter(l => l.Quantity != null);
    const byPrefix = new Map(julyItems.map(l => [norm(bumpOrd(bumpDates(l.Description || "", june))), l]));
    let dirty = false;
    const items = (c.items || []).map((it: any) => {
      if (Number(it.amount)) return it; // priced lines untouched
      if (it.quantity != null) return it;
      const jl = byPrefix.get(norm(it.description || ""));
      if (!jl) return it; // annotation — stays blank like July
      dirty = true; restored++;
      return { ...it, quantity: Number(jl.Quantity), unitPrice: Number(jl.UnitAmount) || 0, amount: Number(jl.LineAmount) || 0, tax: 0 };
    });
    if (dirty) { changed++; if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items } } }); }
  }
  console.log(`${DRY ? "[DRY] would restore" : "restored"} qty on ${restored} bundled-equipment lines across ${changed} drafts (July convention)`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
