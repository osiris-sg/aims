import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, name: "BIPL-JPSG-INV-20260817-0071" } });
  const c: any = d!.config;
  const items = (c.items || []).map((it: any) => Number(it.amount) ? { ...it, taxAmount: Math.round(Number(it.amount) * 9) / 100, tax: 9 } : it);
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, items } } });
  console.log("✓ 0071 line tax corrected to 9% of line amount:", items.filter((i: any) => Number(i.amount)).map((i: any) => `${i.amount}→tax ${i.taxAmount}`).join(", "));
  process.exit(0);
})();
