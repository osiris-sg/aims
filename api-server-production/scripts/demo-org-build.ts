/**
 * DEMO INDUSTRIES PTE. LTD. — a sales-demo org (guru, 2026-10-14).
 *
 * Mirrors Biofuel's SETUP exactly (feature flags, modules, roles, chart of
 * accounts, tax codes, number formats, document templates) but carries data
 * that is entirely invented: every customer, supplier, site, asset, document
 * number and contact is generated here. Nothing identifying is copied from
 * Biofuel — only the structure that makes the screens behave like the real
 * product.
 *
 *   npx ts-node scripts/demo-org-build.ts --stage config [--apply]
 *   npx ts-node scripts/demo-org-build.ts --stage data   [--apply]
 *   npx ts-node scripts/demo-org-build.ts --stage login  [--apply]
 *   npx ts-node scripts/demo-org-build.ts --stage all    [--apply]
 *   npx ts-node scripts/demo-org-build.ts --stage wipe   --apply   (data only)
 *
 * --env prod (default) | staging | dev      --apply writes; default is a DRY RUN.
 *
 * SAFETY
 *  - Every write is scoped to DEMO_ORG_ID, which is fixed, so re-running is
 *    idempotent and nothing can land in a client org. assertDemoOnly() refuses
 *    any row carrying a different organizationId.
 *  - xeroId is nulled on every cloned row (it is GLOBALLY unique — a demo must
 *    never steal Biofuel's Xero links) and no XeroConnection is created, so the
 *    demo org can never sync to a real Xero tenant.
 *  - Data is generated from a FIXED seed, so a re-run reproduces the same demo
 *    rather than drifting.
 *
 * The money ties: every invoice, bill and payment writes its own balanced
 * double entry, so the GL, the AR/AP ageing and the P&L all agree.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { randomUUID } from 'crypto';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'prod') || 'prod') as 'dev' | 'staging' | 'prod';
const STAGE = (argVal('--stage', 'all') || 'all') as 'config' | 'data' | 'login' | 'all' | 'wipe';
const APPLY = args.includes('--apply');
const N_CUSTOMERS = Number(argVal('--customers', '30')) || 30;
const N_SUPPLIERS = Number(argVal('--suppliers', '20')) || 20;
const MONTHS = Number(argVal('--months', '14')) || 14;

const envFile = ENV === 'dev' ? '.env' : ENV === 'staging' ? '.env.staging' : '.env.production';
dotenv.config({ path: path.resolve(__dirname, '..', envFile), override: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

export const DEMO_ORG_ID = 'de300000-0000-4000-8000-de3000000001';
export const DEMO_NAME = 'DEMO INDUSTRIES PTE. LTD.';
const GST = 0.09;

// ── deterministic RNG ──────────────────────────────────────────────────────
// A fixed seed so the demo is reproducible: re-running after a wipe rebuilds
// the SAME company rather than a different one each time.
let _seed = 0x5eed1234;
const rnd = () => {
  _seed |= 0;
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const R2 = (n: number) => Math.round(n * 100) / 100;

// ── invented identities ────────────────────────────────────────────────────
const PLACE = ['Granite', 'Harbour', 'Meridian', 'Summit', 'Vantage', 'Crestline', 'Pioneer', 'Eastgate', 'Riverbend', 'Northpoint', 'Woodgate', 'Silverline', 'Brightwater', 'Stonebridge', 'Fairmount', 'Kingsway', 'Oakfield', 'Westbourne', 'Clearpoint', 'Ironside', 'Lakeview', 'Redhill', 'Greenmark', 'Blueline', 'Highgate', 'Parkway', 'Seaview', 'Foxglove', 'Amberton', 'Castleton', 'Dunmore', 'Elmgrove'];
const CUST_SUFFIX = ['Construction Pte Ltd', 'Engineering Pte Ltd', 'Builders Pte Ltd', 'Civil Engineering Pte Ltd', 'Contracts Pte Ltd', 'Infrastructure Pte Ltd', 'Development Pte Ltd', 'Marine Pte Ltd'];
const SUPP_SUFFIX = ['Equipment Pte Ltd', 'Hardware Supplies Pte Ltd', 'Machinery Pte Ltd', 'Industrial Trading Pte Ltd', 'Logistics Pte Ltd', 'Chemicals Pte Ltd', 'Services Pte Ltd'];
const STREET = ['Jalan Pemimpin', 'Tuas Avenue 8', 'Kaki Bukit Road 3', 'Ubi Crescent', 'Sungei Kadut Way', 'Pioneer Sector 2', 'Defu Lane 10', 'Woodlands Industrial Park E5', 'Tampines Industrial Ave 5', 'Bukit Batok Crescent', 'Senoko Loop', 'Loyang Way'];
const GIVEN = ['Marcus', 'Priya', 'Daniel', 'Siti', 'Wei Ming', 'Rachel', 'Haziq', 'Joanne', 'Terence', 'Nadia', 'Kelvin', 'Farah', 'Lionel', 'Divya', 'Samuel', 'Mei Ling'];
const FAMILY = ['Tan', 'Lim', 'Rahman', 'Kumar', 'Ng', 'Chua', 'Devi', 'Goh', 'Ismail', 'Wong', 'Pillai', 'Koh'];
const SITE = ['Blk 212 Tampines Ave 5', 'Woodlands Drive 16', 'Punggol Field Walk', 'Bukit Batok West Ave 9', 'Sengkang East Way', 'Jurong West St 41', 'Yishun Ring Road', 'Clementi Ave 4', 'Hougang Ave 10', 'Bedok North Road', 'Queenstown Ring Road', 'Serangoon North Ave 1'];

// Generic rental catalogue — the shape of Biofuel's business without its
// product names.
const CATALOGUE = [
  { sku: 'AQ375', name: 'AquaGuard 375 Treatment Unit', rate: 6100, kind: 'rental' },
  { sku: 'AQ500', name: 'AquaGuard 500 Treatment Unit', rate: 7400, kind: 'rental' },
  { sku: 'FM60', name: 'FlowMax 60 Membrane Rack', rate: 2000, kind: 'rental' },
  { sku: 'FM100', name: 'FlowMax 100 Membrane Rack', rate: 2500, kind: 'rental' },
  { sku: 'CS10', name: 'ClearStream Filter AF-10', rate: 900, kind: 'rental' },
  { sku: 'CS40', name: 'ClearStream Filter AF-40', rate: 1500, kind: 'rental' },
  { sku: 'SW100', name: 'SiltWatch Imaging Unit', rate: 450, kind: 'rental' },
  { sku: 'TSS100', name: 'TurbidityProbe TSS-100', rate: 300, kind: 'rental' },
  { sku: 'SP200', name: 'SolarPak 200 Panel', rate: 180, kind: 'rental' },
  { sku: 'DG30', name: 'GenSet DG-30', rate: 1200, kind: 'rental' },
  { sku: 'PP5', name: 'PumpPro Submersible 5kW', rate: 640, kind: 'rental' },
  { sku: 'POLY', name: 'Polymer Flocculant (23kg bag)', rate: 31, kind: 'sale' },
];
const SERVICES = [
  { code: 'SV001', name: 'Two-way transport charge', rate: 240 },
  { code: 'SV002', name: 'Installation and commissioning', rate: 850 },
  { code: 'SV003', name: 'Site servicing visit', rate: 320 },
  { code: 'SV004', name: 'Disposal and disposal permit', rate: 165 },
];
const EXPENSES = [
  { code: '429', label: 'Workshop consumables' },
  { code: '400', label: 'Advertising and marketing' },
  { code: '404', label: 'Bank charges' },
  { code: '449', label: 'Vehicle running costs' },
  { code: '620', label: 'Insurance prepayment' },
];

// ── id mapping for the structural clone ───────────────────────────────────
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const idMap = new Map<string, string>();
const mapId = (old: string) => {
  if (!idMap.has(old)) idMap.set(old, randomUUID());
  return idMap.get(old)!;
};
const rewrite = <T>(row: T): T =>
  JSON.parse(JSON.stringify(row).replace(UUID_RE, (m) => idMap.get(m) ?? idMap.get(m.toLowerCase()) ?? m));

/** Refuses to write a row that is not scoped to the demo org. */
function assertDemoOnly(rows: any[], label: string) {
  for (const r of rows) {
    if ('organizationId' in r && r.organizationId !== DEMO_ORG_ID) {
      throw new Error(`REFUSED: ${label} carries organizationId=${r.organizationId}, expected the demo org`);
    }
  }
}
async function insertMany(model: any, label: string, rows: any[]) {
  assertDemoOnly(rows, label);
  console.log(`  ${label.padEnd(30)} ${rows.length}`);
  if (!APPLY || !rows.length) return;
  for (let i = 0; i < rows.length; i += 500) {
    await model.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
  }
  // skipDuplicates hides a unique-constraint clash, and a dropped master row
  // then breaks every child FK further down. Verify the count landed.
  const ids = rows.map((r: any) => r.id).filter(Boolean);
  if (ids.length) {
    const got = await model.count({ where: { id: { in: ids } } });
    if (got !== ids.length) {
      throw new Error(`${label}: only ${got}/${ids.length} rows exist after insert — a unique constraint silently dropped ${ids.length - got}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE: config — the structural clone
// ═══════════════════════════════════════════════════════════════════════════
async function stageConfig(SRC: string, src: any) {
  console.log('\n── config ────────────────────────────────────────────');
  idMap.set(SRC, DEMO_ORG_ID);

  const orgData: any = {
    ...src,
    id: DEMO_ORG_ID,
    name: DEMO_NAME,
    address: '15 Harbour Industrial Road, #03-02, Singapore 118000',
    phoneNumber: '6700 0100',
    registrationNumber: 'DEMO2026IND',
  };
  delete orgData.createdAt;
  delete orgData.updatedAt;
  console.log(`  Organization                   ${DEMO_NAME}`);
  if (APPLY) await p.organization.upsert({ where: { id: DEMO_ORG_ID }, update: {}, create: orgData });

  const clone = async (model: any, label: string, rows: any[], fix?: (r: any) => any) => {
    for (const r of rows) mapId(r.id);
    let out = rows.map(rewrite);
    if (fix) out = out.map(fix);
    await insertMany(model, label, out);
    return out;
  };

  await clone(p.organizationUIConfig, 'OrganizationUIConfig', await p.organizationUIConfig.findMany({ where: { organizationId: SRC } }));
  await clone(p.organizationModule, 'OrganizationModule', await p.organizationModule.findMany({ where: { organizationId: SRC } }));

  // Roles carry an M:N to global Permission rows — create individually so the
  // permission links come across.
  const roles = await p.role.findMany({ where: { organizationId: SRC }, include: { permissions: { select: { id: true } } } });
  for (const r of roles) mapId(r.id);
  console.log(`  Role                           ${roles.length}`);
  if (APPLY) {
    for (const r of roles) {
      if (await p.role.findFirst({ where: { organizationId: DEMO_ORG_ID, name: r.name }, select: { id: true } })) continue;
      await p.role.create({
        data: {
          id: mapId(r.id),
          name: r.name,
          description: r.description,
          allowedModules: r.allowedModules,
          organizationId: DEMO_ORG_ID,
          permissions: { connect: r.permissions.map((x: any) => ({ id: x.id })) },
        },
      });
    }
  }

  await clone(p.category, 'Category', await p.category.findMany({ where: { organizationId: SRC } }));
  // xeroId is globally unique — the demo must never hold a real Xero link.
  await clone(p.chartOfAccount, 'ChartOfAccount', await p.chartOfAccount.findMany({ where: { organizationId: SRC } }), (a) => ({ ...a, xeroId: null, xeroLastSyncAt: null }));
  await clone(p.accountingSetting, 'AccountingSetting', await p.accountingSetting.findMany({ where: { organizationId: SRC } }));
  await clone(p.taxRate, 'TaxRate', await p.taxRate.findMany({ where: { organizationId: SRC } }));
  await clone(p.costCenter, 'CostCenter', await p.costCenter.findMany({ where: { organizationId: SRC } }));
  // Sequences restart at 1 so demo numbering looks like a young company.
  await clone(p.documentNumberFormat, 'DocumentNumberFormat', await p.documentNumberFormat.findMany({ where: { organizationId: SRC } }).catch(() => []), (f) => ({ ...f, nextSerial: 1 }));

  // Templates are a cross-org SHARED pool and edits propagate to every org that
  // activated them — so the demo gets its OWN copies, never Biofuel's rows.
  const activations = await p.organizationActiveTemplate.findMany({ where: { organizationId: SRC } });
  const own = await p.documentTemplate.findMany({ where: { organizationId: SRC }, select: { id: true } });
  const tplIds = new Set<string>([...activations.map((a: any) => a.templateId), ...own.map((t: any) => t.id)]);
  const templates = tplIds.size ? await p.documentTemplate.findMany({ where: { id: { in: [...tplIds] } } }) : [];
  await clone(p.documentTemplate, 'DocumentTemplate', templates, (t) => ({ ...t, organizationId: DEMO_ORG_ID }));
  await clone(p.organizationActiveTemplate, 'OrganizationActiveTemplate', activations);
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE: data — invented masters and transactions
// ═══════════════════════════════════════════════════════════════════════════
async function stageData() {
  console.log('\n── data ──────────────────────────────────────────────');

  const accounts = await p.chartOfAccount.findMany({ where: { organizationId: DEMO_ORG_ID }, select: { id: true, code: true } });
  if (!accounts.length) throw new Error('No chart of accounts for the demo org — run --stage config first.');
  const acc = new Map<string, string>(accounts.map((a: any) => [a.code, a.id]));
  const need = (code: string) => {
    const id = acc.get(code);
    if (!id) throw new Error(`Demo chart of accounts is missing account ${code}`);
    return id;
  };
  const AR = need('610'), AP = need('800'), TAX = need('820'), BANK = need('100');
  const REV_RENT = need('200'), REV_SALE = need('227');

  const cats = await p.category.findMany({ where: { organizationId: DEMO_ORG_ID }, select: { id: true, name: true } });
  const cat = cats.find((c: any) => /rental|equipment/i.test(c.name)) || cats[0];
  const catId = cat?.id;
  const catName = cat?.name || 'Equipment';

  const tpls = await p.documentTemplate.findMany({ where: { organizationId: DEMO_ORG_ID }, select: { id: true, type: true } });
  const tplFor = (type: string) => (tpls.find((t: any) => t.type === type) || tpls[0])?.id || 'demo-template';

  // ── masters ──────────────────────────────────────────────────────────────
  const used = new Set<string>();
  const uniqueName = (suffixes: string[]) => {
    for (let i = 0; i < 200; i++) {
      const n = `${pick(PLACE)} ${pick(suffixes)}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
    return `${pick(PLACE)} ${Date.now()} ${pick(suffixes)}`;
  };
  // Names are unique, so a full-name slug is a unique domain. Deriving it
  // from the FIRST word collided (many names share a place word) and
  // @@unique([email, organizationId]) then had createMany silently drop them.
  const slug = (n: string) => n.toLowerCase().replace(/\bpte\b|\bltd\b/g, '').replace(/[^a-z0-9]+/g, '');
  const person = () => `${pick(GIVEN)} ${pick(FAMILY)}`;
  const addr = () => `${int(1, 90)} ${pick(STREET)}, #0${int(1, 7)}-${String(int(1, 40)).padStart(2, '0')}, Singapore ${int(100000, 759999)}`;
  const phone = () => `${pick(['6', '8', '9'])}${int(1000000, 9999999)}`;

  const customers = Array.from({ length: N_CUSTOMERS }, (_, i) => {
    const name = uniqueName(CUST_SUFFIX);
    return {
      id: randomUUID(), organizationId: DEMO_ORG_ID, name,
      customerCode: `CD${String(i + 1).padStart(3, '0')}`,
      email: `accounts@${slug(name)}.com.sg`,
      phone: phone(), address: addr(), xeroId: null,
    };
  });
  await insertMany(p.customer, 'Customer', customers);

  const contacts = customers.filter(() => rnd() < 0.7).map((c) => ({
    id: randomUUID(), customerId: c.id, name: person(), email: c.email, phone: phone(),
    designation: pick(['Project Manager', 'QS', 'Site Engineer', 'Accounts Executive', 'Procurement']),
  }));
  await insertMany(p.customerContact, 'CustomerContact', contacts);

  const suppliers = Array.from({ length: N_SUPPLIERS }, (_, i) => {
    const name = uniqueName(SUPP_SUFFIX);
    return {
      id: randomUUID(), organizationId: DEMO_ORG_ID, name,
      supplierCode: `SP${String(i + 1).padStart(3, '0')}`,
      email: `sales@${slug(name)}.com.sg`,
      phone: phone(), address: addr(), xeroId: null,
    };
  });
  await insertMany(p.supplier, 'Supplier', suppliers);

  const assets = CATALOGUE.map((c) => ({
    id: randomUUID(), organizationId: DEMO_ORG_ID, name: c.name, skuKey: c.sku,
    categoryId: catId, uom: c.kind === 'sale' ? 'BAG' : 'UNIT',
    price: c.rate, isTracked: c.kind !== 'sale',
    salesAccountCode: c.kind === 'sale' ? '227' : null,
    rentalAccountCode: c.kind === 'rental' ? '200' : null,
  }));
  await insertMany(p.asset, 'Asset', assets);

  const units: any[] = [];
  for (const a of assets.filter((x) => x.isTracked)) {
    for (let i = 1; i <= int(2, 5); i++) {
      units.push({
        id: randomUUID(), organizationId: DEMO_ORG_ID, assetId: a.id,
        sku: `${a.skuKey}-${String(i).padStart(3, '0')}`,
        serialNumber: `${a.skuKey}${int(100000, 999999)}`,
        category: catName, location: pick(['Main Yard', 'Workshop', 'On site']),
        status: rnd() < 0.45 ? 'rental' : 'instock',
      });
    }
  }
  await insertMany(p.inventory, 'Inventory', units);

  // ── transactions ─────────────────────────────────────────────────────────
  const today = new Date();
  const monthStart = (back: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const stamp = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

  const docs: any[] = [], journals: any[] = [], lines: any[] = [], payments: any[] = [];
  let jn = 1, invSeq = 0, doSeq = 0, qoSeq = 0;
  const jNext = () => `JV-${String(jn++).padStart(6, '0')}`;

  /** One balanced entry. legs are [accountId, debit, credit, narrative]. */
  const postJournal = (o: { date: Date; type: string; reference: string; description: string; docId?: string; payId?: string; legs: Array<[string, number, number, string]> }) => {
    const id = randomUUID();
    const td = R2(o.legs.reduce((s, l) => s + l[1], 0));
    const tc = R2(o.legs.reduce((s, l) => s + l[2], 0));
    if (Math.abs(td - tc) > 0.005) throw new Error(`Unbalanced demo journal ${o.reference}: ${td} vs ${tc}`);
    journals.push({
      id, organizationId: DEMO_ORG_ID, journalNumber: jNext(), entryDate: o.date, type: o.type,
      status: 'POSTED', reference: o.reference, description: o.description,
      totalDebit: td, totalCredit: tc, currency: 'SGD',
      sourceDocumentId: o.docId ?? null, sourcePaymentId: o.payId ?? null,
      postedAt: o.date, postedBy: 'demo-seed', createdBy: 'demo-seed',
    });
    o.legs.forEach((l, i) => lines.push({
      id: randomUUID(), journalEntryId: id, accountId: l[0], lineNumber: i + 1,
      description: l[3], debit: R2(l[1]), credit: R2(l[2]),
    }));
  };

  const makeInvoice = (cust: any, date: Date, items: any[], refText: string, rentalSide: boolean) => {
    const sub = R2(items.reduce((s, it) => s + (it.amount || 0), 0));
    const tax = R2(sub * GST);
    const gross = R2(sub + tax);
    invSeq++;
    const name = `DI${stamp(date)}${String(invSeq).padStart(3, '0')}`;
    const due = new Date(date.getTime() + 30 * 86400000);
    const ageDays = Math.floor((today.getTime() - date.getTime()) / 86400000);

    // Ageing profile. Most customers settle on terms, but a stable ~20% are
    // SLOW PAYERS whose invoices stay open however old they get — without them
    // every bucket past 60 days is empty and the ageing report demos as a flat
    // two-column table instead of the collections problem it exists to show.
    const slow = (cust.customerCode.charCodeAt(2) + cust.customerCode.charCodeAt(4)) % 5 === 0;
    let paid = 0;
    if (slow) paid = ageDays > 200 ? gross : 0;
    else if (ageDays > 75) paid = gross;
    else if (ageDays > 45) paid = R2(gross * 0.5);
    const outstanding = R2(gross - paid);
    const status = paid >= gross ? 'paid' : 'pending_payment';

    const id = randomUUID();
    docs.push({
      id, organizationId: DEMO_ORG_ID, type: 'INVOICE', name, status,
      documentTemplateId: tplFor('INVOICE'),
      config: {
        documentNumber: name, date: ymd(date), dueDate: ymd(due), currency: 'SGD',
        customerId: cust.id, customerName: cust.name, customerAddress: cust.address,
        billTo: `${cust.name}\n${cust.address}`,
        items, subTotal: sub, gstAmount: tax, gstPercent: 9, taxApplicable: 'Y',
        nettTotal: gross, totalWithTax: gross, grossTotal: sub,
        outstandingBalance: outstanding, paidToDate: paid, amountPaid: paid,
        paymentStatus: status, paymentTerms: '30 DAYS',
        referenceNo: refText,
        documentInfo: {
          date: ymd(date), documentNumber: name, referenceNo: refText,
          subTotal: sub, gstAmount: tax, gstPercent: 9, currency: 'SGD', paymentTerms: '30 DAYS',
        },
        voided: false,
      },
      createdAt: date, updatedAt: date,
    });

    postJournal({
      date, type: 'INVOICE', reference: `INV ${name}`, description: `Invoice ${name} — ${cust.name}`, docId: id,
      legs: [
        [AR, gross, 0, `${cust.name} — ${name}`],
        [rentalSide ? REV_RENT : REV_SALE, 0, sub, refText],
        [TAX, 0, tax, 'GST output 9%'],
      ],
    });

    if (paid > 0) {
      const payDate = new Date(Math.min(due.getTime() + int(-5, 20) * 86400000, today.getTime() - 86400000));
      const payId = randomUUID();
      payments.push({
        id: payId, organizationId: DEMO_ORG_ID, documentId: id, customerId: cust.id,
        amount: paid, paymentDate: payDate, paymentMethod: pick(['bank_transfer', 'cheque', 'giro']),
        reference: `RCPT-${String(invSeq).padStart(4, '0')}`,
        createdBy: 'demo-seed',
      });
      postJournal({
        date: payDate, type: 'PAYMENT', reference: `REC RCPT-${String(invSeq).padStart(4, '0')}`,
        description: `Receipt from ${cust.name} — ${name}`, docId: id, payId,
        legs: [[BANK, paid, 0, `Receipt ${name}`], [AR, 0, paid, `${cust.name} — ${name}`]],
      });
    }
    return { id, name, gross };
  };

  // Active rentals: a delivery order, then a monthly rental invoice per month.
  const renters = customers.slice(0, Math.ceil(N_CUSTOMERS * 0.6));
  for (const cust of renters) {
    const kit = CATALOGUE.filter((c) => c.kind === 'rental');
    const main = pick(kit);
    const addOn = pick(kit.filter((k) => k.sku !== main.sku));
    const site = pick(SITE);
    const started = int(2, MONTHS);
    doSeq++;
    const doDate = monthStart(started);
    const doName = `DO${stamp(doDate)}-${String(doSeq).padStart(3, '0')}`;
    docs.push({
      id: randomUUID(), organizationId: DEMO_ORG_ID, type: 'DELIVERY_ORDER', name: doName,
      status: 'delivered_installed', documentTemplateId: tplFor('DELIVERY_ORDER'),
      config: {
        documentNumber: doName, date: ymd(doDate), customerId: cust.id, customerName: cust.name,
        deliveryTo: site, referenceNo: `Deployment at ${site}`,
        items: [
          { lineNumber: 1, itemCode: main.sku, description: `${main.name} — delivered to ${site}`, quantity: 1, unitPrice: null, amount: null, uom: 'UNIT' },
          { lineNumber: 2, itemCode: addOn.sku, description: addOn.name, quantity: 1, unitPrice: null, amount: null, uom: 'UNIT' },
        ],
        voided: false,
      },
      createdAt: doDate, updatedAt: doDate,
    });

    for (let m = started; m >= 0; m--) {
      const d = monthStart(m);
      const nth = started - m + 1;
      const rate = main.rate + addOn.rate;
      const items = [
        { id: int(1e6, 9e6), lineNumber: 1, itemCode: '', description: `Rental period ${ymd(d)} to ${ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))} - ${nth}${nth === 1 ? 'st' : nth === 2 ? 'nd' : nth === 3 ? 'rd' : 'th'} mth`, quantity: null, unitPrice: null, amount: null },
        { id: int(1e6, 9e6), lineNumber: 2, itemCode: main.sku, description: `Rental of one set ${main.name}\nincluding ${addOn.name}`, quantity: 1, unitPrice: rate, amount: rate, uom: 'UNIT' },
      ];
      makeInvoice(cust, d, items, `${site} - ${doName} 1x${main.sku}`, true);
    }
  }

  // One-off sales and service invoices for the remaining customers.
  for (const cust of customers.slice(renters.length)) {
    for (let k = 0; k < int(1, 3); k++) {
      const d = monthStart(int(1, MONTHS));
      const sale = pick(CATALOGUE.filter((c) => c.kind === 'sale'));
      const svc = pick(SERVICES);
      const qty = int(10, 120);
      const items = [
        { id: int(1e6, 9e6), lineNumber: 1, itemCode: sale.sku, description: `${sale.name} (${qty} bags)`, quantity: qty, unitPrice: sale.rate, amount: R2(qty * sale.rate), uom: 'BAG' },
        { id: int(1e6, 9e6), lineNumber: 2, itemCode: svc.code, description: svc.name, quantity: 1, unitPrice: svc.rate, amount: svc.rate, isService: true },
      ];
      makeInvoice(cust, d, items, `Supply to ${pick(SITE)}`, false);
    }
  }

  // Quotations — pipeline for the sales screens.
  for (const cust of customers.slice(0, 15)) {
    const d = monthStart(int(0, 3));
    qoSeq++;
    const kit = pick(CATALOGUE.filter((c) => c.kind === 'rental'));
    const name = `QO${stamp(d)}-${String(qoSeq).padStart(4, '0')}`;
    const amt = kit.rate * int(1, 3);
    docs.push({
      id: randomUUID(), organizationId: DEMO_ORG_ID, type: 'QUOTATION', name,
      status: pick(['unconfirmed', 'unconfirmed', 'confirmed']), documentTemplateId: tplFor('QUOTATION'),
      config: {
        documentNumber: name, date: ymd(d), customerId: cust.id, customerName: cust.name,
        customerAddress: cust.address, referenceNo: `Proposal for ${pick(SITE)}`,
        items: [{ lineNumber: 1, itemCode: kit.sku, description: `${kit.name} — monthly rental`, quantity: 1, unitPrice: amt, amount: amt, uom: 'UNIT' }],
        subTotal: amt, gstAmount: R2(amt * GST), gstPercent: 9, nettTotal: R2(amt * (1 + GST)), totalWithTax: R2(amt * (1 + GST)),
        voided: false,
      },
      createdAt: d, updatedAt: d,
    });
  }

  // Supplier bills — AP ageing and the expense side of the P&L.
  let billSeq = 0;
  for (const sup of suppliers) {
    for (let k = 0; k < int(2, 5); k++) {
      const d = monthStart(int(1, MONTHS));
      const exp = pick(EXPENSES);
      const net = R2(int(200, 6000) + rnd());
      const tax = R2(net * GST);
      const gross = R2(net + tax);
      billSeq++;
      const name = `SINV-${String(4000 + billSeq)}`;
      const ageDays = Math.floor((today.getTime() - d.getTime()) / 86400000);
      const paid = ageDays > 60 ? gross : 0;
      const id = randomUUID();
      docs.push({
        id, organizationId: DEMO_ORG_ID, type: 'BILL', name,
        status: paid >= gross ? 'paid' : 'pending_payment', documentTemplateId: tplFor('BILL'),
        config: {
          documentNumber: name, date: ymd(d), billDate: ymd(d), dueDate: ymd(new Date(d.getTime() + 30 * 86400000)),
          supplierId: sup.id, supplierName: sup.name, currency: 'SGD',
          items: [{ lineNumber: 1, itemCode: exp.code, description: exp.label, quantity: 1, unitPrice: net, amount: net, accountCode: exp.code }],
          subTotal: net, gstAmount: tax, gstPercent: 9, nettTotal: gross, totalWithTax: gross,
          outstandingBalance: R2(gross - paid), paidToDate: paid, amountPaid: paid,
          referenceNo: `${sup.name} — ${exp.label}`, kind: 'SIN', voided: false,
        },
        createdAt: d, updatedAt: d,
      });
      postJournal({
        date: d, type: 'INVOICE', reference: `SIN ${name}`, description: `Bill ${name} — ${sup.name}`, docId: id,
        legs: [[need(exp.code), net, 0, exp.label], [TAX, tax, 0, 'GST input 9%'], [AP, 0, gross, sup.name]],
      });
      if (paid > 0) {
        const pd = new Date(d.getTime() + int(25, 50) * 86400000);
        postJournal({
          date: pd, type: 'PAYMENT', reference: `P/V ${name}`, description: `Payment to ${sup.name} — ${name}`, docId: id,
          legs: [[AP, gross, 0, sup.name], [BANK, 0, gross, `Payment ${name}`]],
        });
      }
    }
  }

  await insertMany(p.document, 'Document', docs);
  await insertMany(p.payment, 'Payment', payments);
  await insertMany(p.journalEntry, 'JournalEntry', journals);
  await insertMany(p.journalEntryLine, 'JournalEntryLine', lines);

  const td = R2(lines.reduce((s, l) => s + l.debit, 0));
  const tc = R2(lines.reduce((s, l) => s + l.credit, 0));
  console.log(`\n  GL check: debits ${td.toLocaleString()} vs credits ${tc.toLocaleString()} → ${Math.abs(td - tc) < 0.01 ? 'BALANCED' : 'OUT OF BALANCE'}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE: wipe — clear generated data, keep the configured shell
// ═══════════════════════════════════════════════════════════════════════════
async function stageWipe() {
  console.log('\n── wipe (data only; config kept) ─────────────────────');
  if (!APPLY) { console.log('  DRY RUN — nothing deleted'); return; }
  const jes = await p.journalEntry.findMany({ where: { organizationId: DEMO_ORG_ID }, select: { id: true } });
  await p.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jes.map((j: any) => j.id) } } });
  await p.journalEntry.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
  await p.payment.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
  await p.document.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
  await p.inventory.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
  await p.asset.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
  const cs = await p.customer.findMany({ where: { organizationId: DEMO_ORG_ID }, select: { id: true } });
  await p.customerContact.deleteMany({ where: { customerId: { in: cs.map((c: any) => c.id) } } });
  await p.customer.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
  await p.supplier.deleteMany({ where: { organizationId: DEMO_ORG_ID } });
  console.log('  data cleared');
}


// ═══════════════════════════════════════════════════════════════════════════
// STAGE: login — the Clerk demo user, Admin on the demo org only
// ═══════════════════════════════════════════════════════════════════════════
const DEMO_EMAIL = argVal('--email', 'demo.industries@ai-ms.io')!;
// guru 2026-10-15: plain "password" — trivial to type in front of a prospect,
// and safe because this org holds only generated data and the login is Admin
// on it alone. Clerk needs skipPasswordChecks to accept it.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'password';

async function stageLogin() {
  console.log('\n── login ─────────────────────────────────────────────');
  const admin = await p.role.findFirst({ where: { organizationId: DEMO_ORG_ID, name: 'Admin' }, select: { id: true } });
  if (!admin) throw new Error('Admin role missing on the demo org — run --stage config first.');
  console.log(`  user    ${DEMO_EMAIL}`);
  console.log('  role    Admin on the demo org only (no access to any client org)');
  if (!APPLY) return;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClerkClient } = require('@clerk/backend');
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const found = await clerk.users.getUserList({ emailAddress: [DEMO_EMAIL] });
  let userId: string;
  if (found.data.length) {
    userId = found.data[0].id;
    console.log(`  ↷ clerk user exists ${userId}`);
  } else {
    const u = await clerk.users.createUser({
      emailAddress: [DEMO_EMAIL], password: DEMO_PASSWORD,
      firstName: 'Demo', lastName: 'Industries', skipPasswordChecks: true,
    } as any);
    userId = u.id;
    console.log(`  ✔ clerk user created ${userId}`);
  }
  if (!(await p.userOrganization.findFirst({ where: { userId, organizationId: DEMO_ORG_ID }, select: { id: true } }))) {
    await p.userOrganization.create({ data: { userId, organizationId: DEMO_ORG_ID } as any });
  }
  if (!(await p.userRole.findFirst({ where: { userId, organizationId: DEMO_ORG_ID, roleId: admin.id }, select: { id: true } }))) {
    await p.userRole.create({ data: { userId, organizationId: DEMO_ORG_ID, roleId: admin.id, isActive: true } as any });
  }
  console.log(`  ✔ ready — ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

async function main() {
  console.log(`env=${ENV}  stage=${STAGE}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}`);
  if (STAGE === 'wipe') { await stageWipe(); return; }

  const src = await p.organization.findFirst({ where: { name: { contains: 'Biofuel' } } });
  if (!src) throw new Error('Biofuel org not found in this environment');
  console.log(`Source shape: ${src.name} (${src.id})`);

  if (STAGE === 'config' || STAGE === 'all') await stageConfig(src.id, src);
  if (STAGE === 'data' || STAGE === 'all') await stageData();
  if (STAGE === 'login' || STAGE === 'all') await stageLogin();

  console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE'} — demo org ${DEMO_ORG_ID}`);
  if (!APPLY) console.log('Re-run with --apply to write.');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => p.$disconnect());
