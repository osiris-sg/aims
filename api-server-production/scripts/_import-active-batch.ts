/**
 * CIEL active-projects backfill (batch 3) — the six jobs in Ryann's Drive
 * "Projects " folder: Serena (Normanton Park), SK 694B (referral), Cathrine
 * (referral, BTO 2rm), Ted 584 Pasir Ris, Eelin 513A, Xin Yi 936D Yishun.
 * Same pattern as _import-dion-532b.ts / _import-completed-batch.ts, but
 * status 'ongoing' with a real stage, unpaid milestones keep paidAmount 0,
 * and unlabelled lump-sum "estimated costing" rows go in as status 'pending'.
 * Idempotent per quotation name. Prints computed totals for review (active
 * sheets are living documents — no hard assertions).
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_import-active-batch.ts
 */
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';

const prisma = new PrismaClient();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const CIEL = '09e55c23-e031-4254-8152-a373597b2cb3';
const D = (s: string | null) => (s ? new Date(s + 'T00:00:00+08:00') : null);

type Cost = { date: string | null; supplier: string; inv: string | null; amount: number; status?: string; notes?: string };
type Milestone = { kind: string; label: string; pct: number | null; amount: number; paidAmount: number; paidAt: string | null; paymentMethod?: string | null; dueTrigger?: string; notes?: string };
type Proj = {
  docName: string; // quotation name (contract no where known) — idempotency key
  contractNo: string;
  reviewNote: string; // shown on the dashboard "Project notes" card for the owner to check
  customer: { name: string; address: string; phone?: string };
  projectName: string;
  address: string;
  stage: string;
  source: string;
  commissionPct: number;
  startDate: string;
  agreementDate: string;
  initialSum: number;
  summaryLine: string;
  milestones: Milestone[];
  costs: Cost[];
};

