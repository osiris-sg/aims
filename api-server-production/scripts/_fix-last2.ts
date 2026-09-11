import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
const BT: Record<string, string> = {
  BI202609082: "Jiayi Construction Engineering Pte. Ltd.\n21 Senoko S Rd\nSingapore 758079\nAttn: Accounts Dept.",
  BI202609085: "Integrate Engineers Pte Ltd\n61 Joo Koon Circle\nAttn: Accounts Dept.",
};
(async () => {
  for (const [name, billTo] of Object.entries(BT)) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, name } });
    const c: any = d!.config;
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, billTo, customerName: billTo.split("\n")[0] } } });
    // template too
    const t = await prisma.recurringInvoiceTemplate.findFirst({ where: { organizationId: ORG, customerId: c.customerId } });
    if (t && !String((t.config as any).billTo || "").trim()) {
      await prisma.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { config: { ...(t.config as any), billTo } } });
    }
    // customer master address (Jiayi's from the signed DO)
    if (name === "BI202609082") await prisma.customer.update({ where: { id: c.customerId }, data: { address: "21 Senoko S Rd, Singapore 758079" } });
    console.log(`✓ ${name} + template + master`);
  }
  process.exit(0);
})();
