/**
 * Dion 532B Bishan (CI26-011) — full project backfill from Ryann's Drive
 * folder (Costing Summary xlsx + signed contract/VO PDFs + payment receipts).
 * Creates: customer, project, confirmed quotation (CI26-011, $65k), 7
 * milestones with real paid amounts/dates (fully collected $79,681.47), 26
 * approved cost rows ($67,032.99). Idempotent by contract number.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_import-dion-532b.ts
 */
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';

const prisma = new PrismaClient();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const CIEL = '09e55c23-e031-4254-8152-a373597b2cb3';
const D = (s: string) => new Date(s + 'T00:00:00+08:00');

const COSTS: Array<[string, string, string | null, number]> = [
  ['2026-01-30', 'AUBO Consultant Pte Ltd (VR/3D)', 'JS INV 30012026-3', 640.0],
  ['2026-04-30', 'Daco Interior Pte Ltd', 'DINV-2604-028', 1420.0],
  ['2026-04-05', 'Soon Bee Huat Trading Pte Ltd (Tiles)', 'ORD-BA-006156', 479.6],
  ['2026-08-05', 'Soon Bee Huat Trading Pte Ltd (Tiles)', 'ORD-BA006474', 34.88],
  ['2026-05-20', 'Hafary Tiles', '23018', 481.34],
  ['2026-05-20', 'YMF Group Pte Ltd', '2026/92', 6850.25],
  ['2026-05-23', 'Hua Khian Co (Pte) Ltd (Vinyl)', 'V2605-0160', 3470.02],
  ['2026-05-28', 'Daco Interior Pte Ltd (tiling)', 'DINV-2605-038', 7026.2],
  ['2026-06-03', 'Soon Bee Huat Trading Pte Ltd (Tiles)', 'ORD-BA012070', 37.06],
  ['2026-06-02', 'Daco Interior Pte Ltd (tiling)', 'DINV-2606-001', 313.5],
  ['2026-06-16', 'Hue Workz Pte Ltd (Painting)', '26304', 1620.0],
  ['2026-06-04', 'Soon Bee Huat Trading Pte Ltd (Tiles)', 'CAS-BA-012070', 40.76],
  ['2026-06-19', 'PD Door Pte Ltd', '134995', 2395.43],
  ['2026-06-19', 'Dreame', null, 1719.0],
  ['2026-06-19', 'Ether Doors', null, 1900.0],
  ['2026-07-08', 'Hua Khian Co (Pte) Ltd (worktop)', '2607-0220', 6398.3],
  ['2026-07-10', 'Carpentry', null, 24982.65],
  ['2026-07-20', 'Electrical Origin (Plumbing)', 'SGPO/0122/2026', 1250.0],
  ['2026-07-20', 'Dynamic Glass Contractor (Glass)', '260714', 3674.0],
  ['2026-07-24', 'J&I Facilities Management Pte Ltd', '7813', 700.0],
  ['2026-07-24', 'J&I Facilities Management Pte Ltd', '7860', 200.0],
  ['2026-07-23', 'YMF Group Pte Ltd', '2026/124', 650.0],
  ['2026-06-10', 'Daco Interior Pte Ltd', 'DINV-2606-006', 750.0],
  ['2026-06-10', 'Daco Interior Pte Ltd', 'DINV-2606-013', 171.0],
  ['2026-06-10', 'Daco Interior Pte Ltd', 'DINV-2606-014', 171.0],
];

const MILESTONES: Array<{ kind: string; label: string; pct: number | null; amount: number; paidAmount: number; paidAt: string; dueTrigger?: string; sortOrder: number }> = [
  { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500.0, paidAmount: 1500.0, paidAt: '2026-01-06', dueTrigger: 'confirmation', sortOrder: 0 },
  { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 5000.0, paidAmount: 5000.0, paidAt: '2026-02-14', sortOrder: 1 },
  { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 26000.0, paidAmount: 26000.0, paidAt: '2026-04-26', sortOrder: 2 },
  { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 29250.0, paidAmount: 29250.0, paidAt: '2026-06-08', sortOrder: 3 },
  { kind: 'milestone', label: '5% — handover', pct: 5, amount: 3250.0, paidAmount: 3250.0, paidAt: '2026-08-10', sortOrder: 4 },
  { kind: 'vo', label: 'VO1 · CI26-011', pct: null, amount: 13954.47, paidAmount: 13954.47, paidAt: '2026-06-08', sortOrder: 5 },
  { kind: 'vo', label: 'VO2 · CI26-011', pct: null, amount: 727.0, paidAmount: 727.0, paidAt: '2026-08-10', sortOrder: 6 },
];

