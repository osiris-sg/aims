import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const tmp = await prisma.document.count({ where: { organizationId: ORG, name: { startsWith: "TMP" } } });
  const series = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { gte: "BI202609001", lte: "BI202609099" } }, select: { name: true } });
  const real = series.map(d => d.name!).filter(n => /^BI202609\d{3}$/.test(n));
  const have = new Set(real);
  const gaps = []; for (let i = 1; i <= 86; i++) if (!have.has(`BI202609${String(i).padStart(3, "0")}`)) gaps.push(i);
  console.log(`TMP-named documents: ${tmp}`);
  console.log(`Sept series: ${real.length} docs, 001–086, gaps: ${gaps.join(",") || "none"}`);
  process.exit(0);
})();
