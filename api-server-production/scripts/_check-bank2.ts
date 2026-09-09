import { createScriptPrisma } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true, bankDetails: true } });
  for (const o of orgs) {
    const bd: any = o.bankDetails;
    console.log(`${o.name.slice(0, 42).padEnd(44)} ${bd && bd.accountNumber ? "acct=" + bd.accountNumber : bd ? "PARTIAL: " + JSON.stringify(bd).slice(0, 60) : "EMPTY"}`);
  }
  process.exit(0);
})();
