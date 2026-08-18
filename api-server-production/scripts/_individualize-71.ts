// Rebuild the 71 recurring drafts' line items in AIMS to match the July source
// invoices' individualized format (per-component lines, discounts as negative
// lines, per-line item/account codes) with period/ordinal text bumped.
// AIMS ONLY — no Xero writes.
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
  if (!res.ok) throw new Error(`refresh ${res.status}`);
  const n: any = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
  return { at: upd.accessToken, tid: upd.tenantId };
}
let TK: any;
async function xero(path: string) {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try { res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { headers: { Authorization: `Bearer ${TK.at}`, "Xero-Tenant-Id": TK.tid, Accept: "application/json" } }); }
    catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get("Retry-After") || "60", 10); if (w > 600) throw new Error(`DAILY_CAP:${w}`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  }
  throw new Error("gave up");
}

const suffix = (n: number) => { const t = n % 100; if (t >= 11 && t <= 13) return "th"; return ["th","st","nd","rd"][n % 10] || "th"; };
const bumpOrdinals = (s: string) => s.replace(/(\d+)(st|nd|rd|th)(\s*)(mth|month)/gi, (_m, n, _sf, sp, w) => { const v = parseInt(n, 10) + 1; return `${v}${suffix(v)}${sp}${w}`; });
const bumpDates = (s: string, june: boolean) => s.split("\n").map(line => {
  if (/dated/i.test(line)) return line;
  if (june) return line.replace(/30\/06\/2026/g, "31/07/2026").replace(/(\b\d{2})\/06\/2026/g, "$1/07/2026");
  return line.replace(/(\b\d{2})\/07\/2026/g, "$1/08/2026");
}).join("\n");

(async () => {
  TK = await tokens();
  // 1. template pairs → (generated draft id) → (source July name)
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG, sourceDocumentId: { not: null }, lastRunDocumentId: { not: null } }, select: { sourceDocumentId: true, lastRunDocumentId: true } });
  const srcDocs = await prisma.document.findMany({ where: { id: { in: tpls.map(t => t.sourceDocumentId!) } }, select: { id: true, name: true } });
  const srcNameById = new Map(srcDocs.map(d => [d.id, d.name!]));
  const srcNameByGenId = new Map(tpls.map(t => [t.lastRunDocumentId!, srcNameById.get(t.sourceDocumentId!)!]));

  // 2. our 71 drafts
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");

  // 3. pull July source lines from Xero (with LineItems via page param)
  const srcNames = [...new Set([...srcNameByGenId.values()])];
  const xeroByNum = new Map<string, any>();
  for (let i = 0; i < srcNames.length; i += 40) {
    for (let page = 1; ; page++) {
      const r = await xero(`/Invoices?InvoiceNumbers=${encodeURIComponent(srcNames.slice(i, i + 40).join(","))}&page=${page}`);
      for (const inv of r.Invoices || []) xeroByNum.set(inv.InvoiceNumber, inv);
      if ((r.Invoices || []).length < 100) break;
    }
    await sleep(1100);
  }
  console.log(`sources: ${srcNames.length} names, ${xeroByNum.size} fetched from Xero`);

  // 4. rebuild each draft
  let done = 0; const skipped: string[] = [];
  for (const d of ours) {
    const c: any = d.config;
    const srcName = srcNameByGenId.get(d.id);
    if (!srcName) { skipped.push(`${d.name}: no template mapping (hand-built?) — left as-is`); continue; }
    const src = xeroByNum.get(srcName);
    if (!src) { skipped.push(`${d.name}: source ${srcName} not fetched from Xero`); continue; }
    const FORCE = ["BI202608013", "BI202608014", "BI202608015", "BI202608017"];
    if (!FORCE.includes(d.name!) && (c.items || []).filter((it: any) => Number(it.amount)).length > 1) { skipped.push(`${d.name}: already multi-amount-line — left as-is`); continue; }
    if (!FORCE.includes(d.name!) && c.lineFormat) { skipped.push(`${d.name}: already rebuilt`); continue; }
    const srcLines: any[] = src.LineItems || [];
    const srcNet = srcLines.reduce((s, l) => s + (Number(l.LineAmount) || 0), 0);
    if (Math.abs(srcNet - c.subTotal) > 0.02) { skipped.push(`${d.name}: source ${srcName} net ${srcNet.toFixed(2)} ≠ draft subTotal ${c.subTotal} — needs manual split`); continue; }
    const june = srcLines.some(l => /\b\d{2}\/06\/2026\s*(to|-|–)/.test(l.Description || "")) || /period.*\/06\/2026/i.test(srcLines.map(l => l.Description).join(" "));
    const items = srcLines.map((l, i) => {
      const amt = Number(l.LineAmount) || 0;
      const qty = Number(l.Quantity) || 1;
      const taxed = (Number(l.TaxAmount) || 0) !== 0 || l.TaxType === "TAX001";
      return {
        id: 1794000000000 + done * 100 + i,
        description: bumpOrdinals(bumpDates(l.Description || "", june)),
        quantity: qty,
        unitPrice: Number(l.UnitAmount) || 0,
        amount: amt,
        itemCode: l.ItemCode || "",
        accountCode: l.AccountCode || null,
        tax: amt !== 0 ? (taxed ? 9 : 0) : 0,
        discount: Number(l.DiscountRate) || 0,
        isService: false,
        revenueTag: "rental",
      };
    });
    const net = +items.reduce((s, it) => s + it.amount, 0).toFixed(2);
    const gst = +items.reduce((s, it) => s + it.amount * (it.tax / 100), 0).toFixed(2);
    if (Math.abs(net - c.subTotal) > 0.02 || Math.abs(gst - c.gstAmount) > 0.05) { skipped.push(`${d.name}: rebuilt totals ${net}/${gst} ≠ draft ${c.subTotal}/${c.gstAmount}`); continue; }
    if (!DRY) await prisma.document.update({ where: { id: d.id }, data: { config: { ...c, items, subTotal: net, gstAmount: gst, nettTotal: +(net + gst).toFixed(2), lineFormat: "individualized-from-" + srcName } } });
    done++;
    if (done <= 2) console.log(`sample ${d.name} ← ${srcName}: ${items.length} lines, net ${net}, gst ${gst}`);
  }
  console.log(`\n${DRY ? "[DRY] would rebuild" : "rebuilt"} ${done}; skipped ${skipped.length}:`);
  for (const s of skipped) console.log("  ⚠", s);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
