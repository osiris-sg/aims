import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tpls = await prisma.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, orderBy: { code: "asc" } });
  let hits = 0;
  for (const t of tpls) {
    const c: any = t.config;
    const lines: string[] = [];
    const scan = (label: string, v: any) => {
      for (const raw of String(v || "").split("\n")) {
        if (!/\{(MONTH START|MONTH END|PREV MONTH START|PREV MONTH END)\}/.test(raw)) continue;
        // legit: the period header wording
        if (/rental period|period from|rental of .*period|billing period/i.test(raw)) continue;
        lines.push(`${label}: ${raw.trim().slice(0, 100)}`);
      }
    };
    for (const it of c.items || []) scan("item", it.description);
    scan("reference", c.reference); scan("notes", c.notes);
    if (lines.length) { hits++; console.log(`${t.code} · ${t.name.slice(0, 55)}`); for (const l of lines) console.log(`    ${l}`); }
  }
  console.log(`\n${hits} / ${tpls.length} templates with tokens outside the period header`);
  process.exit(0);
})();
