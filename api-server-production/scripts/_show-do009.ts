import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, name: "DO202608-009" } });
  const c: any = d?.config;
  console.log(`${d?.name} [${d?.status}] date=${c?.date} cust=${c?.customerName}`);
  console.log("ref:", c?.referenceNo);
  console.log("remarks:", String(c?.remarks || "").slice(0, 300));
  process.exit(0);
})();
