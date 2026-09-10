import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  for (const name of ["DO202609-0044", "DO202609-0045"]) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name } });
    const c: any = d!.config;
    console.log(`${name} created=${d!.createdAt.toISOString().slice(0, 16)} · attention=${JSON.stringify(c.attention)} · date fields: date=${c.date} deliveryDate=${c.deliveryDate} documentInfo.date=${c.documentInfo?.date}`);
    if (c.remarks) console.log("  remarks:", String(c.remarks).slice(0, 150));
  }
  process.exit(0);
})();
