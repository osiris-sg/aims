/**
 * Give an org the bank-series Official Receipt + Payment Voucher number
 * formats Heimen asked for (SCBOR2610-001 / SCBPV2610-001; UOB… for the UOB
 * bank): pattern {BANK}{DOC}{YY}{MM}-{###}, monthly reset. Any other ACTIVE
 * variant of those two types is switched off (e.g. Biofuel's seeded
 * "Payment Voucher / Default" = PV{YYYY}{MM}-{####}, which is where the 0001
 * came from). Idempotent.
 *
 *   npx ts-node --transpile-only scripts/set-or-pv-number-formats.ts --env prod --org Biofuel            # dry run
 *   npx ts-node --transpile-only scripts/set-or-pv-number-formats.ts --env prod --org Biofuel --apply
 *
 * Prod/staging lag dev's schema — every Prisma call uses an explicit select.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const env = opt('--env') || 'dev';
const orgName = opt('--org') || 'Biofuel';
const apply = args.includes('--apply');
const envFile = env === 'prod' ? '.env.production' : env === 'staging' ? '.env.staging' : '.env';
dotenv.config({ path: path.join(__dirname, '..', envFile), override: true });
if (env === 'dev' && process.env.TENANCY_MODE === 'per-org') {
  console.error('dev is schema-per-org — run this against staging/prod, or set the formats in Accounting Setup on dev');
  process.exit(2);
}

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const PATTERN = '{BANK}{DOC}{YY}{MM}-{###}';
const LABEL = 'Bank series';

(async () => {
  const org = await prisma.organization.findFirst({
    where: { name: { contains: orgName, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!org) throw new Error(`org "${orgName}" not found on ${env}`);
  console.log(`${env} · ${org.name}${apply ? '' : ' · DRY RUN'}`);
  for (const documentType of ['OFFICIAL_RECEIPT', 'PAYMENT_VOUCHER']) {
    const rows = await prisma.documentNumberFormat.findMany({
      where: { organizationId: org.id, documentType },
      select: { id: true, label: true, pattern: true, isActive: true, resetPolicy: true },
    });
    const mine = rows.find((r) => r.pattern === PATTERN);
    for (const r of rows) {
      if (mine && r.id === mine.id) continue;
      if (r.isActive) {
        console.log(`  ${documentType}: switch OFF "${r.label}" (${r.pattern})`);
        if (apply) await prisma.documentNumberFormat.update({ where: { id: r.id }, data: { isActive: false }, select: { id: true } });
      }
    }
    if (mine) {
      console.log(`  ${documentType}: keep "${mine.label}" (${mine.pattern}) active=${mine.isActive} reset=${mine.resetPolicy}`);
      if (apply && (!mine.isActive || mine.resetPolicy !== 'monthly')) {
        await prisma.documentNumberFormat.update({ where: { id: mine.id }, data: { isActive: true, resetPolicy: 'monthly' }, select: { id: true } });
      }
    } else {
      console.log(`  ${documentType}: create "${LABEL}" ${PATTERN} monthly`);
      if (apply) {
        await prisma.documentNumberFormat.create({
          data: { organizationId: org.id, documentType, label: LABEL, pattern: PATTERN, nextSerial: 1, resetPolicy: 'monthly', isActive: true, sortOrder: 0 },
          select: { id: true },
        });
      }
    }
  }
  console.log(apply ? 'done' : 'dry run — add --apply to write');
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
