import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202609" } }, select: { name: true, status: true, config: true }, orderBy: { name: "asc" } });
  let litTok = 0, badDate = 0;
  for (const d of docs) {
    const c: any = d.config;
    for (const it of c.items || []) {
      const desc = String(it.description || "");
      for (const raw of desc.split("\n")) {
        if (/\{[A-Z ]+\}/.test(raw)) { litTok++; console.log(`UNRESOLVED  ${d.name} [${d.status}]: ${raw.trim().slice(0, 90)}`); }
        // a PO/DO/Qtn/MRF line whose "dated" is Sept period start/end = wrongly re-dated fixed date
        if (/dated\s*(30\/09\/2026|01\/09\/2026)/.test(raw) && /(PO|DO|Qtn|MRF|Contract|WO)\b/i.test(raw)) {
          badDate++; console.log(`RE-DATED    ${d.name} [${d.status}]: ${raw.trim().slice(0, 90)}`);
        }
      }
    }
  }
  console.log(`\nunresolved-token lines: ${litTok} · wrongly re-dated lines: ${badDate} (of ${docs.length} Sept invoices)`);
  process.exit(0);
})();
