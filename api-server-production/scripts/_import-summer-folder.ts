/**
 * CIEL Summer-folder backfill (batch 5) — Drive "Summer" folder, same pattern
 * as the Ryann/Mike imports. Past Projects → completed; Projects → ongoing.
 * Summer's commission is 80% on every filled sheet. Completed sheets are
 * asserted against their P&L; the empty 25A St George's sheet imports as a
 * flagged shell for the owner to fill.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_import-summer-folder.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CIEL = '09e55c23-e031-4254-8152-a373597b2cb3';
const SUMMER_ID = 'user_3Ig5Q439YUk1Jd8YzwtlGTkeRho';
const D = (s: string | null) => (s ? new Date(s + 'T00:00:00+08:00') : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

type Cost = { date: string | null; supplier: string; inv: string | null; amount: number; notes?: string };
type Milestone = { kind: string; label: string; pct: number | null; amount: number; paidAmount: number; paidAt: string | null; dueTrigger?: string; notes?: string };
type Proj = {
  docName: string; contractNo: string; completed: boolean; stage: string; reviewNote: string;
  customer: { name: string; address: string };
  projectName: string; address: string; startDate: string; agreementDate: string; initialSum: number; summaryLine: string;
  milestones: Milestone[]; costs: Cost[];
  sheet?: { contract: number; collected: number; costs: number; profit: number; commission: number };
};

const PROJECTS: Proj[] = [
  // ── Past Projects → completed ────────────────────────────────────────────
  {
    docName: 'iNz Residence #01-18 (Kevin)', contractNo: '', completed: true, stage: 'completed',
    reviewNote: "Backfilled from Drive (Summer folder, past project). Check: the costing sheet has NO contract number and no client name (folder says Kevin) — what is the contract number? The 50% payment ($40,000) has an unreadable date (2022 typo). VO1 is NEGATIVE (−$920, a reduction). The sheet's 10%-retention side ledger was not imported.",
    customer: { name: 'Kevin (iNz Residence)', address: '70 Choa Chu Kang Ave 5 #01-18, iNz Residence' },
    projectName: 'Kevin — iNz Residence #01-18',
    address: '70 Choa Chu Kang Ave 5 #01-18, iNz Residence',
    startDate: '2025-10-01', agreementDate: '2025-10-01', initialSum: 80050,
    summaryLine: 'Renovation works for iNz Residence #01-18 (EC maisonette) as per signed contract',
    milestones: [
      { kind: 'milestone', label: '50% — commencement of work', pct: 50, amount: 40000, paidAmount: 40000, paidAt: null, dueTrigger: 'confirmation', notes: 'Paid per sheet; date cell unreadable (2022 typo)' },
      { kind: 'milestone', label: '30% — carpentry fabrication', pct: 30, amount: 24040, paidAmount: 24040, paidAt: '2025-11-29' },
      { kind: 'milestone', label: '20% — handover', pct: 20, amount: 16010, paidAmount: 16010, paidAt: '2026-01-23' },
      { kind: 'vo', label: 'VO1 (reduction)', pct: null, amount: -920, paidAmount: -920, paidAt: null, notes: 'Negative VO — scope reduction' },
      { kind: 'vo', label: 'VO2', pct: null, amount: 1241, paidAmount: 1241, paidAt: '2025-11-29' },
      { kind: 'vo', label: 'VO3', pct: null, amount: 1930, paidAmount: 1930, paidAt: '2026-01-23' },
    ],
    costs: [
      { date: '2025-10-31', supplier: 'Bona Design Pte Ltd', inv: 'BINV-2510-003', amount: 7735 },
      { date: '2025-11-07', supplier: 'Bona Design Pte Ltd', inv: 'BINV-2511-003', amount: 210 },
      { date: '2025-12-05', supplier: 'Cowboy Design', inv: '2512001', amount: 18900.25 },
      { date: null, supplier: 'SG Origin', inv: null, amount: 3295, notes: 'No date on costing sheet' },
      { date: '2025-12-25', supplier: 'Dynamic Glass', inv: '251237', amount: 2205 },
      { date: null, supplier: 'Blindspace', inv: '8217', amount: 4056.8, notes: 'No date on costing sheet' },
      { date: '2025-10-25', supplier: 'KSage Plastering', inv: '2025/G416', amount: 7631.25 },
      { date: '2025-12-28', supplier: 'Song Aik Timber Construction', inv: '25-1208', amount: 4441.5 },
      { date: '2025-11-15', supplier: 'SL Haus Pte Ltd', inv: 'INV-AUMY-20251115', amount: 7928 },
      { date: '2025-12-31', supplier: 'Hue Works', inv: '25586', amount: 4110 },
      { date: '2026-01-09', supplier: 'J&I Facilities', inv: '7213', amount: 700 },
      { date: '2026-01-03', supplier: 'J&H Engineering', inv: '0002-26', amount: 436 },
      { date: '2025-12-11', supplier: 'KSage Plastering', inv: '2025/G432', amount: 250 },
      { date: '2026-01-02', supplier: 'Bona Design Pte Ltd', inv: 'BINV-2512-001', amount: 500 },
      { date: null, supplier: 'Remove frosted film', inv: 'WF-', amount: 80, notes: 'No date on costing sheet' },
      { date: null, supplier: 'YMF Group (Plastering)', inv: '2025/599', amount: 790, notes: 'No date on costing sheet' },
      { date: null, supplier: 'YMF Group (Plastering)', inv: '46113', amount: 1050, notes: 'No date on costing sheet' },
      { date: null, supplier: 'YMF Group (Plastering)', inv: null, amount: 150, notes: 'No date on costing sheet' },
      { date: '2026-01-03', supplier: 'J&H Engineering', inv: '0001-26', amount: 218 },
    ],
    sheet: { contract: 82301, collected: 82301, costs: 64686.8, profit: 17614.2, commission: 14091.36 },
  },
  {
    docName: 'CI25-071Q', contractNo: 'CI25-071Q', completed: true, stage: 'completed',
    reviewNote: "Backfilled from Drive (Summer folder, past project). Check: the costing sheet is COMPLETELY EMPTY — no contract sum, payments or costs were ever filled in for Yu Chang & Wan Ling. Everything here is $0 until the owner supplies the real figures.",
    customer: { name: 'Yu Chang & Wan Ling', address: "Blk 25A St. George's Lane #22-41, Singapore 321025" },
    projectName: "Yu Chang & Wan Ling — Blk 25A St. George's Lane #22-41",
    address: "Blk 25A St. George's Lane #22-41, Singapore 321025",
    startDate: '2025-08-07', agreementDate: '2025-08-07', initialSum: 0,
    summaryLine: "Renovation works for Blk 25A St. George's Lane #22-41 as per signed contract CI25-071Q (figures pending)",
    milestones: [],
    costs: [],
  },

  // ── Projects → ongoing ───────────────────────────────────────────────────
  {
    docName: 'CI26-601', contractNo: 'CI26-601', completed: false, stage: 'handover',
    reviewNote: "Backfilled from Drive (Summer folder, active). Fully collected ($22,500) with a single lump-sum cost of $18,440.50 (no supplier breakdown, no dates — payment dates on the sheet are 2022 typos). Looks ready to be marked completed once the cost detail is confirmed.",
    customer: { name: "Elis (Rayson's Parents)", address: '361 Yung An Road #10-109' },
    projectName: 'Elis — 361 Yung An Road #10-109',
    address: '361 Yung An Road #10-109',
    startDate: '2026-08-05', agreementDate: '2026-08-05', initialSum: 22500,
    summaryLine: 'Renovation works for 361 Yung An Road #10-109 as per signed contract CI26-601',
    milestones: [
      { kind: 'milestone', label: '10% — deposit', pct: 10, amount: 2250, paidAmount: 2250, paidAt: null, dueTrigger: 'confirmation', notes: 'Paid per sheet; date unreadable (2022 typo)' },
      { kind: 'milestone', label: '50% — commencement of work', pct: 50, amount: 11250, paidAmount: 11250, paidAt: null, notes: 'Paid per sheet; date unreadable' },
      { kind: 'milestone', label: '35% — carpentry fabrication', pct: 35, amount: 7875, paidAmount: 7875, paidAt: null, notes: 'Paid per sheet; date unreadable' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 1125, paidAmount: 1125, paidAt: null, notes: 'Paid per sheet; date unreadable' },
    ],
    costs: [{ date: null, supplier: 'Total costing (lump sum, no breakdown on sheet)', inv: null, amount: 18440.5, notes: 'Single lump figure — ask Summer for the supplier breakdown' }],
    sheet: { contract: 22500, collected: 22500, costs: 18440.5, profit: 4059.5, commission: 3247.6 },
  },
  {
    docName: 'CI26-602', contractNo: 'CI26-602', completed: false, stage: 'handover',
    reviewNote: "Backfilled from Drive (Summer folder, active). Fully collected ($21,750) with a single lump-sum cost of $18,015 (no supplier breakdown or dates — payment dates are 2022 typos). Sister unit of CI26-601, same block.",
    customer: { name: "Nancy (Rayson's Aunt)", address: '361 Yung An Road #09-109' },
    projectName: 'Nancy — 361 Yung An Road #09-109',
    address: '361 Yung An Road #09-109',
    startDate: '2026-08-05', agreementDate: '2026-08-05', initialSum: 21750,
    summaryLine: 'Renovation works for 361 Yung An Road #09-109 as per signed contract CI26-602',
    milestones: [
      { kind: 'milestone', label: '10% — deposit', pct: 10, amount: 2175, paidAmount: 2175, paidAt: null, dueTrigger: 'confirmation', notes: 'Paid per sheet; date unreadable (2022 typo)' },
      { kind: 'milestone', label: '50% — commencement of work', pct: 50, amount: 10875, paidAmount: 10875, paidAt: null, notes: 'Paid per sheet; date unreadable' },
      { kind: 'milestone', label: '35% — carpentry fabrication', pct: 35, amount: 7612.5, paidAmount: 7612.5, paidAt: null, notes: 'Paid per sheet; date unreadable' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 1087.5, paidAmount: 1087.5, paidAt: null, notes: 'Paid per sheet; date unreadable' },
    ],
    costs: [{ date: null, supplier: 'Total costing (lump sum, no breakdown on sheet)', inv: null, amount: 18015, notes: 'Single lump figure — ask Summer for the supplier breakdown' }],
    sheet: { contract: 21750, collected: 21750, costs: 18015, profit: 3735, commission: 2988 },
  },
  {
    docName: 'CI26-603', contractNo: 'CI26-603', completed: false, stage: 'works',
    reviewNote: "Backfilled from Drive (Summer folder, active). Check: collected so far = EF $1,500 + 10% $702.57 + 40% $8,810.26 = $11,012.83 (all payment dates unreadable — 2022 typos); the 25%/10%/15% tranches ($11,012.83) are outstanding. Costing is a single lump $18,010 with no supplier breakdown. Signed quote 'Venu Quotation V3-2' is in the Drive folder.",
    customer: { name: 'Venu', address: '771 Yishun Ave 3 #08-235' },
    projectName: 'Venu — 771 Yishun Ave 3 #08-235',
    address: '771 Yishun Ave 3 #08-235',
    startDate: '2026-08-01', agreementDate: '2026-08-01', initialSum: 22025.65,
    summaryLine: 'Renovation works for 771 Yishun Ave 3 #08-235 as per signed contract CI26-603 (Quotation V3-2)',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: null, dueTrigger: 'confirmation', notes: 'Paid per sheet; date unreadable' },
      { kind: 'milestone', label: '10% — deposit balance', pct: 10, amount: 702.57, paidAmount: 702.57, paidAt: null, notes: 'Paid per sheet; date unreadable' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 8810.26, paidAmount: 8810.26, paidAt: null, notes: 'Paid per sheet; date unreadable' },
      { kind: 'milestone', label: '25% — carpentry fabrication', pct: 25, amount: 5506.41, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '10% — carpentry installation', pct: 10, amount: 2202.57, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '15% — handover', pct: 15, amount: 3303.85, paidAmount: 0, paidAt: null },
    ],
    costs: [{ date: null, supplier: 'Total costing (lump sum, no breakdown on sheet)', inv: null, amount: 18010, notes: 'Single lump figure — ask Summer for the supplier breakdown' }],
  },
  {
    docName: 'CI-26-505', contractNo: 'CI-26-505', completed: false, stage: 'carpentry',
    reviewNote: "Backfilled from Drive (Summer folder, active). Check: only the 50% ($35,000, 02/05/2026) is collected; VO1 is NEGATIVE (−$1,614.53, applied 02/08/2026); the 10% deposit / 35% / 5% tranches are outstanding — the sheet's own balance figure ($33,273.47) double-counts the VO, AIMS shows $34,888.01. Cost rows carry no dates.",
    customer: { name: 'Mr. Raymond Hair & Joan', address: '134 Punggol Field #14-22, Ecopolitan' },
    projectName: 'Raymond & Joan — Ecopolitan #14-22',
    address: '134 Punggol Field #14-22, Ecopolitan',
    startDate: '2026-05-02', agreementDate: '2026-05-02', initialSum: 69888,
    summaryLine: 'Renovation works for 134 Punggol Field #14-22 (Ecopolitan) as per signed contract CI-26-505',
    milestones: [
      { kind: 'milestone', label: '10% — deposit', pct: 10, amount: 6988.8, paidAmount: 0, paidAt: null, dueTrigger: 'confirmation' },
      { kind: 'milestone', label: '50% — commencement of work', pct: 50, amount: 35000, paidAmount: 35000, paidAt: '2026-05-02' },
      { kind: 'milestone', label: '35% — carpentry fabrication', pct: 35, amount: 24460.8, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 3494.4, paidAmount: 0, paidAt: null },
      { kind: 'vo', label: 'VO1 (reduction) · CI-26-505', pct: null, amount: -1614.53, paidAmount: -1614.53, paidAt: '2026-08-02', notes: 'Negative VO — scope reduction' },
    ],
    costs: [
      { date: null, supplier: 'Daco Interior (Hacking)', inv: 'DINV-2605-021', amount: 7590 },
      { date: null, supplier: 'Daco Interior (Tiling)', inv: 'DINV-2606-015', amount: 16539.5 },
      { date: null, supplier: 'YMF Group (Plastering)', inv: '2026/106', amount: 7827.05 },
      { date: null, supplier: 'Daco Interior (Hacking)', inv: 'DINV-2606-030', amount: 250 },
      { date: null, supplier: 'Ether Space (Concealed doors)', inv: null, amount: 5700 },
      { date: null, supplier: 'Dynamic Glass', inv: '260622', amount: 5650 },
      { date: null, supplier: 'PD Door', inv: 'CS135391', amount: 800.06 },
      { date: null, supplier: 'TERMAX (Bus sliding door)', inv: 'TEX14072026', amount: 800 },
      { date: null, supplier: 'YMF Group (Plastering)', inv: '2026/117', amount: 750 },
      { date: null, supplier: 'YMF Group (Plastering)', inv: '2026/123', amount: 400 },
      { date: null, supplier: 'Aircon', inv: null, amount: 50 },
      { date: null, supplier: 'Hueworks Painting', inv: '26317', amount: 2650 },
      { date: null, supplier: 'SG Electrical Origin', inv: 'SGPO-0121', amount: 4300 },
      { date: null, supplier: 'SG Electrical Origin', inv: 'SGPO-0126', amount: 120 },
      { date: null, supplier: 'Song Aik Timber', inv: '26-0701', amount: 630 },
      { date: null, supplier: 'Daco Interior (Hacking)', inv: 'DINV 2607 015', amount: 237.5 },
      { date: null, supplier: 'Daco Interior (Hacking)', inv: 'DINV 2607 031', amount: 1710 },
      { date: null, supplier: 'The Better Guys', inv: 'TBG 7688', amount: 1023 },
      { date: null, supplier: 'Priropep', inv: 'PRP26-CI0603', amount: 1180 },
      { date: null, supplier: 'Adjustment', inv: null, amount: 1000, notes: 'Unlabelled $1,000 row on the costing sheet' },
      { date: null, supplier: 'Daco Interior (Hacking)', inv: '2026/117', amount: 367 },
    ],
  },
];

async function importOne(p: Proj, tmplId: string) {
  const exists = await prisma.document.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION', name: p.docName }, select: { id: true } });
  if (exists) {
    console.log(`↷ ${p.docName} already imported — skipped`);
    return;
  }
  const collected = r2(p.milestones.reduce((s, m) => s + (m.kind === 'refund' ? -m.paidAmount : m.paidAmount), 0));
  const contract = r2(p.initialSum + p.milestones.filter((m) => m.kind === 'vo').reduce((s, m) => s + m.amount, 0));
  const costs = r2(p.costs.reduce((s, c) => s + c.amount, 0));
  if (p.completed && p.sheet) {
    const profit = r2(collected - costs);
    const commission = r2(profit * 0.8);
    for (const [k, got, want] of [['contract', contract, p.sheet.contract], ['collected', collected, p.sheet.collected], ['costs', costs, p.sheet.costs], ['profit', profit, p.sheet.profit], ['commission', commission, p.sheet.commission]] as const) {
      if (Math.abs((got as number) - (want as number)) > 0.011) throw new Error(`${p.docName}: ${k} mismatch — computed ${got}, sheet says ${want}`);
    }
  }
  let customer = await prisma.customer.findFirst({ where: { organizationId: CIEL, name: p.customer.name } });
  if (!customer) customer = await prisma.customer.create({ data: { organizationId: CIEL, name: p.customer.name, address: p.customer.address || null } });
  const project = await prisma.project.create({
    data: {
      organizationId: CIEL, name: p.projectName, address: p.address || null, description: p.reviewNote,
      customerId: customer.id, status: p.completed ? 'completed' : 'ongoing', stage: p.stage,
      designer: 'Summer EC', designerUserId: SUMMER_ID, commissionPct: 80, source: 'self', startDate: D(p.startDate)!,
    },
    select: { id: true },
  });
  const quote = {
    version: 1,
    header: {
      title: 'RE: Letter of Intent & Appointment for Renovation Works at the below mentioned new address',
      contractNo: p.contractNo, clientName: p.customer.name, nric: '', address: p.address, contact: '',
      agreementDate: p.agreementDate, remarks: 'Backfilled from the signed contract (Drive) — line detail in the signed PDF',
      designer: 'Summer EC', designerUserId: SUMMER_ID, designerPhone: '', paymentTerms: 'As Mentioned Below',
    },
    sections: [{
      id: 'sec-1', letter: 'A', title: `Renovation Works — as per signed contract${p.contractNo ? ' ' + p.contractNo : ''}`,
      notes: ['Full line-item breakdown in the signed contract PDF (Drive: Signed Quotation & T&C).'],
      areas: [{ id: 'area-1', name: 'General', items: [{ id: 'item-1', workItemId: null, code: null, description: p.summaryLine, qty: 1, uom: 'lot', amount: p.initialSum, pricingMode: 'priced', cost: null, includes: [] }] }],
    }],
    summary: { designFeePct: 0, discounts: [] },
    terms: { paymentTerms: [], clauses: [] },
    settings: { marginGuidelinePct: 25, marginFloorPct: 15 },
  };
  const doc = await prisma.document.create({
    data: {
      organizationId: CIEL, documentTemplateId: tmplId, type: 'QUOTATION', name: p.docName, status: 'confirmed', projectId: project.id,
      config: {
        templateVariant: 'ID', skipNumbering: true, quote,
        items: [{ id: 'item-1', itemCode: '', inventoryItemId: '', description: `[Renovation Works] as per signed contract${p.contractNo ? ' ' + p.contractNo : ''}`, quantity: 1, uom: 'lot', unitPrice: p.initialSum, amount: p.initialSum, costPrice: null, isService: true, revenueTag: 'service' }],
        customerId: customer.id, customerName: p.customer.name, customer: { id: customer.id, name: p.customer.name, address: p.customer.address },
        designer: 'Summer EC', designerUserId: SUMMER_ID,
        documentInfo: { documentNumber: p.contractNo || p.docName, date: p.agreementDate, subject: quote.header.title, currency: 'SGD', taxApplicable: false, grandTotal: p.initialSum },
        backfill: 'drive-summer-folder-2026-09-16',
      } as any,
    },
    select: { id: true },
  });
  let sort = 0;
  for (const m of p.milestones) {
    await prisma.projectMilestone.create({
      data: {
        organizationId: CIEL, projectId: project.id, kind: m.kind, label: m.label, pct: m.pct, amount: m.amount,
        paidAmount: m.paidAmount, paidAt: D(m.paidAt), paymentMethod: m.paidAmount !== 0 ? 'transfer' : null,
        dueTrigger: m.dueTrigger || null, sortOrder: sort++,
      },
    });
  }
  for (const c of p.costs) {
    await prisma.projectCost.create({
      data: {
        organizationId: CIEL, projectId: project.id, date: D(c.date), supplierName: c.supplier, description: c.supplier,
        invoiceNo: c.inv, amount: c.amount, status: 'approved', source: 'import',
        createdByName: 'backfill (Drive costing sheet)', notes: c.notes || null,
      } as any,
    });
  }
  console.log(`✔ ${p.docName} — ${p.projectName} [${p.completed ? 'completed' : p.stage}]`);
  console.log(`   contract ${contract.toFixed(2)} · collected ${collected.toFixed(2)} · outstanding ${(contract - collected).toFixed(2)} · costs ${costs.toFixed(2)}`);
}

async function main() {
  const tmpl = await prisma.documentTemplate.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION' }, orderBy: { createdAt: 'asc' } });
  if (!tmpl) throw new Error('no CIEL quotation template');
  for (const p of PROJECTS) await importOne(p, tmpl.id);
  console.log('\nSummer folder imported. Review notes are on the dashboard "Project notes" card.');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
