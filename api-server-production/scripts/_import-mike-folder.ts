/**
 * CIEL Mike-folder backfill (batch 4) — Drive "Mike" folder, same pattern as
 * the Ryann imports. Three parts, all idempotent:
 *  1. COMPLETED (5): 101C Punggol Field CI26-302, 980 Jurong West CI25-101,
 *     Hydro Wash CI25-082 (contract no collides with Xin Yi's — doc name
 *     suffixed), 322A Tengah Dr CI-2024-0005, 443A Punggol CI-2024-0001.
 *     Totals asserted against each sheet before writing.
 *  2. ACTIVE (5): 119 Teck Whye CI26-502, 677B Punggol CI26-301, 957A Jurong
 *     West CI26-111, 988A Jurong West CI25-072, 153A Towner CI26-402 (no
 *     costing sheet — schedule derived from the signed $45,000 quote).
 *  3. Siusin (existing project ba899165…) — light backfill only: commission
 *     80%, source, start date, customer, the Bona hacking cost, review note.
 *     Her AIMS quotation CI26-003 ($14,019.69) conflicts with the Drive sheet
 *     ($180,000, $90k collected) — flagged, NOT overwritten.
 * Mike's commission is 80% on every sheet.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_import-mike-folder.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CIEL = '09e55c23-e031-4254-8152-a373597b2cb3';
const MIKE_ID = 'user_3Ig3ow7wiP4z68jMxwxDnHvHe1Q';
const D = (s: string | null) => (s ? new Date(s + 'T00:00:00+08:00') : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

type Cost = { date: string | null; supplier: string; inv: string | null; amount: number; status?: string; notes?: string };
type Milestone = { kind: string; label: string; pct: number | null; amount: number; paidAmount: number; paidAt: string | null; paymentMethod?: string | null; dueTrigger?: string; notes?: string };
type Proj = {
  docName: string;
  contractNo: string;
  completed: boolean;
  stage: string;
  reviewNote: string;
  customer: { name: string; address: string; phone?: string };
  projectName: string;
  address: string;
  startDate: string;
  agreementDate: string;
  initialSum: number;
  summaryLine: string;
  milestones: Milestone[];
  costs: Cost[];
  sheet?: { contract: number; collected: number; costs: number; profit: number; commission: number };
};

const PROJECTS: Proj[] = [
  // ── COMPLETED ────────────────────────────────────────────────────────────
  {
    docName: 'CI26-302', contractNo: 'CI26-302', completed: true, stage: 'completed',
    reviewNote: 'Backfilled from Drive (Mike folder, completed). Small $4,200 job, single 100% payment. VO1/VO2 markers on the sheet carry no amounts — skipped.',
    customer: { name: 'Ms. Lim Mui Huey', address: '101C Punggol Field #14-464', phone: '9732 2584' },
    projectName: 'Ms. Lim Mui Huey — 101C Punggol Field #14-464',
    address: '101C Punggol Field #14-464',
    startDate: '2026-03-27', agreementDate: '2026-03-27', initialSum: 4200,
    summaryLine: 'Renovation works for 101C Punggol Field #14-464 as per signed contract CI26-302',
    milestones: [
      { kind: 'milestone', label: 'Full payment (100%)', pct: 100, amount: 4200, paidAmount: 4200, paidAt: '2026-03-30', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
    ],
    costs: [
      { date: '2026-03-16', supplier: 'Yong Li Electrical Engineering Service', inv: 'INV2026-0012', amount: 565 },
      { date: '2026-03-18', supplier: 'YMF Group Pte Ltd', inv: '2026/60', amount: 650 },
      { date: '2026-03-19', supplier: 'Dynamic Glass Contractor', inv: '260331', amount: 989 },
      { date: '2026-03-30', supplier: 'Hua Khian Co Pte Ltd (Vinyl)', inv: 'V2603-0152', amount: 281.22 },
      { date: '2026-03-31', supplier: 'Hue Workz Pte Ltd', inv: '26129', amount: 400 },
      { date: '2026-03-29', supplier: 'Paid to Mike (Carousell)', inv: null, amount: 45 },
    ],
    sheet: { contract: 4200, collected: 4200, costs: 2930.22, profit: 1269.78, commission: 1015.82 },
  },
  {
    docName: 'CI25-101', contractNo: 'CI25-101', completed: true, stage: 'completed',
    reviewNote: 'Backfilled from Drive (Mike folder, completed). Check: Hua Khian invoice OR151538 is dated after later invoices on the sheet (kept as read 06/01/2026); several rows (YMF 2025/581, misc/furniture items, Hue Workz $1,820) have no dates.',
    customer: { name: 'Xihui & Family', address: 'Blk 980 Jurong West St 93 #08-347', phone: '8339 5499' },
    projectName: 'Xihui & Family — Blk 980 Jurong West St 93 #08-347',
    address: 'Blk 980 Jurong West St 93 #08-347',
    startDate: '2025-10-13', agreementDate: '2025-10-13', initialSum: 76888,
    summaryLine: 'Renovation works for Blk 980 Jurong West St 93 #08-347 as per signed contract CI25-101',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: '2025-10-13', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: '50% — commencement of work', pct: 50, amount: 36944, paidAmount: 36944, paidAt: '2025-12-11', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 34599.6, paidAmount: 34599.6, paidAt: '2025-12-29', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 3844.4, paidAmount: 3844.4, paidAt: '2026-02-23', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO1 · CI25-101', pct: null, amount: 6300, paidAmount: 6300, paidAt: '2026-02-23', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO2 · CI25-101', pct: null, amount: 680, paidAmount: 680, paidAt: '2026-03-16', paymentMethod: 'transfer' },
    ],
    costs: [
      { date: '2025-11-04', supplier: 'COOPTECH IDS PTE. LTD.', inv: 'INV-IDS6386', amount: 462 },
      { date: '2025-11-30', supplier: 'Cowboy Design Pte Ltd', inv: '2511073', amount: 1825 },
      { date: '2026-01-29', supplier: 'Daco Interior Pte Ltd', inv: 'DINV-2601-046', amount: 200 },
      { date: '2026-02-12', supplier: 'Daco Interior Pte Ltd', inv: 'DINV-2602-017', amount: 240 },
      { date: '2025-12-30', supplier: 'Cowboy Design Pte Ltd', inv: '2512050', amount: 6084 },
      { date: '2025-11-24', supplier: 'Hafary Private Limited', inv: '1903200', amount: 544.13 },
      { date: '2025-11-25', supplier: 'Hafary Private Limited', inv: '1904591', amount: 366.24 },
      { date: '2025-11-25', supplier: 'YMF Group Pte Ltd', inv: '2025/545', amount: 950 },
      { date: null, supplier: 'YMF Group Pte Ltd', inv: '2025/581', amount: 6750, notes: 'No date on costing sheet' },
      { date: '2026-01-16', supplier: 'YMF Group Pte Ltd', inv: '2026/23', amount: 1582.5 },
      { date: '2026-01-13', supplier: 'Yan Ho Aluminium', inv: 'YH01036', amount: 1566.3 },
      { date: '2025-12-29', supplier: 'Dynamic Glass Contractor', inv: '251241', amount: 2828 },
      { date: '2026-02-09', supplier: 'Ah Yang Carpentry', inv: null, amount: 10000 },
      { date: '2026-02-09', supplier: 'Ah Yang Carpentry', inv: null, amount: 13136.75 },
      { date: '2026-01-06', supplier: 'Hua Khian Co Pte Ltd (Vinyl)', inv: 'OR151538', amount: 1281.84 },
      { date: '2026-01-23', supplier: 'Hua Khian Co Pte Ltd (Vinyl)', inv: 'OR152430', amount: 2673.23 },
      { date: '2026-01-14', supplier: 'Hua Khian Co Pte Ltd (Stone)', inv: 'OR151940', amount: 3776.85 },
      { date: '2026-02-12', supplier: 'SG Plumbing Origin', inv: 'SGPO/0030/2026', amount: 290 },
      { date: '2026-01-28', supplier: 'Luxus Digital', inv: 'INV-66335', amount: 3158.36 },
      { date: '2025-12-30', supplier: 'SL Haus Pte Ltd', inv: 'INV-KABM-20251230', amount: 1640.5 },
      { date: '2026-01-12', supplier: 'J&I Facilities Management Pte Ltd', inv: '7223', amount: 150 },
      { date: '2026-02-06', supplier: 'J&I Facilities Management Pte Ltd', inv: '7336', amount: 300 },
      { date: '2026-02-09', supplier: 'Ah Haw Curtains', inv: '120392', amount: 950 },
      { date: null, supplier: 'Miscellaneous', inv: null, amount: 1604.09, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Nereos Water Dispenser', inv: null, amount: 1399, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Bedframe + dining table', inv: null, amount: 961.58, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Power Track', inv: null, amount: 600, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Hue Workz Pte Ltd', inv: null, amount: 1820, notes: 'No date on costing sheet' },
      { date: '2026-01-26', supplier: 'Daco Interior Pte Ltd', inv: 'DINV-2602-030', amount: 560 },
    ],
    sheet: { contract: 83868, collected: 83868, costs: 67700.37, profit: 16167.63, commission: 12934.1 },
  },
  {
    docName: 'CI25-082 (HYDROWASH)', contractNo: 'CI25-082', completed: true, stage: 'completed',
    reviewNote: "Backfilled from Drive (Mike folder, completed). Check: this contract number CI25-082 is ALSO Xin Yi's (Ryann) — one of the two is misnumbered. Commercial job (Hydro Wash workshop). The sheet's secondary 10%-deduction subcontractor ledger was not imported.",
    customer: { name: 'Mr. Galvin & Mr. YK (Hydro Wash)', address: '2 Yishun Industrial Street 1 #03-01 HYDROWASH' },
    projectName: 'Hydro Wash — 2 Yishun Industrial Street 1 #03-01',
    address: '2 Yishun Industrial Street 1 #03-01 HYDROWASH',
    startDate: '2025-08-18', agreementDate: '2025-08-18', initialSum: 4688,
    summaryLine: 'Renovation works for 2 Yishun Industrial Street 1 #03-01 (Hydro Wash) as per signed contract CI25-082',
    milestones: [
      { kind: 'milestone', label: 'Payment 1', pct: null, amount: 2344, paidAmount: 2344, paidAt: '2025-09-13', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'vo', label: 'VO1 · CI25-082', pct: null, amount: 3000, paidAmount: 3000, paidAt: '2025-10-16', paymentMethod: 'transfer' },
      { kind: 'milestone', label: 'Final payment', pct: null, amount: 2344, paidAmount: 2344, paidAt: '2025-11-19', paymentMethod: 'transfer' },
    ],
    costs: [
      { date: '2025-10-28', supplier: 'Symplazt Pte Ltd', inv: 'P25-10127', amount: 950 },
      { date: '2025-11-25', supplier: 'Yong Li Electrical Engineering Service', inv: 'INV2025-0086', amount: 2000 },
      { date: '2025-11-15', supplier: 'Yireh Renovation Solutions Pte Ltd', inv: 'INV-000057', amount: 400 },
      { date: '2025-11-20', supplier: 'PRIROPEP', inv: 'PRP25-CI111', amount: 2627.05 },
      { date: '2025-11-24', supplier: 'Hue Workz Pte Ltd', inv: '25495', amount: 280 },
    ],
    sheet: { contract: 7688, collected: 7688, costs: 6257.05, profit: 1430.95, commission: 1144.76 },
  },
  {
    docName: 'CI-2024-0005', contractNo: 'CI-2024-0005', completed: true, stage: 'completed',
    reviewNote: 'Backfilled from Drive (Mike folder, completed). Check: the client over-paid on the progress payments and $4,533.50 was refunded (17/06/2025) — VO1 $6,670 therefore shows unpaid in the schedule but its cash sits inside the progress payments; totals reconcile. Secondary 10%-deduction ledger not imported.',
    customer: { name: 'Mr. Jun Chong & Ms. Jia Hui', address: 'Blk 322A Tengah Drive #04-380' },
    projectName: 'Mr. Jun Chong & Ms. Jia Hui — Blk 322A Tengah Drive #04-380',
    address: 'Blk 322A Tengah Drive #04-380',
    startDate: '2025-02-06', agreementDate: '2025-02-06', initialSum: 32400,
    summaryLine: 'Renovation works for Blk 322A Tengah Drive #04-380 as per signed contract CI-2024-0005',
    milestones: [
      { kind: 'milestone', label: '10% — deposit', pct: 10, amount: 1000, paidAmount: 1000, paidAt: '2025-02-06', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 19400, paidAmount: 19400, paidAt: '2025-03-04', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 21250, paidAmount: 21250, paidAt: '2025-06-17', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 1953.5, paidAmount: 1953.5, paidAt: '2025-08-08', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO1 · CI-2024-0005', pct: null, amount: 6670, paidAmount: 0, paidAt: null, notes: 'Collected within the progress payments — see refund' },
      { kind: 'refund', label: 'Refund excess', pct: null, amount: 4533.5, paidAmount: 4533.5, paidAt: '2025-06-17', paymentMethod: 'transfer' },
    ],
    costs: [
      { date: '2025-03-26', supplier: 'COOPTECH IDS PTE. LTD.', inv: 'INV-IDS4879', amount: 308 },
      { date: '2025-05-30', supplier: 'Daco Interior Pte Ltd (Hacking)', inv: 'DINV-2505-040', amount: 600 },
      { date: '2025-05-30', supplier: 'Daco Interior Pte Ltd (Tiling)', inv: 'DINV-2505-041', amount: 1092.5 },
      { date: '2025-06-04', supplier: 'EA RENO2U PTE. LTD.', inv: 'RE00850', amount: 3021.85 },
      { date: '2025-07-22', supplier: 'Hue Workz Pte Ltd', inv: '25285', amount: 1620 },
      { date: '2025-07-01', supplier: 'Hua Khian Co Pte Ltd (Stone)', inv: '2506-0668', amount: 2648.7 },
      { date: '2025-05-01', supplier: 'Ah Yang Carpentry', inv: '21178/21179', amount: 13885, notes: 'Shared carpentry invoice with 443A Punggol' },
      { date: '2025-07-17', supplier: 'CS Engrg Pte Ltd (Invisible Grille)', inv: '182455', amount: 1030.5 },
      { date: '2025-04-10', supplier: 'Homeglass Services Pte. Ltd.', inv: '2025-04018', amount: 1202 },
      { date: '2025-08-12', supplier: 'SG Plumbing Origin', inv: 'SGPO/0078/2025', amount: 1230 },
      { date: '2025-06-05', supplier: 'J&I Facilities Management Pte Ltd', inv: '6655', amount: 280 },
      { date: '2025-04-02', supplier: 'Yan Ho Aluminium', inv: 'YH04011', amount: 689.43 },
      { date: '2025-12-07', supplier: 'Plastering (Ah Ming)', inv: '1006', amount: 200 },
      { date: '2025-05-08', supplier: 'Hue Workz Pte Ltd', inv: '25330', amount: 1286 },
      { date: '2025-08-07', supplier: 'Wonder Bath & Lighting Pte Ltd (Corner Fan)', inv: 'INV-3751', amount: 189 },
    ],
    sheet: { contract: 39070, collected: 39070, costs: 29282.98, profit: 9787.02, commission: 7829.62 },
  },
  {
    docName: 'CI-2024-0001', contractNo: 'CI-2024-0001', completed: true, stage: 'completed',
    reviewNote: 'Backfilled from Drive (Mike folder, completed). Check: the 45% payment was double-collected ($39,793.60) and $20,944 refunded on 26/03/2025 — totals reconcile net of the refund. One unlabelled $100 cost row kept as "Adjustment".',
    customer: { name: 'Bryan & Debra', address: '443A New Punggol Rd #16-640' },
    projectName: 'Bryan & Debra — 443A New Punggol Rd #16-640',
    address: '443A New Punggol Rd #16-640',
    startDate: '2025-01-19', agreementDate: '2025-01-19', initialSum: 41888,
    summaryLine: 'Renovation works for 443A New Punggol Rd #16-640 as per signed contract CI-2024-0001',
    milestones: [
      { kind: 'milestone', label: '10% — deposit', pct: 10, amount: 1000, paidAmount: 1000, paidAt: '2025-01-19', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 19944, paidAmount: 19944, paidAt: '2025-02-25', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 39793.6, paidAmount: 39793.6, paidAt: '2025-03-26', paymentMethod: 'transfer', notes: 'Double-collected — see refund' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 2094.4, paidAmount: 2094.4, paidAt: '2025-05-21', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO1 · CI-2024-0001', pct: null, amount: 6370, paidAmount: 6370, paidAt: '2025-03-19', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO2 · CI-2024-0001', pct: null, amount: 1690, paidAmount: 1690, paidAt: '2025-05-21', paymentMethod: 'transfer' },
      { kind: 'refund', label: 'Refund excess', pct: null, amount: 20944, paidAmount: 20944, paidAt: '2025-03-26', paymentMethod: 'transfer' },
    ],
    costs: [
      { date: '2025-02-14', supplier: 'COOPTECH IDS PTE. LTD.', inv: 'INV-IDS4656', amount: 385 },
      { date: '2025-03-03', supplier: 'Daco Interior Pte Ltd (Hacking)', inv: 'DINV-2503-003', amount: 1030 },
      { date: '2025-03-13', supplier: 'Daco Interior Pte Ltd (Tiling)', inv: 'DINV-2503-018', amount: 4979 },
      { date: '2025-03-24', supplier: 'EA RENO2U PTE. LTD.', inv: 'RE00816', amount: 3220.7 },
      { date: '2025-04-30', supplier: 'Hue Workz Pte Ltd', inv: '25150', amount: 2232 },
      { date: '2025-04-01', supplier: 'Hua Khian Co Pte Ltd (Vinyl)', inv: 'OR139389', amount: 3129.39 },
      { date: '2025-05-01', supplier: 'Ah Yang Carpentry', inv: '21178/21179', amount: 17954, notes: 'Shared carpentry invoice with 322A Tengah' },
      { date: '2025-05-05', supplier: 'Hua Khian Co Pte Ltd (Stone)', inv: 'OR140793', amount: 3629.7 },
      { date: '2025-04-10', supplier: 'Homeglass Services Pte. Ltd.', inv: '2025-04018', amount: 1240.8 },
      { date: '2025-05-05', supplier: 'SG Plumbing Origin', inv: 'SGPO/0044/2025', amount: 970 },
      { date: '2025-06-05', supplier: 'J&I Facilities Management Pte Ltd', inv: '6456', amount: 580 },
      { date: '2025-04-02', supplier: 'Yan Ho Aluminium', inv: 'YH04011', amount: 672 },
      { date: '2025-05-20', supplier: 'Homeglass Services Pte. Ltd.', inv: '2025-05036', amount: 60 },
      { date: '2025-04-30', supplier: 'Sky Lighting LED Pte Ltd', inv: 'OE25043000077', amount: 350.33 },
      { date: null, supplier: 'Adjustment', inv: null, amount: 100, notes: 'Unlabelled $100 row on the costing sheet' },
    ],
    sheet: { contract: 49948, collected: 49948, costs: 40532.92, profit: 9415.08, commission: 7532.06 },
  },

  // ── ACTIVE ───────────────────────────────────────────────────────────────
  {
    docName: 'CI26-502', contractNo: 'CI26-502', completed: false, stage: 'handover',
    reviewNote: 'Backfilled from Drive (Mike folder, active). Fully collected ($56,888) with costs through July — looks ready to be marked completed. Note: the Siusin sheet also says CI26-502; her real AIMS number is CI26-003, so this one keeps CI26-502.',
    customer: { name: 'Ms. Joanne & Family', address: 'Blk 119 Teck Whye Lane #06-794', phone: '9620 5945' },
    projectName: 'Ms. Joanne & Family — Blk 119 Teck Whye Lane #06-794',
    address: 'Blk 119 Teck Whye Lane #06-794',
    startDate: '2026-05-10', agreementDate: '2026-05-10', initialSum: 48888,
    summaryLine: 'Renovation works for Blk 119 Teck Whye Lane #06-794 as per signed contract CI26-502',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: '2026-05-11', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 3388.8, paidAmount: 3388.8, paidAt: '2026-07-01', paymentMethod: 'transfer', notes: 'Paid lump sum together with the 40%' },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 19555.2, paidAmount: 19555.2, paidAt: '2026-07-01', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 21999.6, paidAmount: 21999.6, paidAt: '2026-07-09', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 2444.4, paidAmount: 2444.4, paidAt: '2026-07-21', paymentMethod: 'transfer' },
      { kind: 'vo', label: 'VO1 · CI26-502', pct: null, amount: 8000, paidAmount: 8000, paidAt: '2026-07-21', paymentMethod: 'transfer' },
    ],
    costs: [
      { date: '2026-06-16', supplier: 'Daco Interior Pte Ltd', inv: 'DINV-2606-018', amount: 1840 },
      { date: '2026-06-24', supplier: 'Daco Interior Pte Ltd', inv: 'DINV-2606-034', amount: 617.5 },
      { date: '2026-07-09', supplier: 'Daco Interior Pte Ltd', inv: 'DINV-2607-016', amount: 237.5 },
      { date: null, supplier: 'YMF Group Pte Ltd', inv: '2026/104', amount: 2703.4, notes: 'No date on costing sheet' },
      { date: '2026-07-20', supplier: 'YMF Group Pte Ltd', inv: '2026/119', amount: 900 },
      { date: '2026-06-24', supplier: 'Hue Workz Pte Ltd (Painting)', inv: '26315', amount: 1840 },
      { date: null, supplier: 'Ah Yang Carpentry', inv: null, amount: 26343.98, notes: 'No date on costing sheet' },
      { date: '2026-06-15', supplier: 'Dynamic Glass Contractor', inv: '260622', amount: 1040 },
      { date: '2026-07-13', supplier: 'Hua Khian Co Pte Ltd (Stone)', inv: '2607-0365', amount: 3580.65 },
      { date: '2026-07-21', supplier: 'SG Plumbing Origin', inv: 'SGPO/0119/2026', amount: 660 },
      { date: '2026-06-23', supplier: 'J&I Facilities Management Pte Ltd', inv: '7729', amount: 150 },
      { date: '2026-07-17', supplier: 'Hue Workz Pte Ltd (Limewash)', inv: '26387', amount: 720 },
      { date: '2026-07-20', supplier: 'Daco Interior Pte Ltd (Epoxy)', inv: 'DINV-2607-034', amount: 1235 },
      { date: '2026-06-17', supplier: 'PD Door Pte Ltd', inv: '134986', amount: 599.5 },
      { date: '2026-06-15', supplier: 'Innovative Pest Pte Ltd (Termite)', inv: '24418', amount: 110 },
      { date: '2026-07-16', supplier: 'J&I Facilities Management Pte Ltd', inv: '7796', amount: 300 },
      { date: '2026-06-22', supplier: 'Yafen Marketing Pte Ltd', inv: '26062208', amount: 524.4 },
      { date: '2026-06-25', supplier: 'Hue Workz Pte Ltd (Painting)', inv: '26327', amount: 150 },
      { date: '2026-07-21', supplier: 'Yong Li Electrical Engineering Service', inv: 'INV2026-0031', amount: 580 },
    ],
    sheet: { contract: 56888, collected: 56888, costs: 44131.93, profit: 12756.07, commission: 10204.86 },
  },
  {
    docName: 'CI26-301', contractNo: 'CI26-301', completed: false, stage: 'handover',
    reviewNote: "Backfilled from Drive (Mike folder, active). Check: the sheet's Initial Contract Sum cell is EMPTY — $81,888 derived from the three payments (fully collected). Payment dates on the sheet say 2022 (year typos) — read as 2026. A VO1 marker (dated 18/05/2022) carries no amount — skipped. Ah Yang carpentry ($16,693.43) and several rows have no dates.",
    customer: { name: 'Mr. Liew & Mrs. Liew', address: '677B Punggol Dr #16-788', phone: '9091 7697' },
    projectName: 'Mr. & Mrs. Liew — 677B Punggol Dr #16-788',
    address: '677B Punggol Dr #16-788',
    startDate: '2026-03-23', agreementDate: '2026-03-23', initialSum: 81888,
    summaryLine: 'Renovation works for 677B Punggol Dr #16-788 as per signed contract CI26-301',
    milestones: [
      { kind: 'milestone', label: '10% + 40% (lump sum)', pct: null, amount: 40000, paidAmount: 40000, paidAt: '2026-03-23', paymentMethod: 'transfer', dueTrigger: 'confirmation', notes: 'Sheet shows 23/03/2022 — year typo, read as 2026' },
      { kind: 'milestone', label: 'Progress payment', pct: null, amount: 25000, paidAmount: 25000, paidAt: '2026-04-23', paymentMethod: 'transfer', notes: 'Sheet shows 23/04/2022 — year typo, read as 2026' },
      { kind: 'milestone', label: 'Final payment', pct: null, amount: 16888, paidAmount: 16888, paidAt: '2026-04-18', paymentMethod: 'transfer', notes: 'Sheet shows 18/04/2022 — year typo, read as 2026' },
    ],
    costs: [
      { date: '2026-04-04', supplier: 'Hafary Pte Ltd', inv: '2185606', amount: 2003.04 },
      { date: '2026-04-10', supplier: 'Hafary Pte Ltd', inv: '2188589', amount: 208.39 },
      { date: '2026-04-06', supplier: 'Hue Workz Pte Ltd (Hacking)', inv: '26143', amount: 2810 },
      { date: '2026-04-13', supplier: 'Hue Workz Pte Ltd (Moving)', inv: '26158', amount: 700 },
      { date: '2026-05-07', supplier: 'Daco Interior Pte Ltd', inv: 'DINV-2605-003', amount: 9801.63 },
      { date: '2026-04-21', supplier: 'YMF Group Pte Ltd', inv: '2026/81', amount: 6885.4 },
      { date: '2026-05-06', supplier: 'YMF Group Pte Ltd', inv: '2026/87', amount: 300 },
      { date: '2026-04-15', supplier: 'Yan Ho Aluminium', inv: 'YH04028', amount: 476 },
      { date: '2026-05-13', supplier: 'Hue Workz Pte Ltd (Painting)', inv: '26239', amount: 1620 },
      { date: null, supplier: 'Ah Yang Carpentry', inv: null, amount: 16693.43, notes: 'No date on costing sheet' },
      { date: '2026-05-10', supplier: 'Dynamic Glass Contractor', inv: '260512', amount: 5080 },
      { date: '2026-05-15', supplier: 'Hua Khian Co Pte Ltd (Stone)', inv: '2605-0238', amount: 4043.9 },
      { date: '2026-04-21', supplier: 'Hua Khian Co Pte Ltd (Vinyl)', inv: 'V2604-0138', amount: 1748.36 },
      { date: '2026-05-20', supplier: 'Song Aik Timber Construction', inv: '26-0501', amount: 2000 },
      { date: '2026-05-29', supplier: 'SG Plumbing Origin', inv: 'SGPO/0082/2026', amount: 1290 },
      { date: null, supplier: 'Ether Space Private Ltd', inv: null, amount: 2850, notes: 'No date on costing sheet' },
      { date: null, supplier: 'J&I Facilities Management Pte Ltd', inv: null, amount: 280, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Hue Workz Pte Ltd (Moving)', inv: null, amount: 350, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Comfort Lighting (JB)', inv: null, amount: 415, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Yong Li Electrical Engineering Service', inv: null, amount: 7000, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Abang Curtain', inv: null, amount: 1589, notes: 'No date on costing sheet' },
      { date: '2026-05-10', supplier: 'VLUX', inv: 'VX0002220', amount: 60 },
      { date: '2026-05-29', supplier: 'Plareno (Wrap Main Door)', inv: '1567', amount: 450 },
      { date: null, supplier: 'Sliding Door Arm', inv: null, amount: 160, notes: 'No date on costing sheet' },
      { date: '2026-05-19', supplier: 'YMF Group Pte Ltd', inv: '2026/90', amount: 480 },
    ],
    sheet: { contract: 81888, collected: 81888, costs: 69294.15, profit: 12593.85, commission: 10075.08 },
  },
  {
    docName: 'CI26-111', contractNo: 'CI26-111', completed: false, stage: 'carpentry',
    reviewNote: "Backfilled from Drive (Mike folder, active). Check: only the EF and the lump 40%+10% ($26,944, 22/03/2026) carry paid dates — the 45%/5%/VO amounts are typed in but undated, so they are recorded as OUTSTANDING; confirm actual collections. The EF's date cell was unreadable (serial 46302) — recorded as 10/07/2026.",
    customer: { name: 'Ray & Jeanette', address: '957A Jurong West St 93 #11-109', phone: '8298 0466' },
    projectName: 'Ray & Jeanette — 957A Jurong West St 93 #11-109',
    address: '957A Jurong West St 93 #11-109',
    startDate: '2026-03-22', agreementDate: '2026-03-27', initialSum: 56888,
    summaryLine: 'Renovation works for 957A Jurong West St 93 #11-109 as per signed contract CI26-111',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 1500, paidAt: '2026-07-10', paymentMethod: 'transfer', dueTrigger: 'confirmation', notes: 'Sheet date cell unreadable — best-effort 10/07/2026' },
      { kind: 'milestone', label: '40% + balance of 10% (lump sum)', pct: null, amount: 26944, paidAmount: 26944, paidAt: '2026-03-22', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 25599.6, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 2844.4, paidAmount: 0, paidAt: null },
      { kind: 'vo', label: 'VO1 · CI26-111', pct: null, amount: 8242, paidAmount: 0, paidAt: null },
      { kind: 'vo', label: 'VO2 · CI26-111', pct: null, amount: 1280, paidAmount: 0, paidAt: null },
    ],
    costs: [
      { date: '2026-03-13', supplier: 'Hafary Pte Ltd', inv: '1939549', amount: 3339.32 },
      { date: '2026-03-20', supplier: 'Hafary Pte Ltd', inv: '1942045', amount: 722.02 },
      { date: null, supplier: 'Hue Workz Pte Ltd (Hacking)', inv: null, amount: 630, notes: 'No date on costing sheet' },
      { date: '2026-04-10', supplier: 'Cowboy Design Pte Ltd', inv: 'DINV-2604-006', amount: 5917.55 },
      { date: null, supplier: 'YMF Group Pte Ltd', inv: null, amount: 1100, notes: 'No date on costing sheet' },
      { date: null, supplier: 'YMF Group Pte Ltd', inv: null, amount: 4602.35, notes: 'No date on costing sheet' },
      { date: null, supplier: 'YMF Group Pte Ltd', inv: null, amount: 437.5, notes: 'No date on costing sheet' },
      { date: '2026-03-30', supplier: 'Yan Ho Aluminium', inv: 'YH03064', amount: 558 },
      { date: '2026-05-12', supplier: 'Hue Workz Pte Ltd (Painting)', inv: '26236', amount: 2340 },
      { date: null, supplier: 'Ah Yang Carpentry', inv: null, amount: 18007.5, notes: 'No date on costing sheet' },
      { date: '2026-05-10', supplier: 'Dynamic Glass Contractor', inv: '260515', amount: 1810 },
      { date: '2026-05-20', supplier: 'Hua Khian Co Pte Ltd (Stone)', inv: '2605-0493', amount: 2539.7 },
      { date: null, supplier: 'SG Plumbing Origin', inv: null, amount: 920, notes: 'No date on costing sheet' },
      { date: null, supplier: 'J&I Facilities Management Pte Ltd', inv: null, amount: 350, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Aether Space Private Ltd', inv: null, amount: 4200, notes: 'No date on costing sheet' },
      { date: '2026-07-15', supplier: 'Dynamic Glass Contractor', inv: '260724', amount: 570 },
      { date: '2026-05-26', supplier: 'Dynamic Glass Contractor', inv: '260540', amount: 110 },
      { date: '2026-05-20', supplier: '99 Window Film Pte Ltd', inv: 'WF2605017', amount: 200 },
      { date: null, supplier: 'Comfort Lighting (JB)', inv: null, amount: 415, notes: 'No date on costing sheet' },
      { date: '2026-04-23', supplier: 'Abang Curtain', inv: '10368', amount: 1280 },
      { date: '2026-05-29', supplier: 'Plareno (Wrap Main Door)', inv: '1568', amount: 450 },
      { date: '2026-06-15', supplier: 'Hue Workz Pte Ltd (Hacking)', inv: '26300', amount: 400 },
      { date: '2026-05-13', supplier: 'Shopee (Mike) — lightings', inv: null, amount: 301.85 },
    ],
    sheet: { contract: 66410, collected: 28444, costs: 51200.79, profit: 15209.21, commission: 12167.37 },
  },
  {
    docName: 'CI25-072', contractNo: 'CI25-072', completed: false, stage: 'handover',
    reviewNote: "Backfilled from Drive (Mike folder, active). Check: the 50% payment was over-collected ($40,255 vs $31,944 required, +$8,311); the 45% is part-paid ($20,000 of $28,749.60); the 5% ($3,194.40) is marked Pending; VO1 paid $18,573.60 vs $19,135 on the contract side. Two Hafary refunds (−$1,322.39, −$343.92) and two unlabelled rows ($31.39, $750) are in the costs.",
    customer: { name: 'Rayson & Kimberly', address: 'Blk 988A Jurong West St 93 #06-625', phone: '8339 5499' },
    projectName: 'Rayson & Kimberly — Blk 988A Jurong West St 93 #06-625',
    address: 'Blk 988A Jurong West St 93 #06-625',
    startDate: '2025-06-10', agreementDate: '2025-06-10', initialSum: 63888,
    summaryLine: 'Renovation works for Blk 988A Jurong West St 93 #06-625 as per signed contract CI25-072',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1000, paidAmount: 1000, paidAt: '2025-06-10', paymentMethod: 'transfer', dueTrigger: 'confirmation' },
      { kind: 'milestone', label: '50% — commencement of work', pct: 50, amount: 31944, paidAmount: 40255, paidAt: '2025-09-08', paymentMethod: 'transfer', notes: 'Over-collected by $8,311 per sheet' },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 28749.6, paidAmount: 20000, paidAt: '2026-01-20', paymentMethod: 'transfer' },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 3194.4, paidAmount: 0, paidAt: null, notes: 'Marked Pending on the sheet' },
      { kind: 'vo', label: 'VO1 · CI25-072', pct: null, amount: 19135, paidAmount: 18573.6, paidAt: '2026-01-30', paymentMethod: 'transfer' },
    ],
    costs: [
      { date: '2025-08-29', supplier: 'COOPTECH IDS PTE. LTD.', inv: 'INV-IDS5808', amount: 693 },
      { date: '2025-10-31', supplier: 'Bona Design Pte Ltd', inv: 'BINV-2510-006', amount: 4910 },
      { date: '2025-11-28', supplier: 'Cowboy Design Pte Ltd', inv: '2511056', amount: 18443.77 },
      { date: '2025-11-27', supplier: 'YMF Group Pte Ltd', inv: '2025/552', amount: 7249.4 },
      { date: '2025-12-30', supplier: 'Hue Workz Pte Ltd', inv: '25572', amount: 1800 },
      { date: '2025-12-29', supplier: 'Dynamic Glass Contractor', inv: '251241', amount: 790 },
      { date: null, supplier: 'Ah Yang Carpentry', inv: null, amount: 13812.75, notes: 'No date on costing sheet' },
      { date: '2026-01-13', supplier: 'Hua Khian Co Pte Ltd (Stone)', inv: '26000570', amount: 2599.65 },
      { date: '2026-01-08', supplier: 'PD Door Pte Ltd', inv: '131059', amount: 1046.4 },
      { date: null, supplier: 'SG Plumbing Origin', inv: null, amount: 3800, notes: 'No date on costing sheet' },
      { date: null, supplier: 'J&I Facilities Management Pte Ltd', inv: null, amount: 280, notes: 'No date on costing sheet' },
      { date: '2025-11-13', supplier: 'Yan Ho Aluminium', inv: 'YH11038', amount: 640 },
      { date: '2025-10-27', supplier: 'Soon Bee Huat Trading', inv: 'CSA-AZ-026329', amount: 4226.46 },
      { date: '2025-12-20', supplier: 'SL Haus Pte Ltd', inv: 'INV-HMNB-20251220', amount: 1486 },
      { date: '2025-10-29', supplier: 'Hafary Pte Ltd', inv: '1892463', amount: 5143.88 },
      { date: null, supplier: 'Hafary Pte Ltd', inv: null, amount: 604.64, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Hafary Pte Ltd', inv: null, amount: 1235.62, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Hafary Pte Ltd', inv: null, amount: 148.24, notes: 'No date on costing sheet' },
      { date: null, supplier: 'Hafary (Refund)', inv: null, amount: -1322.39, notes: 'Refund per costing sheet' },
      { date: '2026-01-13', supplier: 'Cowboy Design Pte Ltd', inv: '2601021', amount: 350 },
      { date: null, supplier: 'Adjustment', inv: null, amount: 31.39, notes: 'Unlabelled row on the costing sheet' },
      { date: null, supplier: 'Adjustment', inv: null, amount: 750, notes: 'Unlabelled row on the costing sheet' },
      { date: '2026-03-03', supplier: 'Hafary (Refund)', inv: '353089', amount: -343.92, notes: 'Refund per costing sheet' },
    ],
    sheet: { contract: 83023, collected: 79828.6, costs: 68374.89, profit: 14648.11, commission: 11718.49 },
  },
  {
    docName: 'CI26-402', contractNo: 'CI26-402', completed: false, stage: 'signed',
    reviewNote: 'Backfilled from Drive (Mike folder, active). Check: this project has NO costing sheet in Drive — the $45,000 contract and agreement date come from the signed quotation PDF; the payment schedule is DERIVED from the standard split and nothing is recorded as collected. Please fill in the actual payments and costs.',
    customer: { name: 'Mr. Andrew & Family', address: '153A Towner Residences #35-221' },
    projectName: 'Mr. Andrew & Family — 153A Towner Residences #35-221',
    address: '153A Towner Residences #35-221',
    startDate: '2026-04-12', agreementDate: '2026-04-12', initialSum: 45000,
    summaryLine: 'Renovation works for 153A Towner Residences #35-221 as per signed contract CI26-402 ($45,000)',
    milestones: [
      { kind: 'milestone', label: 'Engagement fee', pct: null, amount: 1500, paidAmount: 0, paidAt: null, dueTrigger: 'confirmation' },
      { kind: 'milestone', label: 'Balance of 10% deposit', pct: null, amount: 3000, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '40% — commencement of work', pct: 40, amount: 18000, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '45% — carpentry fabrication', pct: 45, amount: 20250, paidAmount: 0, paidAt: null },
      { kind: 'milestone', label: '5% — handover', pct: 5, amount: 2250, paidAmount: 0, paidAt: null },
    ],
    costs: [],
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
  const costs = r2(p.costs.filter((c) => (c.status || 'approved') === 'approved').reduce((s, c) => s + c.amount, 0));
  if (p.completed && p.sheet) {
    const profit = r2(collected - costs);
    const commission = r2(profit * 0.8);
    for (const [k, got, want] of [['contract', contract, p.sheet.contract], ['collected', collected, p.sheet.collected], ['costs', costs, p.sheet.costs], ['profit', profit, p.sheet.profit], ['commission', commission, p.sheet.commission]] as const) {
      if (Math.abs((got as number) - (want as number)) > 0.011) throw new Error(`${p.docName}: ${k} mismatch — computed ${got}, sheet says ${want}`);
    }
  }

  let customer = await prisma.customer.findFirst({ where: { organizationId: CIEL, name: p.customer.name } });
  if (!customer) customer = await prisma.customer.create({ data: { organizationId: CIEL, name: p.customer.name, address: p.customer.address || null, phone: p.customer.phone || null } });

  const project = await prisma.project.create({
    data: {
      organizationId: CIEL, name: p.projectName, address: p.address || null, description: p.reviewNote,
      customerId: customer.id, status: p.completed ? 'completed' : 'ongoing', stage: p.stage,
      designer: 'Mike Leong', designerUserId: MIKE_ID, commissionPct: 80, source: 'self', startDate: D(p.startDate)!,
    },
    select: { id: true },
  });

  const quote = {
    version: 1,
    header: {
      title: 'RE: Letter of Intent & Appointment for Renovation Works at the below mentioned new address',
      contractNo: p.contractNo, clientName: p.customer.name, nric: '', address: p.address, contact: p.customer.phone || '',
      agreementDate: p.agreementDate, remarks: 'Backfilled from the signed contract (Drive) — line detail in the signed PDF',
      designer: 'Mike Leong', designerUserId: MIKE_ID, designerPhone: '', paymentTerms: 'As Mentioned Below',
    },
    sections: [{
      id: 'sec-1', letter: 'A', title: `Renovation Works — as per signed contract ${p.contractNo}`,
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
        items: [{ id: 'item-1', itemCode: '', inventoryItemId: '', description: `[Renovation Works] as per signed contract ${p.contractNo}`, quantity: 1, uom: 'lot', unitPrice: p.initialSum, amount: p.initialSum, costPrice: null, isService: true, revenueTag: 'service' }],
        customerId: customer.id, customerName: p.customer.name, customer: { id: customer.id, name: p.customer.name, address: p.customer.address },
        designer: 'Mike Leong', designerUserId: MIKE_ID,
        documentInfo: { documentNumber: p.contractNo, date: p.agreementDate, subject: quote.header.title, currency: 'SGD', taxApplicable: false, grandTotal: p.initialSum },
        backfill: 'drive-mike-folder-2026-09-15',
      } as any,
    },
    select: { id: true },
  });

  let sort = 0;
  for (const m of p.milestones) {
    await prisma.projectMilestone.create({
      data: {
        organizationId: CIEL, projectId: project.id, kind: m.kind, label: m.label, pct: m.pct, amount: m.amount,
        paidAmount: m.paidAmount, paidAt: D(m.paidAt), paymentMethod: m.paidAmount > 0 ? m.paymentMethod || 'transfer' : null,
        dueTrigger: m.dueTrigger || null, sortOrder: sort++,
      },
    });
  }
  for (const c of p.costs) {
    await prisma.projectCost.create({
      data: {
        organizationId: CIEL, projectId: project.id, date: D(c.date), supplierName: c.supplier, description: c.supplier,
        invoiceNo: c.inv, amount: c.amount, status: c.status || 'approved', source: 'import',
        createdByName: 'backfill (Drive costing sheet)', notes: c.notes || null,
      } as any,
    });
  }
  console.log(`✔ ${p.docName} — ${p.projectName} [${p.completed ? 'completed' : p.stage}]`);
  console.log(`   contract ${contract.toFixed(2)} · collected ${collected.toFixed(2)} · outstanding ${(contract - collected).toFixed(2)} · costs ${costs.toFixed(2)}`);
}

async function backfillSiusin() {
  const id = 'ba899165-dd69-4f8b-9018-2b35aff65f02';
  const pj = await prisma.project.findUnique({ where: { id }, select: { commissionPct: true, customerId: true, description: true } });
  if (!pj) return console.log('?? Siusin project not found');
  let customer = await prisma.customer.findFirst({ where: { organizationId: CIEL, name: 'Ms. Siusin & Family' } });
  if (!customer) customer = await prisma.customer.create({ data: { organizationId: CIEL, name: 'Ms. Siusin & Family', address: 'Blk 687 Jurong West Central 1 #12-165, Singapore 640691', phone: '9455 9752' } });
  const note = [
    'Backfilled from Drive (Mike folder, active). Check: the Drive costing sheet says contract $180,000 with $90,000 collected in one transfer on 22/05/2026 (10% + 40%), but the AIMS quotation CI26-003 totals $14,019.69 and its milestones are seeded from that — the two disagree and were NOT merged; please reconcile which is right.',
    "The sheet's contract number CI26-502 belongs to 119 Teck Whye — CI26-003 (AIMS) kept.",
    'Sheet costing so far: Bona Design hacking $6,020 (added). Existing AIMS cost YAN HO YH08080 $4,351.40 is not on the sheet.',
  ].join('\n');
  await prisma.project.update({
    where: { id },
    data: {
      commissionPct: pj.commissionPct ?? 80,
      source: 'self',
      startDate: D('2026-05-10')!,
      customerId: pj.customerId || customer.id,
      description: pj.description && !pj.description.startsWith('Backfilled') ? pj.description : note,
    },
  });
  const hasBona = await prisma.projectCost.findFirst({ where: { projectId: id, invoiceNo: 'BINV-2606-001' }, select: { id: true } });
  if (!hasBona) {
    await prisma.projectCost.create({
      data: {
        organizationId: CIEL, projectId: id, date: D('2026-06-10'), supplierName: 'Bona Design Pte Ltd', description: 'Bona Design Pte Ltd (Hacking)',
        invoiceNo: 'BINV-2606-001', amount: 6020, status: 'approved', source: 'import', createdByName: 'backfill (Drive costing sheet)',
      } as any,
    });
  }
  console.log('✔ Siusin backfilled — commission 80%, start 10/05/2026, customer linked, Bona cost added, discrepancy note set');
}

async function main() {
  const tmpl = await prisma.documentTemplate.findFirst({ where: { organizationId: CIEL, type: 'QUOTATION' }, orderBy: { createdAt: 'asc' } });
  if (!tmpl) throw new Error('no CIEL quotation template');
  for (const p of PROJECTS) await importOne(p, tmpl.id);
  await backfillSiusin();
  console.log('\nMike folder imported. Review notes are on the dashboard "Project notes" card.');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
