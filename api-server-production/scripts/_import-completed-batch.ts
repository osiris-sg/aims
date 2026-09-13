/**
 * CIEL completed-projects backfill (batch 2) — Ramya 241B Tengah (CI25-081),
 * Isabelle 95B Circuit Rd (CI25-112), Bryan 3PG Piccadilly Grand (CI25-121),
 * 446B Punggol Way (CI25-104). Same pattern as scripts/_import-dion-532b.ts:
 * customer + completed project + confirmed single-line quotation + milestones
 * with real paid amounts/dates + approved cost rows, all from Ryann's Drive
 * Costing Summary sheets. Idempotent per contract number; asserts every
 * project's totals against the sheet before writing anything.
 *
 * Sheet dates entered as text are dd/mm/yyyy; some cells were US-parsed by
 * Sheets (mm/dd) — those serials were swapped back where chronology proves it.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_import-completed-batch.ts
 */
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';

const prisma = new PrismaClient();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const CIEL = '09e55c23-e031-4254-8152-a373597b2cb3';
const D = (s: string | null) => (s ? new Date(s + 'T00:00:00+08:00') : null);

type Cost = { date: string | null; supplier: string; inv: string | null; amount: number; notes?: string };
type Milestone = { kind: string; label: string; pct: number | null; amount: number; paidAmount: number; paidAt: string | null; paymentMethod: string; dueTrigger?: string };
type Proj = {
  contractNo: string;
  customer: { name: string; address: string; phone?: string };
  projectName: string;
  address: string;
  startDate: string;
  agreementDate: string;
  initialSum: number;
  summaryLine: string;
  milestones: Milestone[];
  costs: Cost[];
  sheet: { contract: number; collected: number; costs: number; profit: number; commission: number };
};

