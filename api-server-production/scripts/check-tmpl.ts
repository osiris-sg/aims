import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const t = await p.documentTemplate.findUnique({ where: { id: 'cc6d0035-993f-403f-8dd6-582ce8b10b0b' } });
  console.log(t ? `Template OK: ${t.name} (org ${t.organizationId})` : 'Template MISSING');
}
main().finally(()=>p.$disconnect());
