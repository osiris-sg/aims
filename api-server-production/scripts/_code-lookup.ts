import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const accts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG, code: { in: ["200","201","202","204","205","206","213","214","216","220","227"] } }, select: { code: true, name: true } });
  for (const a of accts.sort((x, y) => x.code.localeCompare(y.code))) console.log(`  ${a.code}  ${a.name}`);
  console.log("\n── most-used accountCode per pattern (existing invoices):");
  const invs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE" }, select: { config: true }, take: 3000 });
  const pats: Record<string, RegExp> = {
    "FIREFLY / AIS": /firefly|advanced illumination/i,
    "LION / Micro-Grid": /micro-?grid|lion\d/i,
    "SIDS SALE": /sale of one set sids|sales of .*sids/i,
    "SIDS RENTAL": /rental of .*sids|silt imagery/i,
    "TRANSPORT": /transport/i,
  };
  for (const [label, re] of Object.entries(pats)) {
    const tally = new Map<string, number>();
    for (const x of invs) for (const it of ((x.config as any)?.items || [])) {
      if (!it.accountCode) continue;
      if (!re.test(String(it.description || ""))) continue;
      tally.set(it.accountCode, (tally.get(it.accountCode) || 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    console.log(`  ${label.padEnd(18)} ${top.map(([k, v]) => `${k}×${v}`).join(", ") || "no precedent"}`);
  }
  process.exit(0);
})();
