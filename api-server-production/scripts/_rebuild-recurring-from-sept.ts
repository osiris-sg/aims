// Replace ALL recurring templates with a fresh set based on the September
// issue list (guru 2026-08-27): one template per continuing Aug chain (lines
// pulled LIVE from Xero incl. her edits, tokenized), + new chains. Draft-first.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
const sfx = (n: number) => { const t = n % 100; if (t >= 11 && t <= 13) return "th"; return ["th","st","nd","rd"][n % 10] || "th"; };
const DRY = process.argv.includes("--dry");
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  const aug = JSON.parse(fs.readFileSync("scripts/_aug-state.json", "utf8"));
  // live lines for all aug invoices
  const byId = new Map<string, any>();
  const ids = aug.map((a: any) => a.xeroId);
  for (let i = 0; i < ids.length; i += 40) {
    for (let page = 1; ; page++) {
      const r: any = await xeroGet(tokens, "/Invoices", { IDs: ids.slice(i, i + 40).join(","), page: String(page) } as any);
      for (const inv of r.Invoices || []) byId.set(inv.InvoiceID, inv);
      if ((r.Invoices || []).length < 100) break;
    }
  }
  console.log(`pulled lines for ${byId.size} invoices`);
  const tplId = "cc6d0035-993f-403f-8dd6-582ce8b10b0b"; // invoice template used by chains
  const custRows = await prisma.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } });
  const custByName = (n: string) => custRows.find(c => c.name.toLowerCase().slice(0, 18) === n.toLowerCase().slice(0, 18)) || custRows.find(c => c.name.toLowerCase().includes(n.toLowerCase().split(" ")[0]));
  const tokenize = (s: string, ordinal: number | null) => {
    let out = s || "";
    out = out.replace(/\b\d{2}\/08\/2026\b(?![\s\S]{0,12}dated)/g, (m) => m.startsWith("01/") ? "{MONTH START}" : "{MONTH END}");
    if (ordinal != null) out = out.replace(new RegExp(`\\b${ordinal}(st|nd|rd|th)\\s*(mth|month)`, "gi"), `{NTH} $2`);
    return out;
  };
  if (!DRY) { const del = await prisma.recurringInvoiceTemplate.deleteMany({ where: { organizationId: ORG } }); console.log(`deleted ${del.count} old templates`); }
  const rows: any[] = [];
  for (const a of aug.filter((x: any) => x.status === "AUTHORISED").sort((p: any, q: any) => p.cust.toLowerCase().localeCompare(q.cust.toLowerCase()) || p.xeroNum.localeCompare(q.xeroNum))) {
    const inv = byId.get(a.xeroId);
    if (!inv) continue;
    const metered = /MBR/i.test(a.ref || "");
    const hold = a.xeroNum === "BI202608046";
    const cust = custByName(a.cust);
    if (!cust) { console.log(`✗ no customer for ${a.cust} (${a.xeroNum})`); continue; }
    const items = (inv.LineItems || []).map((l: any, i: number) => {
      const amt = Number(l.LineAmount) || 0;
      const base: any = { id: 1800000000000 + rows.length * 100 + i, description: tokenize(l.Description || "", a.ordinal), quantity: l.Quantity ?? null, unitPrice: l.UnitAmount ?? null, amount: amt || null, accountCode: l.AccountCode || null, tax: (Number(l.TaxAmount) || 0) > 0 ? 9 : 0 };
      return base;
    });
    const ref = tokenize((a.ref || "").replace(/^BI\w+\s*/, ""), a.ordinal);
    rows.push({
      cust, name: `${a.cust.slice(0, 28)} — ${(a.ref || "").split(" - ")[1]?.slice(0, 40) || a.xeroNum}`,
      config: { items, reference: ref, currency: "SGD", note: metered ? "METERED — fill qty from 31/{PREV MONTH NO} reading before confirming" : "" },
      nextRunNo: (a.ordinal ?? 1) + 1, active: !hold && true, augXero: a.xeroNum,
      note: hold ? "HOLD — KTC trial purchase-option" : metered ? "METERED" : "",
    });
  }
  const NEW = [
    { cn: "Jiayi", name: "Jiayi — LION375 MG20250103 Sembawang (DO202608-009)", amt: 6104, ord: 2, active: true, ref: "({NTH} mth Sembawang - DO202608-009 1xLION375 MG20250103)", desc: "Rental period from {MONTH START} to {MONTH END} - {NTH} mth\n\n1). Rental of one unit Micro-Grid System\nBrand: BIOFUEL\nModel: LION375\nS/No.: MG20250103\n\n2). Rental of one unit Diesel Generator + 1 set cable" },
    { cn: "Prime", name: "Prime Builders — AF5 64 Ocean Drive (DO202608-017)", amt: 600, ord: 2, active: true, ref: "({NTH} mth 64 Ocean Drive - DO202608-017 1xAF5 · PO 64 OD BI-PO-01)", desc: "Rental period from {MONTH START} to {MONTH END} - {NTH} mth\n\n1). Rental of one unit Advance Filtration System\nModel: AF5 (5m3/hr)" },
    { cn: "QJI-GCC", name: "QJI-GCC — BESS 375kWh Lentor LP26 (DO202608-006) RATE TBC", amt: 0, ord: 2, active: false, ref: "({NTH} mth Lentor Gdns LP26 - DO202608-006 1xBESS375)", desc: "Rental period from {MONTH START} to {MONTH END} - {NTH} mth\n\n1). Rental of one unit Battery Energy Storage System 375KW/H\n⚠ RATE TBC" },
    { cn: "Integrate", name: "Integrate Engineers — BESS Joo Koon (DO202608-013) RATE TBC", amt: 0, ord: 2, active: false, ref: "({NTH} mth 61 Joo Koon Cir - DO202608-013 1xBESS)", desc: "Rental period from {MONTH START} to {MONTH END} - {NTH} mth\n\n1). Rental of one unit Energy Storage Power Supply System\n⚠ RATE TBC · possibly 2 units" },
    { cn: "TANGLIN", name: "Tanglin — LION500 MG20260172 Holland Dr (DO202608-016) RATE TBC", amt: 0, ord: 2, active: false, ref: "({NTH} mth 18 Holland Drive - DO202608-016 1xLION500 MG20260172)", desc: "Rental period from {MONTH START} to {MONTH END} - {NTH} mth\n\n1). Rental of one unit Micro-Grid System LION500\nS/No.: MG20260172\n⚠ RATE TBC" },
  ];
  for (const n of NEW) {
    const cust = custByName(n.cn);
    if (!cust) { console.log(`✗ no customer for ${n.cn}`); continue; }
    rows.push({ cust, name: n.name, config: { items: [{ id: Date.now() % 1e9, description: n.desc, quantity: 1, unitPrice: n.amt || null, amount: n.amt || null, accountCode: "214", tax: 9 }], reference: n.ref, currency: "SGD" }, nextRunNo: n.ord, active: n.active, augXero: "", note: n.amt ? "" : "RATE TBC" });
  }
  // create with codes in order
  const out: any[] = [];
  let i = 0;
  for (const r of rows) {
    i++;
    const code = `REC-${String(i).padStart(3, "0")}`;
    if (!DRY) await prisma.recurringInvoiceTemplate.create({ data: {
      organizationId: ORG, code, name: r.name.slice(0, 90), customerId: r.cust.id, documentTemplateId: tplId,
      config: r.config, frequency: "MONTHLY", nextRunDate: new Date("2026-09-01T00:00:00+08:00"),
      autoSend: false, isActive: r.active, nextRunNo: r.nextRunNo, createdBy: "sept-rebuild 2026-08-27",
    } });
    out.push({ code, cust: r.cust.name, augXero: r.augXero, note: r.note });
  }
  fs.writeFileSync("scripts/_rec-codes.json", JSON.stringify(out, null, 1));
  console.log(`${DRY ? "[DRY] would create" : "created"} ${out.length} templates (REC-001…REC-${String(out.length).padStart(3, "0")})`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message || e); process.exit(1); });
