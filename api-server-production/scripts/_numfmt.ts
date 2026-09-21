import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const fmts = await (prisma as any).documentNumberFormat.findMany({ where: { organizationId: ORG } });
  for (const f of fmts) console.log(`[${f.type}] "${f.label || f.name}" pattern=${JSON.stringify(f.pattern)} next=${f.nextNumber ?? f.counter ?? "?"} pad=${f.padding ?? "?"} active=${f.isActive ?? "?"} default=${f.isDefault ?? "?"} id=${f.id.slice(0, 8)}`);
  console.log(`\n${fmts.length} formats`);
  process.exit(0);
})().catch(e => { console.error(e.message.slice(0, 200)); process.exit(1); });