const PROJECTS: Proj[] = [
  {
    contractNo: 'CI25-081',
    customer: { name: 'Ramya', address: 'Blk 241B Tengah Central #10-320, Singapore 692241' },
    projectName: 'Ramya — Blk 241B Tengah Central #10-320',
    address: 'Blk 241B Tengah Central #10-320, Singapore 692241',
    startDate: '2025-07-04',
    agreementDate: '2025-07-04',
    initialSum: 58800,
    summaryLine: 'Renovation works for Blk 241B Tengah Central #10-320 as per signed Letter of Intent',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1000, paidAmount: 1000, paidAt: '2025-07-04', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 4880, paidAmount: 4880, paidAt: '2025-10-18', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 23520, paidAmount: 23520, paidAt: '2025-11-20', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 26460, paidAmount: 26460, paidAt: '2026-01-05', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 2940, paidAmount: 2940, paidAt: '2026-03-07', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO1 · CI25-081', pct: null, amount: 18442.32, paidAmount: 18442.32, paidAt: '2026-01-14', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO2 · CI25-081', pct: null, amount: 2700, paidAmount: 2700, paidAt: '2026-01-14', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO3 · CI25-081', pct: null, amount: 625.99, paidAmount: 625.99, paidAt: '2026-03-07', paymentMethod: 'transfer' },
    ],
    costs: [
      { date: '2025-08-13', supplier: 'COOPTECH IDS PTE. LTD. (3D)', inv: 'INV-IDS5706', amount: 616 },
      { date: '2026-01-22', supplier: 'PD Door Pte Ltd', inv: '131393', amount: 1342.5 },
      { date: '2026-03-02', supplier: 'Dynamic Glass Contractor', inv: '260206', amount: 2365 },
      { date: '2025-11-12', supplier: 'YMF Group Pte Ltd', inv: '2025/567', amount: 8176.6 },
      { date: '2026-01-30', supplier: 'Hua Khian Co (Pte) Ltd (worktop)', inv: '2601-1106', amount: 8115.05 },
      { date: '2026-01-28', supplier: 'Hue Workz Pte Ltd (Painting)', inv: '2659', amount: 230 },
      { date: '2025-11-30', supplier: 'Cowboy Design Pte Ltd (Hacking)', inv: '2511061', amount: 1055 },
      { date: null, supplier: 'Carpentry', inv: null, amount: 20000, notes: 'No date on costing sheet' },
      { date: '2026-02-07', supplier: 'J&I Facilities Management Pte Ltd (Cleaning)', inv: '7340', amount: 850 },
      { date: '2025-12-22', supplier: 'Cowboy Design Pte Ltd (Tiling)', inv: '2512045', amount: 3683 },
      { date: '2026-02-12', supplier: 'Electrical Origin (Plumbing)', inv: '2512045', amount: 1860 },
      { date: '2025-12-19', supplier: 'Hua Khian Co Pte Ltd', inv: '25213041', amount: 2943 },
      { date: '2025-09-12', supplier: 'Yan Ho Aluminum', inv: 'YH12024', amount: 612 },
      { date: '2025-08-12', supplier: 'Soon Bee Huat Trading Pte Ltd', inv: 'ORD-AZ-018244', amount: 52.32 },
      { date: '2025-10-22', supplier: 'Hafary Private Limited', inv: '1804959', amount: 251.14 },
      { date: '2026-01-16', supplier: 'INNO Struct Pte Ltd', inv: '60117', amount: 2528 },
      { date: '2025-12-15', supplier: 'DOS Surveillance Pte Ltd', inv: '1212-12583', amount: 965.8 },
      { date: '2025-12-29', supplier: 'YMF Group Pte Ltd', inv: '2025/584', amount: 2000 },
      { date: '2026-01-28', supplier: 'Hue Workz Pte Ltd (Painting)', inv: '2622', amount: 3568 },
      { date: '2026-01-24', supplier: 'White Aircon Pte Ltd (Aircon)', inv: 'WAC 26010082', amount: 180 },
      { date: '2026-02-07', supplier: 'BG Glass Service (Carpentry, Ahyang intro)', inv: '3177', amount: 673 },
      { date: '2026-03-10', supplier: 'Oneko (Cat Mesh)', inv: '2026-172', amount: 1925 },
      { date: '2026-02-09', supplier: 'City Surfer Pte Ltd (Skirting)', inv: 'CSN074/0226(iY)', amount: 145.41 },
      { date: null, supplier: 'Adjustment', inv: null, amount: -4000, notes: 'Unlabelled -$4,000 row on the costing sheet' },
    ],
    sheet: { contract: 80568.31, collected: 80568.31, costs: 60136.82, profit: 20431.49, commission: 10215.75 },
  },
  {
    contractNo: 'CI25-112',
    customer: { name: 'Isabelle', address: 'Blk 95B Circuit Road #02-552, Singapore 372095', phone: '+65 8742 5824' },
    projectName: 'Isabelle — Blk 95B Circuit Road #02-552',
    address: 'Blk 95B Circuit Road #02-552, Singapore 372095',
    startDate: '2025-11-29',
    agreementDate: '2025-11-29',
    initialSum: 32300,
    summaryLine: 'Renovation works for Blk 95B Circuit Road #02-552 (BTO 4-room) as per signed Letter of Intent',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: '2025-11-29', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 1730, paidAmount: 1730, paidAt: '2025-12-09', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 12920, paidAmount: 12920, paidAt: '2025-12-22', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 14535, paidAmount: 14535, paidAt: '2026-02-10', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 1615, paidAmount: 1615, paidAt: '2026-03-12', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO1 · CI25-112', pct: null, amount: 1579, paidAmount: 1579, paidAt: '2026-02-10', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO2 · CI25-112', pct: null, amount: 320, paidAmount: 320, paidAt: '2026-03-12', paymentMethod: 'transfer' },
    ],
    costs: [
      { date: '2025-12-08', supplier: 'COOPTECH IDS PTE. LTD. (3D)', inv: 'INV-IDS6684', amount: 385 },
      { date: '2025-12-24', supplier: 'Hafary Private Limited', inv: '1915916', amount: 1841.66 },
      { date: '2025-12-19', supplier: 'Hafary Private Limited', inv: '1917648', amount: 209.28 },
      { date: '2026-01-09', supplier: 'Daco Interior Pte Ltd (Hacking)', inv: 'DINV-2601-006', amount: 1250 },
      { date: '2026-01-20', supplier: 'YMF Group Pte Ltd', inv: '2026/28', amount: 940 },
      { date: '2026-01-20', supplier: 'Daco Interior Pte Ltd (Tiling)', inv: 'DINV-2601-027', amount: 4885 },
      { date: '2026-01-29', supplier: 'Hue Workz Pte Ltd (Painting)', inv: '2668', amount: 1620 },
      { date: '2026-02-14', supplier: 'Electrical Origin (Plumbing)', inv: 'SGPO/0036/2026', amount: 650 },
      { date: '2026-02-15', supplier: 'Carpentry', inv: '21192', amount: 13272, notes: 'Sheet date typo "1502/2026" read as 15/02/2026' },
      { date: '2026-02-13', supplier: 'Hua Khian Co (Pte) Ltd (Worktop)', inv: '2602-0397', amount: 4845.05 },
      { date: '2026-02-15', supplier: 'J&I Facilities Management Pte Ltd', inv: '7375', amount: 300 },
      { date: '2026-02-27', supplier: 'YMF Group Pte Ltd', inv: '2026/48', amount: 150 },
      { date: '2026-03-10', supplier: 'Electrical Origin (Plumbing)', inv: 'SGPO/0041/2026', amount: 90 },
    ],
    sheet: { contract: 34199, collected: 34199, costs: 30437.99, profit: 3761.01, commission: 1880.51 },
  },
  {
    contractNo: 'CI25-121',
    customer: { name: 'Bryan Lee', address: '3 Northumberland Road #20-12, Piccadilly Grand, Singapore 219569', phone: '+65 9199 9010' },
    projectName: 'Bryan Lee — Piccadilly Grand #20-12',
    address: '3 Northumberland Road #20-12, Piccadilly Grand, Singapore 219569',
    startDate: '2025-12-12',
    agreementDate: '2025-12-12',
    initialSum: 12800,
    summaryLine: 'Renovation works for 3 Northumberland Road #20-12 (Piccadilly Grand) as per signed Letter of Intent',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1000, paidAmount: 1000, paidAt: '2025-12-17', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 280, paidAmount: 280, paidAt: null, paymentMethod: 'homepay' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 5120, paidAmount: 5120, paidAt: null, paymentMethod: 'homepay' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 5760, paidAmount: 5760, paidAt: null, paymentMethod: 'homepay' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 640, paidAmount: 640, paidAt: null, paymentMethod: 'homepay' },
      { kind: 'vo', label: 'VO1 · CI25-121', pct: null, amount: 875, paidAmount: 875, paidAt: null, paymentMethod: 'homepay' },
    ],
    costs: [
      { date: '2025-12-20', supplier: 'COOPTECH IDS PTE. LTD. (3D)', inv: 'INV-IDS6754', amount: 231 },
      { date: '2026-01-07', supplier: 'YMF Group Pte Ltd', inv: null, amount: 1718 },
      { date: '2026-01-09', supplier: 'Daco Interior Pte Ltd (Hacking)', inv: 'DINV-2601-005', amount: 400 },
      { date: '2026-01-12', supplier: 'YMF Group Pte Ltd', inv: '46327', amount: 350 },
      { date: '2026-02-07', supplier: 'J&I Facilities Management Pte Ltd (Cleaning)', inv: '734', amount: 350 },
      { date: '2026-02-10', supplier: 'YMF Group Pte Ltd', inv: '2026/44', amount: 450 },
      { date: '2026-02-28', supplier: 'Hue Workz Pte Ltd (Painting/limewash)', inv: '2698', amount: 2270 },
      { date: null, supplier: 'Carpentry', inv: null, amount: 7204, notes: 'No date on costing sheet' },
      { date: '2026-03-24', supplier: 'J&I Facilities Management Pte Ltd', inv: '7457', amount: 150 },
      { date: '2026-02-24', supplier: 'YMF Group Pte Ltd', inv: '2026/46', amount: 300 },
      { date: '2025-12-02', supplier: 'BG Glass Service', inv: '3184', amount: 396 },
      { date: null, supplier: 'PRIROPEP (Taobao cushion)', inv: null, amount: 220, notes: 'No date on costing sheet' },
    ],
    sheet: { contract: 13675, collected: 13675, costs: 14039, profit: -364, commission: -182 },
  },
  {
    contractNo: 'CI25-104',
    customer: { name: "Bryan's 二哥 & 二嫂", address: 'Blk 446B Punggol Way #22-1031' },
    projectName: "Bryan's 二哥 & 二嫂 — Blk 446B Punggol Way #22-1031",
    address: 'Blk 446B Punggol Way #22-1031',
    startDate: '2025-11-14',
    agreementDate: '2025-11-14',
    initialSum: 3888,
    summaryLine: 'Renovation works for Blk 446B Punggol Way #22-1031 as per signed contract',
    milestones: [
      { kind: 'milestone', label: 'Full payment (100%)', pct: 100, amount: 3888, paidAmount: 3888, paidAt: '2025-11-03', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
    ],
    costs: [
      { date: '2025-10-27', supplier: 'K Sage Construction Pte Ltd', inv: '2025/G418', amount: 200 },
      { date: '2025-10-28', supplier: 'Comfort Lighting & Electrical (M) SDN BHD', inv: 'SO 2510060', amount: 75.37 },
      { date: '2025-10-27', supplier: 'Arova Singapore Pte Ltd (Laminate)', inv: '268242', amount: 53 },
      { date: '2025-10-31', supplier: 'Hue Workz Pte Ltd (Painter)', inv: '25446', amount: 250 },
      { date: '2025-11-01', supplier: 'J&I Facilities Management Pte Ltd (Cleaning)', inv: '06951', amount: 150, notes: 'Sheet date typo "0/11/2025" — day unknown, set to 01/11/2025' },
      { date: '2025-12-11', supplier: 'Carpenter', inv: '21187', amount: 945 },
      { date: '2025-10-31', supplier: 'Bona Design Pte Ltd (Hacking)', inv: 'BINV-2510-004', amount: 310 },
      { date: '2025-11-04', supplier: 'Yong Li Electrical Engineering Service', inv: 'INV2025-0082', amount: 420 },
      { date: '2025-10-28', supplier: 'Keding Enterprises Pte Ltd', inv: '2840054191', amount: 262.82 },
    ],
    sheet: { contract: 3888, collected: 3888, costs: 2666.19, profit: 1221.81, commission: 610.91 },
  },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

async function importOne(p: Proj, ryannId: string | null, tmplId: string) {
  const exists = await prisma.document.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION', name: p.contractNo }, select: { id: true } });
  if (exists) {
    console.log(`↷ ${p.contractNo} already imported (doc ${exists.id}) — skipped`);
    return;
  }

  // pre-flight: reconcile against the sheet totals before writing
  const collected = r2(p.milestones.reduce((s, m) => s + m.paidAmount, 0));
  const contract = r2(p.initialSum + p.milestones.filter((m) => m.kind === 'vo').reduce((s, m) => s + m.amount, 0));
  const costs = r2(p.costs.reduce((s, c) => s + c.amount, 0));
  const profit = r2(collected - costs);
  const commission = r2(profit / 2);
  for (const [k, got, want] of [['contract', contract, p.sheet.contract], ['collected', collected, p.sheet.collected], ['costs', costs, p.sheet.costs], ['profit', profit, p.sheet.profit], ['commission', commission, p.sheet.commission]] as const) {
    if (Math.abs((got as number) - (want as number)) > 0.011) throw new Error(`${p.contractNo}: ${k} mismatch — computed ${got}, sheet says ${want}`);
  }

  let customer = await prisma.customer.findFirst({ where: { organizationId: CIEL, name: p.customer.name } });
  if (!customer) {
    customer = await prisma.customer.create({ data: { organizationId: CIEL, name: p.customer.name, address: p.customer.address, phone: p.customer.phone || null } });
  }

  const project = await prisma.project.create({
    data: {
      organizationId: CIEL,
      name: p.projectName,
      address: p.address,
      customerId: customer.id,
      status: 'completed',
      stage: 'completed',
      designer: 'Ryann Tan',
      designerUserId: ryannId,
      commissionPct: 50,
      source: 'self',
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
        title: `Renovation Works — as per signed contract ${p.contractNo}`,
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
      name: p.contractNo,
      status: 'confirmed',
      projectId: project.id,
      config: {
        templateVariant: 'ID',
        skipNumbering: true,
        quote,
        items: [{ id: 'item-1', itemCode: '', inventoryItemId: '', description: `[Renovation Works] as per signed contract ${p.contractNo}`, quantity: 1, uom: 'lot', unitPrice: p.initialSum, amount: p.initialSum, costPrice: null, isService: true, revenueTag: 'service' }],
        customerId: customer.id,
        customerName: p.customer.name,
        customer: { id: customer.id, name: p.customer.name, address: p.customer.address },
        designer: 'Ryann Tan',
        designerUserId: ryannId,
        documentInfo: { documentNumber: p.contractNo, date: p.agreementDate, subject: quote.header.title, currency: 'SGD', taxApplicable: false, grandTotal: p.initialSum },
        backfill: 'drive-completed-batch-2026-09-14',
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
        paymentMethod: m.paymentMethod,
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
        status: 'approved',
        source: 'import',
        createdByName: 'backfill (Drive costing sheet)',
        notes: c.notes || null,
      } as any,
    });
  }

  console.log(`✔ ${p.contractNo} ${p.projectName}`);
  console.log(`   project ${project.id} · quotation ${doc.id} · ${p.milestones.length} milestones · ${p.costs.length} costs`);
  console.log(`   contract ${contract.toFixed(2)} · collected ${collected.toFixed(2)} · costs ${costs.toFixed(2)} · profit ${profit.toFixed(2)} · commission(50%) ${commission.toFixed(2)}`);
}

async function main() {
  const ryann = (await clerk.users.getUserList({ emailAddress: ['ryanntan@cielinterior.com'] })).data?.[0];
  console.log('Ryann:', ryann?.id || 'NOT FOUND (designerUserId left null)');
  const tmpl = await prisma.documentTemplate.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION' }, orderBy: { createdAt: 'asc' } });
  if (!tmpl) throw new Error('no CIEL quotation template');
  for (const p of PROJECTS) await importOne(p, ryann?.id || null, tmpl.id);
  console.log('\nAll completed projects imported. Open /portal/projects and compare each project’s KPI tiles with the sheets.');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