const PROJECTS: Proj[] = [
  {
    // Costing sheet says "CI26-303" but that is Ted's number (copy-paste) and
    // the signed quote PDF has Contract Number blank — real number pending.
    docName: 'Serena — 57 Normanton Park #24-55',
    reviewNote: 'Backfilled from Drive. Check: contract number missing — the costing sheet shows CI26-303, which is Ted\'s number. Contract sum $76,000 taken from the signed quote rev1. Only the $1,500 engagement fee is recorded as collected (receipt 22/06/2026).',
    contractNo: '',
    customer: { name: 'Serena', address: '57 Normanton Park #24-55, Singapore 117284' },
    projectName: 'Serena — 57 Normanton Park #24-55',
    address: '57 Normanton Park #24-55, Singapore 117284',
    stage: 'design',
    source: 'self',
    commissionPct: 50,
    startDate: '2026-06-22',
    agreementDate: '2026-06-21',
    initialSum: 76000,
    summaryLine: 'Renovation works for 57 Normanton Park #24-55 as per signed quotation rev1 ($76,000)',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: '2026-06-22', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 6100, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 30400, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '25% — carpentry fabrication', pct: 25, amount: 19000, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '20% — carpentry installation', pct: 20, amount: 15200, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 3800, paidAmount: 0, paidAt: null },
    ],
    costs: [],
  },
  {
    docName: 'CI26-403',
    reviewNote: 'Backfilled from Drive. Check: the payment schedule is typed on the sheet but only the EF has a date and the receipts folder is empty — only the $1,500 EF is recorded as collected; confirm actual collections. Contract sum $69,300 derived from the schedule (the sheet\'s contract cell is empty). Commission 60% per sheet — confirm. $57,500 estimated costing kept as a pending cost.',
    contractNo: 'CI26-403',
    customer: { name: 'SK', address: '' },
    projectName: 'SK — 694B (Resale 4rm)',
    address: 'Blk 694B (resale 4-room)',
    stage: 'design',
    source: 'referral',
    commissionPct: 60,
    startDate: '2026-04-23',
    agreementDate: '2026-04-23',
    initialSum: 69300,
    summaryLine: 'Renovation works for Blk 694B (resale 4-room) as per signed contract CI26-403',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: '2026-04-23', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 5430, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 27720, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 31185, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 3465, paidAmount: 0, paidAt: null },
    ],
    costs: [
      { date: '2026-06-11', supplier: 'AUBO Consultant Pte Ltd (VR)', inv: 'JS INV 14052026-4', amount: 800 },
      { date: null, supplier: 'Estimated costing (unlabelled row on sheet)', inv: null, amount: 57500, status: 'pending', notes: 'Lump-sum estimate from the costing sheet — not an actual invoice' },
    ],
  },
  {
    docName: 'CI26-501',
    reviewNote: 'Backfilled from Drive. Check: payment dates on the sheet say 2022 (year typos) — read as 2026; the 15% ($1,260) and VO1 ($2,900) payment dates were unreadable and left blank. Sheet shows fully collected ($11,300).',
    contractNo: 'CI26-501',
    customer: { name: 'Cathrine', address: '' },
    projectName: 'Cathrine (BTO 2rm)',
    address: '',
    stage: 'carpentry',
    source: 'referral',
    commissionPct: 50,
    startDate: '2026-04-18',
    agreementDate: '2026-04-18',
    initialSum: 8400,
    summaryLine: 'Renovation works (BTO 2-room) as per signed contract CI26-501',
    milestones: [
      { kind: 'milestone', label: '20% — deposit', pct: 20, amount: 1680, paidAmount: 1680, paidAt: '2026-04-18', paymentMethod: 'transfer', dueTrigger: 'confirmation', notes: 'Sheet shows 18/04/2022 — year typo, read as 2026' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 3360, paidAmount: 3360, paidAt: '2026-04-18', paymentMethod: 'transfer', notes: 'Sheet shows 18/04/2022 — year typo, read as 2026' },
      { kind: 'milestone', label: '20% — carpentry fabrication', pct: 20, amount: 1680, paidAmount: 1680, paidAt: '2026-04-18', paymentMethod: 'transfer', notes: 'Sheet shows 18/04/2022 — year typo, read as 2026' },
      { kind: 'milestone', label: '15% — carpentry installation', pct: 15, amount: 1260, paidAmount: 1260, paidAt: null, paymentMethod: 'transfer', notes: 'Paid per sheet; date cell unreadable (2022 serial)' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 420, paidAmount: 420, paidAt: '2026-05-18', paymentMethod: 'transfer', notes: 'Sheet shows 18/05/2022 — year typo, read as 2026' },
      { kind: 'vo', label: 'VO1 · CI26-501', pct: null, amount: 2900, paidAmount: 2900, paidAt: null, paymentMethod: 'transfer', notes: 'Paid per sheet; date cell unreadable' },
    ],
    costs: [
      { date: '2026-08-13', supplier: 'Daco Interior Pte Ltd (Hacking)', inv: 'DINV-2608-026', amount: 360 },
      { date: '2026-08-20', supplier: 'Hafary Pte Ltd (Tiles)', inv: '1999869', amount: 140.45 },
      { date: '2026-09-01', supplier: 'PD Door Pte Ltd', inv: '137321', amount: 438.83 },
      { date: '2026-09-04', supplier: 'Dynamic Glass Contractor', inv: '260913', amount: 2040 },
      { date: '2026-08-27', supplier: 'Daco Interior Pte Ltd (Hacking)', inv: 'DINV-2608-045', amount: 80 },
      { date: '2026-09-02', supplier: 'YMF Group Pte Ltd', inv: '2026/145', amount: 250 },
      { date: '2026-09-12', supplier: 'Carpentry', inv: null, amount: 1300 },
      { date: '2026-09-08', supplier: 'Hua Khian Co (Pte) Ltd', inv: '2609-0259', amount: 784.8 },
      { date: null, supplier: 'Plumbing', inv: null, amount: 600, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Cleaning', inv: null, amount: 220, notes: 'No date on costing sheet' },
    ],
  },
  {
    docName: 'CI26-303',
    reviewNote: 'Backfilled from Drive. Check: Hafary invoice 1980474 is entered twice on the sheet ($678.15 each) — both kept, confirm it isn\'t double-counted. $200 refund excess has no date. VO1 $32,519.61 not yet collected. 20% and 5% milestones outstanding.',
    contractNo: 'CI26-303',
    customer: { name: 'Ted', address: 'Blk 584 Pasir Ris St 53 #12-33' },
    projectName: 'Ted — Blk 584 Pasir Ris St 53 #12-33',
    address: 'Blk 584 Pasir Ris St 53 #12-33',
    stage: 'carpentry',
    source: 'self',
    commissionPct: 50,
    startDate: '2026-03-30',
    agreementDate: '2026-03-30',
    initialSum: 131400,
    summaryLine: 'Renovation works for Blk 584 Pasir Ris St 53 #12-33 (resale EA) as per signed contract CI26-303',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: '2026-04-02', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 11640, paidAmount: 11640, paidAt: '2026-06-01', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 58200, paidAmount: 58200, paidAt: '2026-06-21', paymentMethod: 'cheque', notes: 'Bank loan — two cheques of $29,100' },
      { kind: 'milestone', label: '25% — carpentry fabrication', pct: 25, amount: 27210, paidAmount: 27210, paidAt: '2026-08-11', paymentMethod: 'transfer', notes: '$32,850 less $5,640 cheque overpayment' },
      { kind: 'milestone', label: '20% — carpentry installation', pct: 20, amount: 26280, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 6570, paidAmount: 0, paidAt: null },
      { kind: 'vo', label: 'VO1 · CI26-303', pct: null, amount: 32519.61, paidAmount: 0, paidAt: null },
      { kind: 'refund', label: 'Refund excess', pct: null, amount: 200, paidAmount: 200, paidAt: null, notes: 'Refund excess (1st) per costing sheet' },
    ],
    costs: [
      { date: '2026-05-08', supplier: 'VK3D Visualization Pte Ltd (VR)', inv: 'VK19298', amount: 720 },
      { date: '2026-06-12', supplier: 'Hafary Private Limited', inv: '1972957', amount: 13246.89 },
      { date: '2026-06-16', supplier: 'Daco Interior Pte Ltd (Hacking)', inv: 'DINV-2606-019', amount: 5665 },
      { date: '2026-07-02', supplier: 'Hafary Private Limited', inv: '1980474', amount: 678.15 },
      { date: '2026-08-06', supplier: 'Hua Khian Co (Pte) Ltd', inv: 'V2608-0031', amount: 2697.75 },
      { date: '2026-07-06', supplier: 'Yan Ho Aluminium', inv: 'YH07006', amount: 3745.45 },
      { date: '2026-07-02', supplier: 'Hafary Private Limited', inv: '1980474', amount: 678.15, notes: 'Invoice 1980474 appears twice on the sheet (both counted in its total)' },
      { date: '2026-07-18', supplier: 'Hafary Private Limited', inv: '1986900', amount: 688.77 },
      { date: '2026-07-17', supplier: 'Hafary Private Limited', inv: '1986455', amount: 1718.88 },
      { date: '2026-07-20', supplier: 'Daco Interior Pte Ltd (Tiling)', inv: 'DINV-2607-033', amount: 19427.5 },
      { date: '2026-08-01', supplier: 'YMF Group Pte Ltd', inv: '2026/132', amount: 7979.45 },
      { date: '2026-08-01', supplier: 'YMF Group Pte Ltd', inv: '2026/136', amount: 480, notes: 'Sheet date typo "0/08/2026" — day unknown, set to 01/08/2026' },
      { date: '2026-08-01', supplier: 'Hafary Private Limited', inv: '1992498', amount: 234.82 },
      { date: '2026-08-07', supplier: 'Totoman (Conceal Door)', inv: 'TOT_G0136', amount: 4097 },
      { date: '2026-08-12', supplier: 'Hue Workz Pte Ltd', inv: '26411', amount: 5400 },
      { date: '2026-09-05', supplier: 'Electrical Origin', inv: 'SGPO/0148/2026', amount: 3590 },
      { date: null, supplier: 'Cleaning', inv: null, amount: 330, notes: 'No date on costing sheet' },
      { date: '2026-08-27', supplier: 'Hua Khian Co (Pte) Ltd', inv: '2608-0680AI', amount: 13101.8 },
      { date: '2026-09-01', supplier: 'Dynamic Glass Contractor', inv: '260904', amount: 1380 },
      { date: '2026-09-12', supplier: 'Carpentry', inv: null, amount: 40000 },
      { date: '2026-08-31', supplier: 'YMF Group Pte Ltd', inv: '2026/142', amount: 630 },
      { date: null, supplier: 'Fabric glass', inv: null, amount: 4000, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Taobao', inv: null, amount: 3500, notes: 'No date on costing sheet' },
      { date: '2026-08-28', supplier: 'PRO+ELEMENTS PTE. LTD', inv: 'PRO-001377/08', amount: 1043.61 },
      { date: null, supplier: 'Dreame', inv: null, amount: 1599, notes: 'No date on costing sheet' },
    ],
  },
  {
    docName: 'CI26-0201',
    reviewNote: 'Backfilled from Drive. Check: the sheet\'s Total Costing formula skips the Daco $3,125 row (sheet $53,350.96 vs rows $56,475.96). $51,510 unlabelled estimate kept as a pending cost. 40%/45%/5% milestones outstanding.',
    contractNo: 'CI26-0201',
    customer: { name: 'Eelin', address: '' },
    projectName: 'Eelin — 513A #12-375 (Resale 4rm)',
    address: 'Blk 513A #12-375 (resale 4-room)',
    stage: 'works',
    source: 'self',
    commissionPct: 50,
    startDate: '2026-02-05',
    agreementDate: '2026-02-05',
    initialSum: 56239,
    summaryLine: 'Renovation works for Blk 513A #12-375 (resale 4-room) as per signed contract CI26-0201',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: '2026-02-05', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 4123.9, paidAmount: 4123.9, paidAt: '2026-04-01', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 22495.6, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 25307.55, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 2811.95, paidAmount: 0, paidAt: null },
    ],
    costs: [
      { date: '2026-08-18', supplier: 'Daco Interior Pte Ltd', inv: 'DINV-2608-034', amount: 3125 },
      { date: '2026-08-17', supplier: 'Hafary Pte Ltd (Tiles)', inv: '1996382', amount: 1840.96 },
      { date: null, supplier: 'Estimated costing (unlabelled row on sheet)', inv: null, amount: 51510, status: 'pending', notes: 'Lump-sum estimate from the costing sheet — not an actual invoice' },
    ],
  },
  {
    docName: 'CI25-082',
    reviewNote: 'Backfilled from Drive. Check: no activity on the sheet since Sep 2025 (10% collected, $462 costs) — confirm the project is still live.',
    contractNo: 'CI25-082',
    customer: { name: 'Xin Yi', address: 'Block 936D Yishun Central 1 #11-168, Singapore 764936' },
    projectName: 'Xin Yi — Block 936D Yishun Central 1 #11-168',
    address: 'Block 936D Yishun Central 1 #11-168, Singapore 764936',
    stage: 'design',
    source: 'self',
    commissionPct: 50,
    startDate: '2025-08-28',
    agreementDate: '2025-08-28',
    initialSum: 39000,
    summaryLine: 'Renovation works for Block 936D Yishun Central 1 #11-168 (BTO 4-room) as per signed contract CI25-082',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1000, paidAmount: 1000, paidAt: '2025-08-28', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 2900, paidAmount: 2900, paidAt: '2025-09-14', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '50% — commencement of work', pct: 50, amount: 19500, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '35% — carpentry fabrication', pct: 35, amount: 13650, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 1950, paidAmount: 0, paidAt: null },
    ],
    costs: [
      { date: '2025-09-05', supplier: 'CoopnTech (3D)', inv: 'INV-IDS5888', amount: 385 },
      { date: '2025-09-27', supplier: 'CoopnTech (3D)', inv: 'INV-IDS5888A', amount: 77 },
    ],
  },
];

