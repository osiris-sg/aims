import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", createdAt: { gte: new Date("2026-08-08") } }, select: { name: true, config: true }, orderBy: { name: "asc" } });
  const ours = docs.filter(d => (d.config as any)?.xeroSyncedBy === "app2-recurring-push");
  const byModel: Record<string, string[]> = {};
  for (const d of ours) {
    const c: any = d.config;
    const codes = [...new Set((c.items || []).map((it: any) => it.itemCode).filter(Boolean))] as string[];
    const key = codes.find(x => /^LION/.test(x)) || codes[0] || "?";
    (byModel[key] = byModel[key] || []).push(d.name!);
  }
  for (const [k, v] of Object.entries(byModel).sort((a, b) => b[1].length - a[1].length)) console.log(`${k.padEnd(12)} ${v.length}  ${v.join(", ")}`);
  const lion = Object.entries(byModel).filter(([k]) => k.startsWith("LION")).reduce((s, [, v]) => s + v.length, 0);
  console.log(`\nLION-series total: ${lion}/${ours.length}`);
  process.exit(0);
})();
