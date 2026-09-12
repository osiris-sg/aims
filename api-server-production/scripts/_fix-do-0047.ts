// DO202609-0047 (guru 2026-09-12): customer = Debenho (with address),
// site Yishun Ave 1, add the DG + cable items alongside the LION375.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const cust = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: "Debenho" } }, select: { id: true, name: true, address: true } });
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, name: "DO202609-0047" } });
  const c: any = d!.config;
  const items = [...(c.items || [])];
  const have = JSON.stringify(items);
  if (!/60\s?es|Generator/i.test(have)) items.push({ quantity: 1, deploymentType: "RENTAL", description: "1 unit 60ES Denyo Soundproof Diesel Generator (fleet no. 0089 per delivery photos)" });
  if (!/core cable/i.test(have)) items.push({ quantity: 1, deploymentType: "RENTAL", description: "1 set 25mm 5 core cable" });
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c,
    customerId: cust!.id, customerName: cust!.name,
    deliveryTo: "Yishun Ave 1",
    items,
    remarks: ((c.remarks || "") + " | Customer + DG/cable items added 12/09 per guru (photos on the DO show the Denyo 60ES, fleet 0089).").replace(/^ \| /, ""),
  } } });
  console.log(`✓ DO202609-0047: customer=${cust!.name} (${cust!.address || "address on master"}), site Yishun Ave 1, items now ${items.length}`);
  process.exit(0);
})();
