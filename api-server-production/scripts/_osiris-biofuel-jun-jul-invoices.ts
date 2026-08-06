/**
 * Create the June + July 2026 Biofuel maintenance invoices in AIMS.
 *
 * Rates and line wording follow INV-059 / INV-060 (the Apr + May 2026
 * invoices raised on 21 Jun 2026): ESS @ SGD 20.00/unit, SIDS @ SGD 9.00/unit.
 * ECM is deliberately NOT charged (guru, 2026-08-04).
 *
 * Run dry:   npx ts-node --transpile-only scripts/_osiris-biofuel-jun-jul-invoices.ts .env.production
 * Apply:     ... .env.production --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env.production';
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';
const TEMPLATE = 'bfa46b89-7619-454d-bc9a-303b909241c3'; // Invoice (TI2 Variant), Osiris, active
const CUSTOMER_ID = '520d7e74-16fb-4977-9603-6b2bfcf13f29';
const ISSUE_DATE = '2026-08-04';

const ESS_RATE = 20.0;
const SIDS_RATE = 9.0;

// Active units per month — supplied by guru 2026-08-04.
const MONTHS = [
  { label: 'June 2026', number: 'TI2202608-001', ess: 121, sids: 22 },
  { label: 'July 2026', number: 'TI2202608-002', ess: 150, sids: 20 },
];

const COMPANY = {
  name: 'Osiris Technology Pte. Ltd.',
  address: '71 Ayer Rajah Crescent, #04-01, Singapore 139951',
  phoneNumber: '91151041',
};

const round = (n: number) => Math.round(n * 100) / 100;

function buildConfig(mo: (typeof MONTHS)[number]) {
  const base = Date.now();
  const items = [
    {
      id: base,
      amount: round(mo.ess * ESS_RATE),
      itemCode: '',
      quantity: mo.ess,
      isService: true,
      unitPrice: ESS_RATE,
      revenueTag: 'service',
      description: `ESS Maintenance for ${mo.label}`,
      inventoryItemId: '',
    },
    {
      id: base + 1,
      amount: round(mo.sids * SIDS_RATE),
      itemCode: '',
      quantity: mo.sids,
      isService: true,
      unitPrice: SIDS_RATE,
      revenueTag: 'service',
      description: `SIDS Maintenance for ${mo.label}`,
      inventoryItemId: '',
    },
  ];
  const total = round(items.reduce((s, i) => s + i.amount, 0));
  return {
    config: {
      date: ISSUE_DATE,
      doNo: '',
      note: '',
      poNo: '',
      rate: 1,
      billTo: '',
      qinRef: '',
      company: COMPANY,
      contact: '',
      dueDate: ISSUE_DATE,
      issueBy: '',
      remarks: '',
      currency: 'SGD',
      gstRegNo: '202410096C',
      subTotal: total,
      absorbTax: 'N',
      attention: { name: '', email: '', phoneNumber: '' },
      gstAmount: 0,
      items,
      nettTotal: total,
      customerId: CUSTOMER_ID,
      deliveryTo: '',
      grossTotal: total,
      gstPercent: 9,
      collectFrom: '',
      referenceNo: '',
      salesMobile: '',
      salesPerson: '',
      customerCode: 'CB001',
      customerName: 'Biofuel Industries Pte. Ltd.',
      paymentTerms: '0 DAYS',
      agreementText: '',
      customerEmail: 'eugene@biofuelindustries.sg',
      footerMessage: '',
      taxApplicable: 'N',
      discountAmount: 0,
      documentNumber: mo.number,
      customerAddress: '22 Tuas Avenue 2, Singapore, 639453',
      discountPercent: 0,
      sourceDocumentId: '',
      sourceDocumentType: '',
      termsAndConditions: '',
      sourceDocumentNumber: '',
    },
    total,
  };
}

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====`);

  const clash = await prisma.document.findMany({
    where: { organizationId: ORG, name: { in: MONTHS.map((m) => m.number) } },
    select: { name: true },
  });
  if (clash.length) {
    console.log('ABORT — these numbers already exist:', clash.map((c: any) => c.name).join(', '));
    return;
  }

  for (const mo of MONTHS) {
    const { config, total } = buildConfig(mo);
    console.log(`\n${mo.number}  —  ${mo.label}  (dated ${ISSUE_DATE})`);
    (config.items as any[]).forEach((i) =>
      console.log(
        `   ${i.description.padEnd(34)} ${String(i.quantity).padStart(4)} x ${i.unitPrice.toFixed(2)} = ${i.amount.toFixed(2).padStart(9)}`,
      ),
    );
    console.log(`   ${'TOTAL'.padEnd(34)} ${total.toFixed(2)}`);

    if (!APPLY) continue;
    const doc = await prisma.document.create({
      data: {
        organizationId: ORG,
        documentTemplateId: TEMPLATE,
        type: 'INVOICE',
        name: mo.number,
        status: 'unconfirmed',
        config: config as any,
      },
    });
    console.log(`   created id=${doc.id}`);
  }
  if (!APPLY) console.log('\n(dry run — nothing written; re-run with --apply)');
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
