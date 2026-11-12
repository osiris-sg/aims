/**
 * Header-discount GL fix (2026-11-12): find live INVOICE journals that carry
 * the old DEBIT "Sales (unmapped)" plug (an invoice with a header discount and
 * per-line revenue accounts) and repost them through the app's own poster
 * (DocumentsService.repostGlForDocument: void in place + post fresh, now with
 * the discount spread over the line accounts). Dry run by default.
 *
 *   npx ts-node --transpile-only -r tsconfig-paths/register scripts/repost-discount-plug-journals.ts [--apply]
 *
 * DEV ONLY: it boots the app context (crons included), so it refuses the prod
 * database. On prod the same search is a read-only query; it found none.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { DocumentsService } from '../src/documents/documents.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

const apply = process.argv.includes('--apply');

(async () => {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) throw new Error('Dev only: DATABASE_URL must be the dev database');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma: any = app.get(PrismaService);
  const documents = app.get(DocumentsService);
  try {
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
    let found = 0;
    for (const org of orgs) {
      await runAsOrg(org.id, async () => {
        const jes = await prisma.journalEntry.findMany({
          where: {
            organizationId: org.id,
            type: 'INVOICE',
            status: { not: 'VOID' },
            sourceDocumentId: { not: null },
            lines: { some: { debit: { gt: 0 }, description: { startsWith: 'Sales (unmapped)' } } },
          },
          select: { id: true, journalNumber: true, totalDebit: true, sourceDocumentId: true },
        });
        for (const je of jes) {
          const doc = await prisma.document.findFirst({ where: { id: je.sourceDocumentId, organizationId: org.id }, select: { id: true, name: true, type: true, status: true, config: true } });
          if (!doc) continue;
          found++;
          const c: any = doc.config || {};
          console.log(`${org.name}: ${doc.name} (${doc.status}) ${je.journalNumber} total ${Number(je.totalDebit).toFixed(2)} vs invoice ${c.totalWithTax ?? c.nettTotal} (discount ${c.discountAmount ?? c.documentInfo?.discountAmount ?? 0})`);
          if (!apply) continue;
          await documents.repostGlForDocument(org.id, doc.id, doc.type, doc.config, doc.name);
          const now = await prisma.journalEntry.findFirst({
            where: { organizationId: org.id, sourceDocumentId: doc.id, type: 'INVOICE', status: { not: 'VOID' } },
            select: { journalNumber: true, totalDebit: true, lines: { select: { description: true, debit: true, credit: true } } },
          });
          console.log(`   -> ${je.journalNumber} voided; ${now?.journalNumber ?? 'no entry'} total ${Number(now?.totalDebit ?? 0).toFixed(2)}`);
          for (const l of now?.lines ?? []) console.log(`      ${l.description}: Dr ${Number(l.debit).toFixed(2)} Cr ${Number(l.credit).toFixed(2)}`);
        }
      });
    }
    console.log(`${found} journal(s) with a debit plug. ${apply ? 'Reposted.' : 'Dry run. Pass --apply to repost.'}`);
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