async function importOne(p: Proj, ryannId: string | null, tmplId: string) {
  const exists = await prisma.document.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION', name: p.docName }, select: { id: true } });
  if (exists) {
    console.log(`↷ ${p.docName} already imported (doc ${exists.id}) — skipped`);
    return;
  }

  let customer = await prisma.customer.findFirst({ where: { organizationId: CIEL, name: p.customer.name } });
  if (!customer) {
    customer = await prisma.customer.create({ data: { organizationId: CIEL, name: p.customer.name, address: p.customer.address || null, phone: p.customer.phone || null } });
  }

  const project = await prisma.project.create({
    data: {
      organizationId: CIEL,
      name: p.projectName,
      address: p.address || null,
      description: p.reviewNote,
      customerId: customer.id,
      status: 'ongoing',
      stage: p.stage,
      designer: 'Ryann Tan',
      designerUserId: ryannId,
      commissionPct: p.commissionPct,
      source: p.source,
      startDate: D(p.startDate)!,
    },
    select: { id: true },
  });

  const quote = {
    version: 1,
    header: {
      title: 'RE: Letter of Intent & Appointment for Renovation Works at the below mentioned new address',
      contractNo: p.contractNo,
      clientName: p.customer.name,
      nric: '',
      address: p.address,
      contact: p.customer.phone || '',
      agreementDate: p.agreementDate,
      remarks: 'Backfilled from the signed contract (Drive) — line detail in the signed PDF',
      designer: 'Ryann Tan',
      designerUserId: ryannId,
      designerPhone: '',
      paymentTerms: 'As Mentioned Below',
    },
    sections: [
      {
        id: 'sec-1',
        letter: 'A',
        title: `Renovation Works — as per signed contract${p.contractNo ? ' ' + p.contractNo : ''}`,
        notes: ['Full line-item breakdown in the signed contract PDF (Drive: Signed Quotation & T&C).'],
        areas: [
          {
            id: 'area-1',
            name: 'General',
            items: [{ id: 'item-1', workItemId: null, code: null, description: p.summaryLine, qty: 1, uom: 'lot', amount: p.initialSum, pricingMode: 'priced', cost: null, includes: [] }],
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
      documentTemplateId: tmplId,
      type: 'QUOTATION',
      name: p.docName,
      status: 'confirmed',
      projectId: project.id,
      config: {
        templateVariant: 'ID',
        skipNumbering: true,
        quote,
        items: [{ id: 'item-1', itemCode: '', inventoryItemId: '', description: `[Renovation Works] as per signed contract${p.contractNo ? ' ' + p.contractNo : ''}`, quantity: 1, uom: 'lot', unitPrice: p.initialSum, amount: p.initialSum, costPrice: null, isService: true, revenueTag: 'service' }],
        customerId: customer.id,
        customerName: p.customer.name,
        customer: { id: customer.id, name: p.customer.name, address: p.customer.address },
        designer: 'Ryann Tan',
        designerUserId: ryannId,
        documentInfo: { documentNumber: p.contractNo || p.docName, date: p.agreementDate, subject: quote.header.title, currency: 'SGD', taxApplicable: false, grandTotal: p.initialSum },
        backfill: 'drive-active-batch-2026-09-14',
      } as any,
    },
    select: { id: true },
  });

  let sort = 0;
  for (const m of p.milestones) {
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
        paymentMethod: m.paidAmount > 0 ? m.paymentMethod || 'transfer' : null,
        dueTrigger: m.dueTrigger || null,
        sortOrder: sort++,
      },
    });
  }
  for (const c of p.costs) {
    await prisma.projectCost.create({
      data: {
        organizationId: CIEL,
        projectId: project.id,
        date: D(c.date),
        supplierName: c.supplier,
        description: c.supplier,
        invoiceNo: c.inv,
        amount: c.amount,
        status: c.status || 'approved',
        source: 'import',
        createdByName: 'backfill (Drive costing sheet)',
        notes: c.notes || null,
      } as any,
    });
  }

  const contract = p.initialSum + p.milestones.filter((m) => m.kind === 'vo').reduce((s, m) => s + m.amount, 0);
  const collected = p.milestones.reduce((s, m) => s + (m.kind === 'refund' ? -m.paidAmount : m.paidAmount), 0);
  const actualCosts = p.costs.filter((c) => (c.status || 'approved') === 'approved').reduce((s, c) => s + c.amount, 0);
  const estCosts = p.costs.filter((c) => c.status === 'pending').reduce((s, c) => s + c.amount, 0);
  console.log(`✔ ${p.docName} — ${p.projectName} [${p.stage}]`);
  console.log(`   project ${project.id} · quotation ${doc.id} · ${p.milestones.length} milestones · ${p.costs.length} costs`);
  console.log(`   contract ${contract.toFixed(2)} · collected ${collected.toFixed(2)} · outstanding ${(contract - collected).toFixed(2)} · actual costs ${actualCosts.toFixed(2)}${estCosts ? ` · est costs (pending) ${estCosts.toFixed(2)}` : ''}`);
}

async function main() {
  const ryann = (await clerk.users.getUserList({ emailAddress: ['ryanntan@cielinterior.com'] })).data?.[0];
  console.log('Ryann:', ryann?.id || 'NOT FOUND (designerUserId left null)');
  const tmpl = await prisma.documentTemplate.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION' }, orderBy: { createdAt: 'asc' } });
  if (!tmpl) throw new Error('no CIEL quotation template');
  for (const p of PROJECTS) await importOne(p, ryann?.id || null, tmpl.id);
  console.log('\nAll active projects imported (status ongoing). Review each in /portal/projects.');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
