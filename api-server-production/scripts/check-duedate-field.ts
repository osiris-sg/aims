import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const doc = await p.document.findFirst({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', name: 'BI202406034' }, select: { config: true } });
  const c: any = doc?.config || {};
  console.log(Object.keys(c).filter(k => /date|due/i.test(k)));
  console.log(JSON.stringify({ date: c.date, dueDate: c.dueDate, xeroDueDate: c.xeroDueDate, documentInfo: c.documentInfo && Object.keys(c.documentInfo).filter((k: string) => /date|due/i.test(k)).reduce((o: any, k: string) => (o[k] = c.documentInfo[k], o), {}) }));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
