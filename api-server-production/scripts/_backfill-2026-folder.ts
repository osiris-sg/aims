// Backfill prod AIMS from the "Rental PO and DO" folder — 2026 documents only:
//  signed DO/RTN files → DELIVERY_ORDER / RETURN_DELIVERY_ORDER
//  customer PO files (2026) → SALES_ORDER
// Metadata from filenames; remark cites the source scan. Idempotent by name.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
const prisma = createScriptPrisma();
const DIR = "/Users/guru/Downloads/Rental PO and DO";
const TPL = "b4898f54-fec8-46dd-a3be-52fc47e34c05";
const APPLY = process.argv.includes("--apply");
const ALIASES: Record<string, string> = {
  "KTC": "KTC Civil", "CCDC": "China Communications", "LT Sambo": "LT Sambo", "Lian Beng": "Lian Beng",
  "QJI-GCC": "QJI-GCC", "QJ E&C": "Qingjian Engineering", "QJEC": "Qingjian Engineering", "Qingjian Int'l": "Qingjian International",
  "Qingjian Engrg": "Qingjian Engineering", "RCC": "RCC", "RCCT": "RCC", "ST Engrg": "ST Engineering", "SCB": "SCB Building",
  "Jia Yi": "Jiayi", "Debenho": "Debenho", "Keller": "Keller", "Nishio": "Nishio", "Shuan Huat": "Shuan Huat",
  "Teambuild": "Teambuild", "Tenda": "Tenda", "CCR": "China Construction Realty", "Expand": "Expand", "ATS": "ATS",
  "Hwa Seng": "Hwa Seng", "BioSepa": "BioSepa", "Samsung": "Samsung", "CNQC": "Qingjian",
};
(async () => {
  const custs = await prisma.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } });
  const findCust = (label: string) => {
    const l = label.toLowerCase();
    let hit = custs.find(c => c.name.toLowerCase().startsWith(l)) || custs.find(c => c.name.toLowerCase().includes(l));
    if (!hit) { const alias = Object.entries(ALIASES).find(([k]) => l.startsWith(k.toLowerCase()))?.[1]; if (alias) hit = custs.find(c => c.name.toLowerCase().includes(alias.toLowerCase())); }
    return hit;
  };
  const existing = new Set((await prisma.document.findMany({ where: { organizationId: ORG }, select: { name: true } })).map(d => d.name!.toUpperCase().replace(/[\s]/g, "")));
  const files = fs.readdirSync(DIR).filter(f => f.endsWith(".pdf"));
  let made = 0, skip = 0, noCust = 0;
  for (const f of files) {
    // ---- signed DO / RTN, 2026 ----
    let m = /Signed\s+(RTN-?\s?DO|DO)\s?(?:BI)?\s?(2026\d{2}-\d{2,4}[A-Z]?)\s+dtd\s+(\d{8})\s+(.+?)\s*[-(]/i.exec(f);
    if (m) {
      const isRtn = /RTN/i.test(m[1]);
      const name = (isRtn ? "RTN-DO" : "DO") + m[2];
      if (existing.has(name.toUpperCase())) { skip++; continue; }
      existing.add(name.toUpperCase()); // in-run dedupe (folder has repeat scans)
      const date = `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6, 8)}`;
      const cust = findCust(m[4].trim());
      if (!cust) noCust++;
      const kit = (/[-(]\s*(.+)\)?\.pdf$/.exec(f)?.[1] || "").replace(/\)\.pdf$|\.pdf$/, "").slice(0, 160);
      console.log(`${APPLY ? "CREATE" : "would"} ${name.padEnd(20)} ${date} · ${(cust?.name || "?? " + m[4]).slice(0, 30)} · ${kit.slice(0, 55)}`);
      if (APPLY) {
        await prisma.document.create({ data: { organizationId: ORG, type: isRtn ? "RETURN_DELIVERY_ORDER" : "DELIVERY_ORDER", name, status: "delivered_installed" as any, documentTemplateId: TPL,
          config: { date, customerId: cust?.id || "", customerName: cust?.name || m[4].trim(), items: [{ quantity: 1, description: kit }], referenceNo: `Backfilled from signed scan: ${f.slice(0, 120)}`, documentInfo: { referenceNo: kit.slice(0, 90) }, remarks: `Backfilled 2026-09-11 from folder scan "${f}" (filename metadata; full detail in the signed PDF).`, createdBy: "folder-backfill 2026-09-11" } } });
        made++;
      }
      continue;
    }
    // ---- customer PO, 2026 ----
    m = /^(2026\d{4})\s+PO\s+(?:No\.?\s*)?([A-Za-z0-9._\/-]+)\s+(.+?)\s*[-(]/i.exec(f);
    if (m) {
      const name = `SO-${m[2].replace(/[^\w.-]/g, "")}`.slice(0, 40);
      if (existing.has(name.toUpperCase())) { skip++; continue; }
      existing.add(name.toUpperCase());
      const date = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
      const cust = findCust(m[3].trim());
      if (!cust) noCust++;
      const kit = (/[-(]\s*(.+)\)?\.pdf$/.exec(f)?.[1] || "").replace(/\)\.pdf$|\.pdf$/, "").slice(0, 160);
      console.log(`${APPLY ? "CREATE" : "would"} ${name.padEnd(20)} ${date} · ${(cust?.name || "?? " + m[3]).slice(0, 30)} · SO · ${kit.slice(0, 50)}`);
      if (APPLY) {
        await prisma.document.create({ data: { organizationId: ORG, type: "SALES_ORDER", name, status: "unconfirmed" as any, documentTemplateId: TPL,
          config: { date, customerId: cust?.id || "", customerName: cust?.name || m[3].trim(), items: [{ quantity: 1, description: kit }], referenceNo: `Customer PO ${m[2]} · backfilled from "${f.slice(0, 110)}"`, documentInfo: { referenceNo: `Customer PO ${m[2]}` }, remarks: `Backfilled 2026-09-11 from folder scan "${f}".`, createdBy: "folder-backfill 2026-09-11" } } });
        made++;
      }
    }
  }
  console.log(`\n${APPLY ? "created" : "would create"}: ${made || "see above"} · skipped existing: ${skip} · customer unresolved: ${noCust}`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
