import { createScriptPrisma, BIOFUEL_ORG_ID as ORG, getXeroTokens, xeroGet } from "./xero-migration/_common";
const prisma = createScriptPrisma();
(async () => {
  const used = new Set<string>();
  const aims = await prisma.document.findMany({ where: { organizationId: ORG, type: "INVOICE", name: { startsWith: "BI202608" } }, select: { name: true } });
  for (const d of aims) if (/^BI202608\d{3}$/.test(d.name!)) used.add(d.name!);
  const tokens = await getXeroTokens(null as any, ORG);
  for (let page = 1; ; page++) {
    const r: any = await xeroGet(tokens, "/Invoices", { page: String(page), where: 'InvoiceNumber.StartsWith("BI202608")' } as any);
    for (const i of r.Invoices || []) if (/^BI202608\d{3}$/.test(i.InvoiceNumber || "")) used.add(i.InvoiceNumber);
    if ((r.Invoices || []).length < 100) break;
  }
  const nums = [...used].map(n => parseInt(n.slice(-3), 10)).filter(n => n !== 194);
  const next = Math.max(...nums) + 1;
  const name = `BI202608${String(next).padStart(3, "0")}`;
  console.log(`highest real 3-digit: ${Math.max(...nums)} → correct number: ${name}`);
  const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name: "BI202608194" } });
  const c: any = d!.config;
  const bump = (v: any) => (typeof v === "string" ? v.split("BI202608194").join(name) : v);
  await prisma.document.update({ where: { id: d!.id }, data: { name, config: { ...c, reference: bump(c.reference), documentInfo: { ...c.documentInfo, documentNumber: name, referenceNo: bump(c.documentInfo.referenceNo) } } } });
  console.log(`✓ renamed BI202608194 → ${name} (refs updated)`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
