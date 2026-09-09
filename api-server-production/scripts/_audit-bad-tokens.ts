// Find "dated {TOKEN}" — a fixed document date that got wrongly tokenized.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const BAD = /dated\s*\{(MONTH START|MONTH END|PREV MONTH START|PREV MONTH END)\}/g;
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  let hits = 0;
  for (const t of tpls) {
    const blob = JSON.stringify(t.config);
    const m = blob.match(BAD);
    if (m) {
      hits++;
      // show each affected line snippet
      const c: any = t.config;
      const snips: string[] = [];
      for (const it of c.items || []) {
        const d = String(it.description || "");
        let mm; const re = new RegExp(BAD.source, "g");
        while ((mm = re.exec(d))) snips.push(d.slice(Math.max(0, mm.index - 45), mm.index + mm[0].length).replace(/\n/g, " ¶ "));
      }
      for (const fld of ["reference", "notes"]) { const v = String(c[fld] || ""); let mm; const re = new RegExp(BAD.source, "g"); while ((mm = re.exec(v))) snips.push(`[${fld}] ` + v.slice(Math.max(0, mm.index - 45), mm.index + mm[0].length)); }
      console.log(`${t.code} · ${t.name.slice(0, 50)}`);
      for (const sn of snips) console.log(`    …${sn}`);
    }
  }
  console.log(`\n${hits} / ${tpls.length} templates affected`);
  process.exit(0);
})();