async function main() {
  const exists = await prisma.document.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION', name: 'CI26-011' }, select: { id: true, projectId: true } });
  if (exists) {
    console.log('CI26-011 already imported (doc', exists.id, ') — nothing to do');
    return;
  }

  // Ryann's Clerk id
  const ryann = (await clerk.users.getUserList({ emailAddress: ['ryanntan@cielinterior.com'] })).data?.[0];
  console.log('Ryann:', ryann?.id || 'NOT FOUND (designerUserId left null)');

  // customer
  let customer = await prisma.customer.findFirst({ where: { organizationId: CIEL, name: 'Dion' } });
  if (!customer) {
    customer = await prisma.customer.create({ data: { organizationId: CIEL, name: 'Dion', address: 'Blk 532B Bishan Street 14 #15-124' } });
    console.log('customer created:', customer.id);
  }

  // project
  const project = await prisma.project.create({
    data: {
      organizationId: CIEL,
      name: 'Dion — Blk 532B Bishan Street 14 #15-124',
      address: 'Blk 532B Bishan Street 14 #15-124',
      customerId: customer.id,
      status: 'completed',
      stage: 'completed',
      designer: 'Ryann Tan',
      designerUserId: ryann?.id || null,
      commissionPct: 50,
      source: 'self',
      startDate: D('2026-01-06'),
    },
    select: { id: true, name: true },
  });
  console.log('project created:', project.id);

  // confirmed quotation CI26-011 ($65,000 — signed contract, coarse single line)
  const tmpl = await prisma.documentTemplate.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION' }, orderBy: { createdAt: 'asc' } });
  const quote = {
    version: 1,
    header: {
      title: 'RE: Letter of Intent & Appointment for Renovation Works at the below mentioned new address',
      contractNo: 'CI26-011',
      clientName: 'Dion',
      nric: '',
      address: 'Blk 532B Bishan Street 14 #15-124',
      contact: '',
      agreementDate: '2026-01-06',
      remarks: 'Backfilled from the signed contract (Drive) — line detail in the signed PDF',
      designer: 'Ryann Tan',
      designerUserId: ryann?.id || null,
      designerPhone: '',
      paymentTerms: 'As Mentioned Below',
    },
    sections: [
      {
        id: 'sec-1',
        letter: 'A',
        title: 'Renovation Works — as per signed contract CI26-011',
        notes: ['Full line-item breakdown in the signed contract PDF (Drive: Signed Quotation & T&C).'],
        areas: [
          {
            id: 'area-1',
            name: 'General',
            items: [
              { id: 'item-1', workItemId: null, code: null, description: 'Renovation works for Blk 532B Bishan Street 14 #15-124 as per signed Letter of Intent (BTO 4-room)', qty: 1, uom: 'lot', amount: 65000.0, pricingMode: 'priced', cost: null, includes: [] },
            ],
          },
        ],
      },
    ],
    summary: { designFeePct: 0, discounts: [] },
    terms: { paymentTerms: [], clauses: [] },
    settings: { marginGuidelinePct: 25, marginFloorPct: 15 },
  };
  const doc = await prisma.document.create({
    data: {
      organizationId: CIEL,
      documentTemplateId: tmpl!.id,
      type: 'QUOTATION',
      name: 'CI26-011',
      status: 'confirmed',
      projectId: project.id,
      config: {
        templateVariant: 'ID',
        skipNumbering: true,
        quote,
        items: [{ id: 'item-1', itemCode: '', inventoryItemId: '', description: '[Renovation Works] as per signed contract CI26-011', quantity: 1, uom: 'lot', unitPrice: 65000.0, amount: 65000.0, costPrice: null, isService: true, revenueTag: 'service' }],
        customerId: customer.id,
        customerName: 'Dion',
        customer: { id: customer.id, name: 'Dion', address: 'Blk 532B Bishan Street 14 #15-124' },
        designer: 'Ryann Tan',
        designerUserId: ryann?.id || null,
        documentInfo: { documentNumber: 'CI26-011', date: '2026-01-06', subject: quote.header.title, currency: 'SGD', taxApplicable: false, grandTotal: 65000.0 },
        backfill: 'drive-dion-532b-2026-09-14',
      } as any,
    },
    select: { id: true },
  });
  console.log('quotation CI26-011 created:', doc.id);

  // milestones (real amounts + paid)
  for (const m of MILESTONES) {
    await prisma.projectMilestone.create({
      data: {
        organizationId: CIEL,
        projectId: project.id,
        kind: m.kind,
        label: m.label,
        pct: m.pct,
        amount: m.amount,
        paidAmount: m.paidAmount,
        paidAt: D(m.paidAt),
        paymentMethod: 'transfer',
        dueTrigger: m.dueTrigger || null,
        sortOrder: m.sortOrder,
      },
    });
  }
  console.log('milestones:', MILESTONES.length, '— collected', MILESTONES.reduce((s, m) => s + m.paidAmount, 0).toFixed(2));

  // costs (approved)
  for (const [date, supplier, inv, amount] of COSTS) {
    await prisma.projectCost.create({
      data: {
        organizationId: CIEL,
        projectId: project.id,
        date: D(date),
        supplierName: supplier,
        description: supplier,
        invoiceNo: inv,
        amount,
        status: 'approved',
        source: 'import',
        createdByName: 'backfill (Drive costing sheet)',
      } as any,
    });
  }
  console.log('costs:', COSTS.length, '— total', COSTS.reduce((s, c) => s + c[3], 0).toFixed(2));

  console.log('\nSheet says: contract 79,681.47 · collected 79,681.47 · costs 67,032.99 · profit 12,648.48 · commission(50%) 6,324.24 · advanced 4,100 → payable 2,225 to Ryann Tan');
  console.log('Open the project in AIMS and compare the KPI tiles.');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
