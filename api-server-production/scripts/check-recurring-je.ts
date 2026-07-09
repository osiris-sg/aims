import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
  const DOC = '8cfa9952-8027-44ff-b88d-aa46b473d794';

  const since = new Date('2026-07-06T00:00:00Z');
  const jes = await p.journalEntry.findMany({
    where: { organizationId: ORG, createdAt: { gte: since } },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log(`JEs created since 2026-07-06: ${jes.length}`);
  for (const je of jes as any[]) {
    console.log({ journalNumber: je.journalNumber, status: je.status, createdAt: je.createdAt, reference: je.reference, sourceDocumentId: je.sourceDocumentId, description: je.description?.slice(0, 60) });
    for (const l of je.lines) console.log(`   ${l.account?.code} ${l.account?.name}  Dr ${l.debit}  Cr ${l.credit}`);
  }

  const byDoc = await p.journalEntry.findMany({ where: { sourceDocumentId: DOC } });
  console.log(`\nJEs with sourceDocumentId=${DOC}: ${byDoc.length}`);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
