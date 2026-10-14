/**
 * Bootstrap for the ADH Japan org (aluminium trading — Shipments module).
 * Modelled on setup-ciel-org.ts, with two differences that matter:
 *   - NO AccountingSetting / chart of accounts. With neither present every GL
 *     auto-post is a silent no-op, so Sales documents have no ledger side effects.
 *   - Works against BOTH database layouts:
 *       --target=public   shared "public" schema (how prod/staging run)
 *       --target=tenancy  dev per-org layout: platform rows → "platform",
 *                         org rows → "org_adhjapan" (generated clients in
 *                         node_modules/.prisma-tenancy/{platform,org-adhjapan})
 *
 * Dry-run by default (previews every step, even for a brand-new org).
 * Idempotent — safe to re-run with --apply.
 *
 *   npx ts-node --transpile-only scripts/setup-adh-org.ts --target=tenancy
 *   npx ts-node --transpile-only scripts/setup-adh-org.ts --target=public --apply
 *   ... --link-osiris-admins      also give Osiris superadmins the ADH Staff role
 *   ... --confirm-prod            required with --apply when DATABASE_URL is prod
 *   ... --seal=<path.png|jpg>     set the company seal printed on 請求書 (kept out of the repo;
 *                                 without it an existing seal is left as is)
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws = require('ws');
import { DEFAULT_DOCUMENT_TEMPLATES } from '../src/organizations/default-templates';
import { DEFAULT_ORG_FEATURES } from '../src/organizations/default-features';
import { MODULE_CATALOG } from '../src/configuration/module-catalog';

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const CONFIRM_PROD = argv.includes('--confirm-prod');
const LINK_OSIRIS_ADMINS = argv.includes('--link-osiris-admins');
const TARGET = argv.find((a) => a.startsWith('--target='))?.split('=')[1] as 'public' | 'tenancy' | undefined;
const SEAL_PATH = argv.find((a) => a.startsWith('--seal='))?.slice('--seal='.length);

// Known Neon endpoints (HANDOFF.md §3a): dev = ep-steep-truth, staging = ep-odd-truth, prod = ep-icy-moon.
const PROD_HOST = 'ep-icy-moon';
const STAGING_HOST = 'ep-odd-truth';

// ── ADH configuration ────────────────────────────────────────────────────────
const ORG_NAME = 'Asia Deal Hub Japan LLC';
const ORG_SCHEMA = 'org_adhjapan';
const ORG_PRISMA_FILE = 'orgs/adhjapan.prisma';
const PLACEHOLDER_ORG_ID = '<new-org-id>';
const OSIRIS_ORG_ID = 'd068f159-e45a-4da8-beaf-62e903f44141'; // Osiris Technology — source of superadmins

// Organization has no email / legal-name columns: those values are reported, not stored.
const ORG_FIELDS = {
  address: '2-14-5 Akasaka, 7F Daiwa Akasaka Bldg, Minato-ku, Tokyo, Japan 107-0052',
  phoneNumber: '+81 90-8048-4006',
  registrationNumber: 'T7010403028176',
  defaultCurrency: 'USD',
  taxRate: 0,
  taxApplicable: false,
  absorbTax: false,
};
const ORG_UNSTORED = { legalName: 'Asia Deal Hub Japan LLC', email: 'finance@asiadealhub.com' };

// "ADH Staff" is master tier: only Designer / Junior Manager / Senior Manager /
// Marketing are scoped (src/common/role-tier.ts, TopNavBar SCOPED_ROLES), so this
// role sees the Org Settings → Master Files menu.
const ROLE_NAME = 'ADH Staff';
const ROLE_DESCRIPTION = 'ADH Japan staff — shipments, sales documents, master files';
const ROLE_MODULES = ['SHIPMENTS', 'SALES', 'INVOICES', 'DOCUMENTS', 'USER_MANAGEMENT', 'AUDIT'];
// Whole resources granted (every action that exists in the Permission table).
const ROLE_RESOURCES = ['shipments', 'documents', 'customers', 'suppliers', 'users', 'uploads', 'payments'];
// Individual permissions on top of the resources above.
const ROLE_EXTRA_PERMISSIONS = [
  'customers:create-by-name', // also covered by the customers resource; listed so a missing row is reported
  'roles:read',
  'audit:read',
  'configuration:read',
  'documentTemplates:read', // the document editor loads the org's templates
  'documentTemplates:read-one',
];
// Never granted. accounting:read alone would let GET /accounting/settings
// lazily create an AccountingSetting row (accounting-settings.service getOrCreate).
const FORBIDDEN_RESOURCES = ['accounting', 'journal', 'orders', 'bills', 'bankrec', 'xerosync', 'statements'];

// Permissions created if missing (step 2). customers:create-by-name is seeded by
// prisma/seed.ts but absent from the dev org_osiris catalogue step 1b copies, and
// the document editor's inline "new customer" calls POST /customers/create-by-name.
const ENSURED_PERMISSIONS = [
  { resource: 'shipments', action: 'read', description: 'Can view contracts, shipments, steps and trade documents' },
  { resource: 'shipments', action: 'create', description: 'Can create contracts and shipments and upload trade documents' },
  { resource: 'shipments', action: 'update', description: 'Can edit contracts/shipments and change step status' },
  { resource: 'shipments', action: 'delete', description: 'Can delete contracts, shipments and trade documents' },
  { resource: 'customers', action: 'create-by-name', description: 'Can create customers by name only (field flows)' },
];

// Per-org overrides of the catalog entry, written to ADH's own module row only.
// INVOICES: the catalog entry is the legacy /portal/invoices module (still the
// default for orgs without a stored row), so ADH's row points at the new
// /portal/invoicing page, which reuses the shared invoice list + editor.
// DOCUMENTS: the catalog entry is the legacy /portal/documents module (still the
// default elsewhere), so ADH's row points a plain "Documents" menu (no
// sub-menus) at the trade documents hub /portal/trade-documents.
// ORDER: ADH's top nav reads Shipments, Invoices, Documents, Sales, User
// Management, Audit (Org Settings is a fixed trailing item). The portal pins
// SALES at 0.5 for every org (ORDER_OVERRIDE in TopNavBar / the sidebar), so
// ADH's own rows put its trade modules BELOW that with negative sortOrders —
// the global rule and every other org stay untouched. User Management (8) and
// Audit (9) keep their catalog order.
const ENABLED_MODULES: Array<{ code: string; route?: string; icon?: string; sortOrder?: number; subMenus?: Array<{ key: string; label: string }> }> = [
  {
    code: 'SHIPMENTS',
    sortOrder: -3, // first — before the global Sales pin (0.5)
    subMenus: [
      { key: 'list', label: 'Shipments' },
      { key: 'contracts', label: 'Contracts' },
    ],
  },
  {
    code: 'INVOICES',
    route: '/portal/invoicing',
    icon: 'ReceiptLong',
    sortOrder: -2, // right after Shipments
    subMenus: [{ key: 'list', label: 'Invoices' }],
  },
  {
    code: 'DOCUMENTS',
    route: '/portal/trade-documents',
    icon: 'FolderCopy',
    sortOrder: -1, // after Invoices, still before Sales
    subMenus: [],
  },
  {
    code: 'SALES',
    subMenus: [
      { key: 'quotations', label: 'Quotation' },
      { key: 'credit-notes', label: 'Credit Note' },
      { key: 'debit-notes', label: 'Debit Note' },
    ],
  },
  { code: 'USER_MANAGEMENT' },
  { code: 'AUDIT' },
];

const FEATURE_OVERRIDES: Record<string, boolean> = {
  enableActionLog: true,
  enableConfirmQuotation: false, // keeps quotation confirm from auto-creating Orders
};

const NUMBER_FORMATS = [
  { documentType: 'QUOTATION', pattern: 'ADH-QT-{YYYY}-{####}' },
  { documentType: 'INVOICE', pattern: 'ADH-INV-{YYYY}-{####}' },
  { documentType: 'CREDIT_NOTE', pattern: 'ADH-CN-{YYYY}-{####}' },
  { documentType: 'DEBIT_NOTE', pattern: 'ADH-DN-{YYYY}-{####}' },
];

// Documents-hub categories (TradeDocType.category).
const DOC_CATEGORIES = ['SUPPLIER', 'CUSTOMER', 'INVOICES', 'CUSTOMS_LOGISTICS', 'PAYMENTS', 'OTHER'] as const;
type DocCategory = (typeof DOC_CATEGORIES)[number];

const DOC_TYPES: Array<[string, string, DocCategory]> = [
  ['CONTRACT', 'Sales contract', 'SUPPLIER'],
  ['PI', 'Proforma invoice', 'SUPPLIER'],
  ['DEPOSIT_PROOF', 'Deposit payment proof', 'PAYMENTS'],
  ['INVOICE_1', 'Invoice #1', 'INVOICES'],
  ['BL_DRAFT', 'B/L draft', 'SUPPLIER'],
  ['BL', 'Bill of lading', 'SUPPLIER'],
  ['CI', 'Commercial invoice', 'SUPPLIER'],
  ['PL', 'Packing list', 'SUPPLIER'],
  ['COA', 'Certificate of analysis', 'SUPPLIER'],
  ['COO', 'Certificate of origin', 'SUPPLIER'],
  ['INSURANCE', 'Insurance certificate', 'SUPPLIER'],
  ['CUSTOMER_COA', 'Customer COA', 'CUSTOMER'],
  ['CUSTOMER_PL', 'Customer packing list', 'CUSTOMER'],
  ['CI_PAYMENT_PROOF', 'CI payment proof', 'PAYMENTS'],
  ['SGJP_IV_PL', 'SG→JP invoice & packing list', 'CUSTOMS_LOGISTICS'],
  ['TAX_ESTIMATE', 'Import tax estimate', 'CUSTOMS_LOGISTICS'],
  ['ARRIVAL_NOTICE', 'Arrival notice', 'CUSTOMS_LOGISTICS'],
  ['SHIPPING_INSTRUCTIONS', 'Shipping instructions', 'CUSTOMS_LOGISTICS'],
  ['TELEX_RELEASE', 'Telex release / surrender notice', 'CUSTOMS_LOGISTICS'],
  ['DELIVERY_SCHEDULE', 'Delivery schedule', 'CUSTOMS_LOGISTICS'],
  ['IMPORT_PERMIT', 'Import permit', 'CUSTOMS_LOGISTICS'],
  ['INVOICE_2', 'Invoice #2', 'INVOICES'],
  ['VENDOR_INVOICE', 'Vendor invoice', 'PAYMENTS'],
  ['PAYMENT_PROOF', 'Payment proof', 'PAYMENTS'],
  ['OTHER', 'Other', 'OTHER'],
];

// Org-level B/L instruction defaults (TradeSetting), copied into each new contract.
const TRADE_SETTINGS = {
  defaultConsignee: 'ASIA DEAL HUB JAPAN LLC.\nADDRESS: 2-14-5 AKASAKA, 7F DAIWA AKASAKA BLDG,\nMINATO-KU, TOKYO, JAPAN 107-0052\nPHONE: +(81) 90-8048-4006\nTax ID: 7010403028176',
  defaultNotifyParty:
    'ASIA DEAL HUB PTE. LTD.\n12 MARINA BOULEVARD 17-01, TOWER 3 MARINA BAY FINANCIAL CENTRE,\nSINGAPORE 018982\nCONTACT PERSON: TOSHIRO TAKEKOSHI\nEmail: toshiro.takekoshi@asiadealhub.com\nTEL: +65 9815 1089\nUnique Entity Number: 201931733Z',
  // Default texts for documents made in-app (ADH 請求書, SG→JP INVOICE & PACKING LIST, 計量検収票,
  // 納品書兼分析試験成績報告書, 出庫・納入依頼書), taken from ADH's own sheets. Placeholders:
  // {grade} (one subject line per grade) or {grades} (joined), {product} (subject); {grade} {size} {inch} {qty} {tol}
  // (invoice line); {month} {LME} {QMJP} {q} (QMJP quarter) {premium} {upcharge} {totalPremium} (helper remarks);
  // {date} (due line); {range} (customs FX week); {qty} {rate} (Invoice #2 cost lines). Keys not listed here
  // (e.g. sealImage, set with --seal or in the app) are left as they are.
  docDefaults: {
    invoiceFromBlock: 'アジアディールハブジャパン合同会社\n〒107-0052\n東京都港区赤坂二丁目14-5\nDaiwa赤坂ビル7階',
    invoiceSubjectTemplate: '{grade}{product}品',
    productJa: { 'Aluminium Billet': 'アルミニウムビレット' },
    invoiceLineTemplate:
      'Aluminium Billet - {grade} as per Specification of {inch}-\n{qty}MT +- {tol}% Tolerance\n製品仕様は貴社指定仕様\n\n暫定LME・QMJP価格のため仮単価。最終価格との差分は2回目の通関・輸送費の請求書で調整',
    invoiceRemarksTemplate: 'LME Cash {month}月平均({LME}USD) +{QMJP}({q}QMJP) +{premium}(Billet Premium){upcharge}\n\nTotal Premium is {QMJP}({q}QMJP) + {totalPremium}',
    invoiceUpchargeTemplate: ' +{upcharge}(upcharge for {grade})',
    sizeInch: { '152': '6 inch', '162': '6 inch', '178': '7 inch', '203': '8 inch' },
    invoiceDueLine: '{date} までにお支払いをお願い致します。',
    invoiceFxNote: '円/USD 税関{range} 外国為替相場参照',
    invoiceConditions: '・納入条件ートラック積替え貴社指定先に納入（車上渡し）。\n　最終価格（船積み月LME平均）との差分、通関・国内輸送費、諸係については別途見積書・請求書を発行。',
    invoicePaymentTerms: '・請求書発行　7営業日以内　弊社指定口座振込',
    // 弊社指定口座: each invoice picks one (DBS by default).
    banks: [
      {
        id: 'dbs',
        label: 'DBS Bank Ltd',
        block:
          'DBS Bank Ltd\nBank address\t12 Marina Boulevard Level 3 Mbfc Tower 3, Singapore 018982\nBank/Branch Code\t7171/288 (USD)\nBank SWIFT/BIC\tDBSSSGSG\nBeneficiary name\tAsia Deal Hub Pte. Ltd.\nBeneficiary Bank Account No:  2889046798',
      },
      {
        id: 'cfsb',
        label: 'Community Federal Savings Bank',
        block:
          'Community Federal Savings Bank\nBank address\t30 W. 26th Street, Sixth Floor New York NY 10010 United States\nRouting number\t026073150\nBank SWIFT/BIC\tCMFGUS33\nBeneficiary name\tAsia Deal Hub Pte. Ltd.\nBeneficiary Bank Account No: 8311208644',
      },
    ],
    defaultBankId: 'dbs',
    // Invoice #2 (2回目): final price, then customs / transport / other costs.
    invoice2LineTemplate: 'Aluminium Billet - {grade} as per Specification of {inch}-\n{qty}MT +- {tol}% Tolerance\n製品仕様は貴社指定仕様',
    invoice2RemarksTemplate: 'LME Cash月平均　{month}月USD{LME} + {QMJP}({q}QMJP) +{premium}(Billet Premium){upcharge}\nTotal Premium is {QMJP}(QMJP) + {totalPremium}',
    invoice2CustomsTaxableLabel: '通関、車輸送料\n　課税対象　消費税率10％',
    invoice2CustomsTaxableRemarks:
      '商　品：アルミビレット\n荷　姿：バンドル\n取扱数量：{qty} トン/月\n保管倉庫：三井倉庫 本牧事務所・大黒事務所\n取扱港　：横浜港\n保管条件：野積保管\n業務範囲：横浜CY到着後、輸入通関、ドレージ、デバン入出庫、NO.取り作業、保管、貴社工場への配送まで',
    invoice2CustomsLabel: '通関\n　課税対象外',
    invoice2OtherLabel: '他諸掛\n　課税対象　消費税率10％',
    invoice2OtherPerMt: 40,
    invoice2OtherRemarks: '{rate}USD/ton\n（{qty}トン/月)',
    invoiceTaxRate: 10,
    invoiceUnit: 'トン',
    invoiceDueBusinessDays: 7,
    sgSellerBlock: 'Asia Deal Hub Pte. Ltd.\n12 Marina Boulevard #17-01, Tower 3 Marina Bay Financial Centre\nSingapore 018982\nUEN: 201931733Z',
    siTo: 'Mitsui Soko Co., Ltd.',
    siFromBlock: 'アジアディールハブジャパン合同会社 / Asia Deal Hub Japan LLC\n〒107-0052 東京都港区赤坂二丁目14-5 Daiwa赤坂ビル7階\nTEL: +81 90-8048-4006',
    // SG→JP INVOICE & PACKING LIST (the Shipper is the supplier's master record when it has an address).
    sgjpShipperBlock: 'VEDANTA LIMITED (SEZ UNIT)\nVILLAGE BHURKHAMUNDA, KUREBAGA & BRUNDAMAL,\nJHARSUGUDA, ODISHA-768202, INDIA',
    sgjpConsigneeBlock: 'ASIA DEAL HUB JAPAN LLC.\nADDRESS: 2-14-5 AKASAKA, 7F DAIWA AKASAKA BLDG,\nMINATO-KU, TOKYO, JAPAN 107-0052\nPHONE: +(81) 90-8048-4006',
    sgjpSellerBlock: 'ASIA DEAL HUB PTE. LTD.\n12 MARINA BOULEVARD 17-01,\nTOWER 3 MARINA BAY FINANCIAL CENTRE,\nSINGAPORE, 018982\nTOSHIRO.TAKEKOSHI@ASIADEALHUB.COM\n+65 9815 1089',
    sgjpBuyerBlock: 'ASIA DEAL HUB JAPAN LLC.\nADDRESS: 2-14-5 AKASAKA, 7F DAIWA AKASAKA BLDG,\nMINATO-KU, TOKYO, JAPAN 107-0052\nPHONE: +(81) 90-8048-4006',
    sgjpSignBlock: 'ASIA DEAL HUB PTE. LTD.\n12 MARINA BOULEVARD 17-01,\nTOWER 3 MARINA BAY FINANCIAL CENTRE,\nSINGAPORE, 018982\n+65 9815 1089',
    sgjpDimension: '5800mm length, \n8 inch diameter',
    // 計量検収票 / 納品書兼分析試験成績報告書: issued by アジアディールハブ合同会社 (as on ADH's samples).
    customerDocIssuerName: 'アジアディールハブ合同会社',
    customerDocIssuerAddress: '東京都港区赤坂二丁目14-5\nDaiwa赤坂ビル7階',
    customerDocContact: '竹腰 俊朗',
    customerPlFormLabel: '様式2',
    customerPlApplicant: 'ASIA DEAL HUB PTE. LTD.\n12 MARINA BOULEVARD 17-01, TOWER 3 MARINA BAY FINANCIAL CENTRE, SINGAPORE-018982, SINGAPORE',
    customerCoaFormLabel: '様式 1',
    customerCoaVendor: 'VEDANTA LIMITED',
    customerCoaPiecesPerBundle: 5,
    customerCoaWeightUnit: 'MT',
    // 出庫・納入依頼書 to the warehouse, with the customer's delivery site.
    siWarehouseTo: '三井倉庫 株式会社',
    siIssuerName: 'アジアディールハブジャパン合同会社',
    siWarehouseName: '三井倉庫/本牧A倉庫',
    siCarrier: '三井倉庫手配便',
    siBilletLabel: 'ロングビレット',
    deliveryProfiles: [
      {
        id: 'sus-fukushima',
        customerName: 'SUS',
        siteName: 'SUS福島工場',
        address: '福島県須賀川市虹の台21-1',
        notes: 'AM7:30より作業開始、下側の敷地へ搬入（看板表記Ａより入場）\nバンド切れ外れはリバンドル\nトラック荷台左右に積載（真ん中はNG）',
      },
    ],
  } as Record<string, unknown>,
};

type StepSpec = { scope: 'CONTRACT' | 'SHIPMENT'; sortOrder: number; code: string; displayNo: string; title: string; requiredDocTypes: string[]; isOngoing?: boolean };
const STEP_TEMPLATES: StepSpec[] = [
  { scope: 'CONTRACT', sortOrder: 10, code: 'PI_PAYMENT', displayNo: '1', title: 'Set up PI payment', requiredDocTypes: ['PI', 'DEPOSIT_PROOF'] },
  { scope: 'CONTRACT', sortOrder: 20, code: 'INVOICE_1', displayNo: '2', title: 'Issue Invoice #1', requiredDocTypes: ['INVOICE_1'] },
  { scope: 'SHIPMENT', sortOrder: 10, code: 'BL_DRAFT_APPROVAL', displayNo: '2', title: 'Approve B/L draft (Vedanta)', requiredDocTypes: ['BL_DRAFT'] },
  { scope: 'SHIPMENT', sortOrder: 20, code: 'SHIPPING_DOCS', displayNo: '3', title: 'Receive shipping documents', requiredDocTypes: ['BL', 'CI', 'PL', 'COA', 'COO', 'INSURANCE'] },
  { scope: 'SHIPMENT', sortOrder: 30, code: 'CUSTOMER_DOCS', displayNo: '4', title: 'Create customer documents', requiredDocTypes: ['CUSTOMER_COA', 'CUSTOMER_PL'] },
  { scope: 'SHIPMENT', sortOrder: 40, code: 'SEND_DOCS_SCHEDULE', displayNo: '5', title: 'Send documents & ask schedule', requiredDocTypes: [] },
  { scope: 'SHIPMENT', sortOrder: 50, code: 'CI_PAYMENT', displayNo: '6', title: 'Set up CI payment', requiredDocTypes: ['CI_PAYMENT_PROOF'] },
  { scope: 'SHIPMENT', sortOrder: 60, code: 'CUSTOMS_TAX_ESTIMATE', displayNo: '7', title: 'Customs documents & tax estimate', requiredDocTypes: ['SGJP_IV_PL', 'TAX_ESTIMATE'] },
  { scope: 'SHIPMENT', sortOrder: 70, code: 'TAX_FUNDS', displayNo: '8', title: 'Prepare import-tax funds', requiredDocTypes: [] },
  {
    scope: 'SHIPMENT',
    sortOrder: 80,
    code: 'AN_INSTRUCTIONS',
    displayNo: '9',
    title: 'Send arrival notice & shipping instructions',
    requiredDocTypes: ['ARRIVAL_NOTICE', 'SHIPPING_INSTRUCTIONS', 'TELEX_RELEASE', 'DELIVERY_SCHEDULE'],
  },
  { scope: 'SHIPMENT', sortOrder: 90, code: 'IMPORT_PERMIT', displayNo: '10', title: 'Store & send import permit', requiredDocTypes: ['IMPORT_PERMIT'] },
  { scope: 'SHIPMENT', sortOrder: 100, code: 'INVOICE_2', displayNo: '11', title: 'Issue Invoice #2', requiredDocTypes: ['INVOICE_2'] },
  { scope: 'SHIPMENT', sortOrder: 110, code: 'LOGISTICS_PAYMENT', displayNo: '12', title: 'Pay transport & storage costs', requiredDocTypes: ['VENDOR_INVOICE', 'PAYMENT_PROOF'] },
  { scope: 'SHIPMENT', sortOrder: 120, code: 'XERO_HANDOFF', displayNo: '13', title: 'Prepare Xero handoff', requiredDocTypes: [] },
  { scope: 'SHIPMENT', sortOrder: 130, code: 'DELIVERY_CHANGES', displayNo: '14', title: 'Coordinate delivery changes', requiredDocTypes: [], isOngoing: true },
];

// Supplier/Customer have no UEN column; gstRegNo is a GST number, so the UEN is
// only reported.
const SUPPLIERS = [
  { name: 'Vedanta Aluminium Metal Limited', currency: 'USD' },
  { name: 'Mitsui Soko Co., Ltd.', currency: 'JPY', note: 'warehouse' },
  { name: 'Asia Deal Hub Pte. Ltd.', currency: 'USD', note: 'intra-company, UEN 201931733Z (no UEN field — not stored)' },
];
const CUSTOMERS = [
  // jp*: printed on the Japanese documents (請求書 name only; 計量検収票 / 納品書兼… name + address + contact).
  {
    name: 'SUS Co., Ltd.',
    currency: 'USD',
    jpName: 'SUS株式会社',
    jpAddress: '〒962-0728 福島県須賀川市虹の台21-1',
    jpContact: '福島製造グループ 押出チーム 有馬 英幸 (TEL 0248-89-1210)',
  },
  { name: 'Kato Light Metal Industry Co., Ltd.', currency: 'USD' },
  { name: 'Houei', currency: 'USD' },
];

const USERS_TO_ADD = ['sayaka.matsuki', 'toshiro.takekoshi', 'natsumi', 'finance'].map((u) => `${u}@asiadealhub.com`);

const TRADE_TABLES = ['TradeDocType', 'Contract', 'Shipment', 'TradeStepTemplate', 'TradeStep', 'TradeFile', 'TradeFileLink'];

// ── helpers ──────────────────────────────────────────────────────────────────
const writes: string[] = [];
const blockers: string[] = [];
const write = (step: string, msg: string) => {
  writes.push(`${step}: ${msg}`);
  console.log(`  ${APPLY ? '' : '[dry] '}${msg}`);
};
const info = (msg: string) => console.log(`  ${msg}`);
const header = (n: string, title: string) => console.log(`\n── ${n}. ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);

function dbUrlParts() {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return { host: u.hostname || '(unknown)', database: u.pathname.replace(/^\//, '') || '(unknown)' };
  } catch {
    return { host: '(unparseable)', database: '(unparseable)' };
  }
}

function neonAdapter(schema: string) {
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.delete('pool_timeout');
  url.searchParams.delete('connect_timeout');
  url.searchParams.delete('schema');
  return new PrismaNeon({ connectionString: url.toString() }, { schema });
}

function loadGenerated(name: string): any | null {
  const dir = path.join(process.cwd(), 'node_modules/.prisma-tenancy', name);
  if (!fs.existsSync(path.join(dir, 'index.js'))) return null;
  return require(dir);
}

async function main() {
  // ── Pre-flight ─────────────────────────────────────────────────────────────
  if (TARGET !== 'public' && TARGET !== 'tenancy') {
    console.error('❌ --target=public|tenancy is required (no default).');
    process.exit(1);
  }
  const { host, database } = dbUrlParts();
  const isProd = host.includes(PROD_HOST);
  const isStaging = host.includes(STAGING_HOST);
  console.log(`\n🏢 ${ORG_NAME} org bootstrap`);
  console.log(`   host:     ${host}${isProd ? '  ⚠ PRODUCTION' : isStaging ? '  (staging)' : ''}`);
  console.log(`   database: ${database}`);
  console.log(`   target:   ${TARGET}${TARGET === 'tenancy' ? ` (platform + ${ORG_SCHEMA})` : ' (public)'}`);
  console.log(`   mode:     ${APPLY ? 'APPLY' : 'DRY RUN'}${LINK_OSIRIS_ADMINS ? '  +link-osiris-admins' : ''}`);

  if (isProd && TARGET === 'tenancy') {
    console.error('❌ Production runs the shared schema — --target=tenancy is not valid against it.');
    process.exit(1);
  }
  if (APPLY && isProd && !CONFIRM_PROD) {
    console.error('❌ DATABASE_URL is production. Re-run with --confirm-prod to write.');
    process.exit(1);
  }
  if (!MODULE_CATALOG.some((m) => m.moduleCode === 'SHIPMENTS')) {
    console.error('❌ MODULE_CATALOG has no SHIPMENTS entry — register the module first.');
    process.exit(1);
  }

  // Clients. plat = platform-level rows, org = org-scoped rows. In the public
  // target both are the main client on schema "public".
  let plat: any;
  let org: any = null;
  if (TARGET === 'public') {
    const { PrismaClient } = require('@prisma/client');
    plat = new PrismaClient({ adapter: neonAdapter('public') });
    org = plat;
  } else {
    const P = loadGenerated('platform');
    if (!P) {
      console.error('❌ node_modules/.prisma-tenancy/platform is missing — run `npm run tenancy:generate`.');
      process.exit(1);
    }
    plat = new P.PrismaClient({ adapter: neonAdapter('platform') });
    const O = loadGenerated('org-adhjapan');
    if (O) org = new O.PrismaClient({ adapter: neonAdapter(ORG_SCHEMA) });
    else blockers.push('generated client node_modules/.prisma-tenancy/org-adhjapan is missing → run `npm run tenancy:generate`');
  }

  const orgSchema = TARGET === 'public' ? 'public' : ORG_SCHEMA;
  const tableRows: Array<{ table_name: string }> = await plat.$queryRawUnsafe(`SELECT table_name::text AS table_name FROM information_schema.tables WHERE table_schema = $1`, orgSchema);
  const tables = new Set(tableRows.map((r) => r.table_name));
  const missingTrade = TRADE_TABLES.filter((t) => !tables.has(t));
  const pushCmd =
    TARGET === 'public'
      ? '`npm run db:push` (dev) / `npm run db:push:staging` / `npm run db:push:prod`'
      : `npx prisma db push --skip-generate --schema prisma/tenancy/orgs/adhjapan.prisma  (with DATABASE_URL=…?schema=${ORG_SCHEMA})`;
  if (tables.size === 0) blockers.push(`schema "${orgSchema}" does not exist → push it: ${pushCmd}`);
  else if (missingTrade.length) blockers.push(`tables missing in "${orgSchema}": ${missingTrade.join(', ')} → push: ${pushCmd}`);
  if (TARGET === 'public' && org && !org.tradeDocType) {
    blockers.push('@prisma/client has no Trade* models → run `npx prisma generate` after the schema change');
  }

  if (blockers.length) {
    console.log('\n⛔ Pre-flight blockers:');
    for (const b of blockers) console.log(`   - ${b}`);
    if (APPLY) {
      console.error('\n❌ Not applying while blockers remain.');
      process.exit(1);
    }
    console.log('   (dry run continues; org-schema reads are treated as empty)');
  }
  // org-schema reads are only possible when the client + schema exist.
  const orgReady = !!org && tables.size > 0;
  const tradeReady = orgReady && missingTrade.length === 0 && !!org.tradeDocType;
  const orgRead = async <T>(fn: () => Promise<T>, empty: T): Promise<T> => (orgReady ? fn() : empty);
  const tradeRead = async <T>(fn: () => Promise<T>, empty: T): Promise<T> => (tradeReady ? fn() : empty);

  // ── 1. Organization (+ tenancy registry) ──────────────────────────────────
  header('1', 'Organization');
  let orgRow = await plat.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (orgRow) {
    if (APPLY) await plat.organization.update({ where: { id: orgRow.id }, data: ORG_FIELDS });
    write('org', `update "${ORG_NAME}" [${orgRow.id}]: address, phoneNumber, registrationNumber, USD, tax 0 / off`);
  } else if (APPLY) {
    orgRow = await plat.organization.create({ data: { name: ORG_NAME, ...ORG_FIELDS }, select: { id: true } });
    write('org', `created "${ORG_NAME}" [${orgRow.id}]`);
  } else {
    write('org', `create "${ORG_NAME}" (USD, taxRate 0, taxApplicable false, absorbTax false, address, phone, reg no ${ORG_FIELDS.registrationNumber})`);
  }
  info(`not stored (no column): legal name "${ORG_UNSTORED.legalName}", email ${ORG_UNSTORED.email}`);
  const orgId: string = orgRow?.id ?? PLACEHOLDER_ORG_ID;
  let permSource: string | undefined; // tenancy: schema the Permission catalogue is copied from
  const orgExists = !!orgRow;

  if (TARGET === 'tenancy') {
    header('1b', 'Tenancy registry + Permission catalogue');
    const tenant = orgExists ? await plat.orgTenant.findUnique({ where: { organizationId: orgId } }) : null;
    if (tenant && tenant.schemaName === ORG_SCHEMA && tenant.status === 'ACTIVE') {
      info(`OrgTenant exists (${tenant.schemaName}, ${tenant.status})`);
    } else {
      if (APPLY) {
        await plat.orgTenant.upsert({
          where: { organizationId: orgId },
          update: { schemaName: ORG_SCHEMA, prismaFile: ORG_PRISMA_FILE, status: 'ACTIVE' },
          create: { organizationId: orgId, schemaName: ORG_SCHEMA, prismaFile: ORG_PRISMA_FILE, status: 'ACTIVE' },
        });
      }
      write('tenancy', `upsert platform."OrgTenant" (${orgId}, ${ORG_SCHEMA}, ${ORG_PRISMA_FILE}, ACTIVE)`);
    }

    // Same approach as prisma/redesign/sql/<org>/2_copy.sql: copy every Permission row, same ids.
    const srcRows: Array<{ table_schema: string }> = await plat.$queryRawUnsafe(
      `SELECT table_schema::text AS table_schema FROM information_schema.tables WHERE table_name = 'Permission' AND table_schema IN ('public', 'org_osiris') ORDER BY table_schema = 'public' DESC`,
    );
    const src = srcRows[0]?.table_schema;
    permSource = src;
    if (!src) {
      blockers.push('no Permission source table (public / org_osiris) found');
      info('⚠ no Permission source table found');
    } else {
      const [{ n: srcCount }] = await plat.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${src}"."Permission"`);
      const have = tables.has('Permission') ? (await plat.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${ORG_SCHEMA}"."Permission"`))[0].n : 0;
      if (APPLY) {
        await plat.$executeRawUnsafe(
          `INSERT INTO "${ORG_SCHEMA}"."Permission" ("id","name","description","resource","action","createdAt","updatedAt")
           SELECT "id","name","description","resource","action","createdAt","updatedAt" FROM "${src}"."Permission"
           ON CONFLICT DO NOTHING`,
        );
      }
      write('tenancy', `copy Permission rows ${src} → ${ORG_SCHEMA}: ${srcCount} in source, ${have} already present`);
    }
  }

  // ── 2. Permissions (shipments:*, customers:create-by-name) ────────────────
  header('2', 'Permissions');
  for (const p of ENSURED_PERMISSIONS) {
    const name = `${p.resource}:${p.action}`;
    const existing = await orgRead(() => org.permission.findUnique({ where: { name } }), null);
    if (existing) {
      info(`${name} exists`);
      continue;
    }
    if (APPLY) await org.permission.upsert({ where: { name }, update: { description: p.description }, create: { name, description: p.description, resource: p.resource, action: p.action } });
    write('permission', `create ${name}`);
  }

  // ── 3. Role ───────────────────────────────────────────────────────────────
  header('3', `Role "${ROLE_NAME}"`);
  // Before org_adhjapan exists, preview against the catalogue that step 1b copies in.
  const allPerms: Array<{ id: string; name: string; resource: string }> = orgReady
    ? await org.permission.findMany({ select: { id: true, name: true, resource: true } })
    : permSource
      ? await plat.$queryRawUnsafe(`SELECT id, name, resource FROM "${permSource}"."Permission"`)
      : [];
  const permByName = new Map(allPerms.map((p) => [p.name, p]));
  // Step 2's permissions may not exist yet in a dry run — count them as planned.
  for (const p of ENSURED_PERMISSIONS) {
    const name = `${p.resource}:${p.action}`;
    if (!permByName.has(name)) permByName.set(name, { id: `(new) ${name}`, name, resource: p.resource });
  }
  const granted = [...permByName.values()].filter((p) => ROLE_RESOURCES.includes(p.resource) || ROLE_EXTRA_PERMISSIONS.includes(p.name));
  const leaked = granted.filter((p) => FORBIDDEN_RESOURCES.includes(p.resource));
  if (leaked.length) throw new Error(`forbidden permissions selected: ${leaked.map((p) => p.name).join(', ')}`);
  const missingExtras = ROLE_EXTRA_PERMISSIONS.filter((n) => !permByName.has(n));
  info(
    `permission list (${granted.length}): ${
      granted
        .map((p) => p.name)
        .sort()
        .join(', ') || '(none — catalogue unreadable in this dry run)'
    }`,
  );
  if (missingExtras.length) info(`⚠ not in the Permission table (skipped): ${missingExtras.join(', ')}`);
  if (!orgReady && permSource) info(`(previewed against ${permSource}."Permission" — the catalogue step 1b copies)`);
  if (!allPerms.length) info('⚠ Permission catalogue not readable yet — list above is only the shipments:* rows');

  const existingRole = orgExists ? await orgRead(() => org.role.findFirst({ where: { organizationId: orgId, name: ROLE_NAME } }), null) : null;
  let roleId: string | null = existingRole?.id ?? null;
  if (APPLY) {
    // Re-read so freshly created shipments:* rows have their real ids.
    const ids = (await org.permission.findMany({ where: { name: { in: granted.map((p) => p.name) } }, select: { id: true } })).map((p: any) => ({ id: p.id }));
    if (existingRole) {
      await org.role.update({ where: { id: existingRole.id }, data: { description: ROLE_DESCRIPTION, allowedModules: ROLE_MODULES, permissions: { set: ids } } });
    } else {
      const r = await org.role.create({ data: { organizationId: orgId, name: ROLE_NAME, description: ROLE_DESCRIPTION, allowedModules: ROLE_MODULES, permissions: { connect: ids } } });
      roleId = r.id;
    }
  }
  write('role', `${existingRole ? 'sync' : 'create'} "${ROLE_NAME}" — modules ${ROLE_MODULES.join('/')}, ${granted.length} permissions`);

  // ── 4. Modules ────────────────────────────────────────────────────────────
  header('4', 'Modules');
  const enabledCodes = new Set(ENABLED_MODULES.map((m) => m.code));
  for (const cat of MODULE_CATALOG) {
    const wanted = ENABLED_MODULES.find((m) => m.code === cat.moduleCode);
    const enabled = enabledCodes.has(cat.moduleCode);
    const config = {
      ...cat.config,
      ...(wanted?.route ? { route: wanted.route } : {}),
      ...(wanted?.subMenus ? { subMenus: wanted.subMenus } : {}),
    };
    const row = { enabled, displayName: cat.displayName, icon: wanted?.icon ?? cat.icon, sortOrder: wanted?.sortOrder ?? cat.sortOrder, config };
    if (APPLY) {
      await plat.organizationModule.upsert({
        where: { organizationId_moduleCode: { organizationId: orgId, moduleCode: cat.moduleCode } },
        update: row,
        create: { organizationId: orgId, moduleCode: cat.moduleCode, ...row },
      });
    }
    write(
      'module',
      `${cat.moduleCode.padEnd(20)} ${enabled ? 'ON ' : 'off'}${enabled ? `  order ${row.sortOrder}` : ''}${wanted?.route ? `  ${wanted.route}` : ''}${wanted?.subMenus ? `  (${wanted.subMenus.map((s) => s.key).join(', ')})` : ''}`,
    );
  }

  // ── 5. Feature flags ──────────────────────────────────────────────────────
  header('5', 'Feature flags');
  const uiCfg = orgExists ? await plat.organizationUIConfig.findUnique({ where: { organizationId: orgId }, select: { features: true } }) : null;
  const features = { ...DEFAULT_ORG_FEATURES, ...((uiCfg?.features as Record<string, boolean>) || {}), ...FEATURE_OVERRIDES };
  if (APPLY) {
    await plat.organizationUIConfig.upsert({
      where: { organizationId: orgId },
      update: { features },
      create: { organizationId: orgId, features, currency: 'USD', language: 'en' },
    });
  }
  write(
    'features',
    `${uiCfg ? 'merge' : 'create'} ${Object.keys(features).length} flags; overrides ${Object.entries(FEATURE_OVERRIDES)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  );

  // ── 6. Document templates ─────────────────────────────────────────────────
  header('6', 'Document templates (no AccountingSetting, no chart of accounts)');
  const existingTypes = new Set<string>(orgExists ? (await plat.documentTemplate.findMany({ where: { organizationId: orgId }, select: { type: true } })).map((t: any) => t.type) : []);
  const toCreate = DEFAULT_DOCUMENT_TEMPLATES.filter((t) => !existingTypes.has(t.type));
  if (APPLY && toCreate.length) {
    await plat.documentTemplate.createMany({
      data: toCreate.map((t) => ({
        organizationId: orgId,
        type: t.type,
        templateVariant: t.templateVariant,
        name: t.name,
        designName: 'Default',
        description: `${t.name} document template`,
        isActive: true,
        isDefault: true,
        ...(t.config ? { config: t.config } : {}),
      })),
    });
  }
  if (toCreate.length) write('templates', `seed ${toCreate.length}: ${toCreate.map((t) => t.type).join(', ')}`);
  info(`${existingTypes.size} template type(s) already present`);
  info('AccountingSetting / ChartOfAccount: intentionally NOT created');

  // ── 7. Document numbering ─────────────────────────────────────────────────
  header('7', 'Document numbering');
  for (const f of NUMBER_FORMATS) {
    const exists = orgExists ? await orgRead(() => org.documentNumberFormat.findFirst({ where: { organizationId: orgId, documentType: f.documentType, label: 'Default' } }), null) : null;
    if (exists && exists.pattern === f.pattern) {
      info(`${f.documentType} exists (${f.pattern})`);
      continue;
    }
    if (APPLY) {
      if (exists) await org.documentNumberFormat.update({ where: { id: exists.id }, data: { pattern: f.pattern } });
      else
        await org.documentNumberFormat.create({
          data: { organizationId: orgId, documentType: f.documentType, label: 'Default', pattern: f.pattern, resetPolicy: 'yearly', nextSerial: 1, isActive: true, sortOrder: 0 },
        });
    }
    write('numbering', exists ? `${f.documentType} pattern ${exists.pattern} → ${f.pattern}` : `${f.documentType.padEnd(12)} ${f.pattern} (yearly reset)`);
  }

  // ── 8. Trade document types ───────────────────────────────────────────────
  header('8', 'Trade document types');
  const haveDocTypes = new Map<string, any>(orgExists ? (await tradeRead(() => org.tradeDocType.findMany({ where: { organizationId: orgId } }), [])).map((d: any) => [d.code, d]) : []);
  for (const [i, [code, label, category]] of DOC_TYPES.entries()) {
    const sortOrder = (i + 1) * 10;
    const cur = haveDocTypes.get(code);
    if (cur && cur.label === label && cur.sortOrder === sortOrder && cur.isActive && cur.category === category) continue;
    if (APPLY) {
      await org.tradeDocType.upsert({
        where: { organizationId_code: { organizationId: orgId, code } },
        update: { label, category, sortOrder, isActive: true },
        create: { organizationId: orgId, code, label, category, sortOrder },
      });
    }
    write('docType', `${cur ? 'update' : 'create'} ${code.padEnd(22)} ${label} [${category}] (${sortOrder})`);
  }
  info(`${DOC_TYPES.length} doc types defined, ${haveDocTypes.size} already present`);

  // ── 9. Step templates ─────────────────────────────────────────────────────
  header('9', 'Step templates');
  const docCodes = new Set(DOC_TYPES.map(([c]) => c));
  for (const s of STEP_TEMPLATES) {
    const bad = s.requiredDocTypes.filter((d) => !docCodes.has(d));
    if (bad.length) throw new Error(`step ${s.code} requires unknown doc types: ${bad.join(', ')}`);
  }
  const haveSteps = new Map<string, any>(
    orgExists ? (await tradeRead(() => org.tradeStepTemplate.findMany({ where: { organizationId: orgId } }), [])).map((t: any) => [`${t.scope}:${t.code}`, t]) : [],
  );
  for (const s of STEP_TEMPLATES) {
    const data = { title: s.title, displayNo: s.displayNo, sortOrder: s.sortOrder, requiredDocTypes: s.requiredDocTypes, isOngoing: !!s.isOngoing, isActive: true };
    const cur = haveSteps.get(`${s.scope}:${s.code}`);
    const same =
      cur &&
      cur.title === data.title &&
      cur.displayNo === data.displayNo &&
      cur.sortOrder === data.sortOrder &&
      cur.isOngoing === data.isOngoing &&
      cur.isActive &&
      JSON.stringify(cur.requiredDocTypes) === JSON.stringify(data.requiredDocTypes);
    if (same) continue;
    if (APPLY) {
      await org.tradeStepTemplate.upsert({
        where: { organizationId_scope_code: { organizationId: orgId, scope: s.scope, code: s.code } },
        update: data,
        create: { organizationId: orgId, scope: s.scope, code: s.code, ...data },
      });
    }
    write(
      'stepTemplate',
      `${cur ? 'update' : 'create'} ${s.scope.padEnd(8)} ${String(s.sortOrder).padStart(3)} #${s.displayNo.padEnd(3)} ${s.code.padEnd(20)} [${s.requiredDocTypes.join(', ')}]${s.isOngoing ? ' ongoing' : ''}`,
    );
  }

  // jsonb reorders object keys, so compare with sorted keys.
  const sortKeys = (v: any): any =>
    Array.isArray(v)
      ? v.map(sortKeys)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sortKeys(v[k])]),
          )
        : v;
  const sameJson = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  // ── 9b. Trade settings (B/L instruction defaults + in-app document texts) ─
  header('9b', 'Trade settings (B/L instruction defaults, document texts)');
  const curSettings = orgExists ? await tradeRead(() => org.tradeSetting.findUnique({ where: { organizationId: orgId } }), null) : null;
  // The script's keys win; keys it doesn't define (the seal, anything added in the app) are kept.
  const seal = SEAL_PATH ? sealDataUrl(SEAL_PATH) : undefined;
  const desiredDefaults: Record<string, unknown> = { ...((curSettings?.docDefaults as Record<string, unknown> | null) ?? {}), ...TRADE_SETTINGS.docDefaults, ...(seal ? { sealImage: seal } : {}) };
  const desired = { ...TRADE_SETTINGS, docDefaults: desiredDefaults };
  if (
    curSettings &&
    curSettings.defaultConsignee === desired.defaultConsignee &&
    curSettings.defaultNotifyParty === desired.defaultNotifyParty &&
    sameJson(curSettings.docDefaults, desired.docDefaults)
  ) {
    info(`B/L instruction defaults and document texts already set${desiredDefaults.sealImage ? ' (seal set)' : ' (no seal — pass --seal=<png> to print it on 請求書)'}`);
  } else {
    if (APPLY) {
      await org.tradeSetting.upsert({ where: { organizationId: orgId }, update: desired as any, create: { organizationId: orgId, ...(desired as any) } });
    }
    write(
      'tradeSetting',
      `${curSettings ? 'update' : 'create'} consignee "${TRADE_SETTINGS.defaultConsignee.split('\n')[0]}…", notify party "${TRADE_SETTINGS.defaultNotifyParty.split('\n')[0]}…", ${Object.keys(TRADE_SETTINGS.docDefaults).length} document texts${seal ? ', seal image' : ''}`,
    );
  }

  // ── 10. Master files ──────────────────────────────────────────────────────
  header('10', 'Master files (suppliers + customers)');
  const planned = new Set<string>();
  // Same approach as import-xero-contacts-biofuel.ts generateCustomerCode
  // (prefix + count+1), bumped past any code already taken so a gap left by a
  // deletion can't collide.
  const nextCode = async (model: 'customer' | 'supplier', field: string, prefix: string) => {
    let n = orgExists ? await orgRead(() => org[model].count({ where: { organizationId: orgId, [field]: { startsWith: prefix } } }), 0) : 0;
    for (;;) {
      n += 1;
      const code = `${prefix}${String(n).padStart(3, '0')}`;
      const taken = planned.has(code) || (orgExists && (await orgRead(() => org[model].findFirst({ where: { organizationId: orgId, [field]: code }, select: { id: true } }), null)));
      if (!taken) {
        planned.add(code);
        return code;
      }
    }
  };
  type Contact = { name: string; currency: string; note?: string; jpName?: string; jpAddress?: string; jpContact?: string };
  const ensureContact = async (model: 'customer' | 'supplier', c: Contact) => {
    const field = model === 'customer' ? 'customerCode' : 'supplierCode';
    const jp = Object.fromEntries((['jpName', 'jpAddress', 'jpContact'] as const).filter((k) => c[k]).map((k) => [k, c[k]]));
    const existing = orgExists ? await orgRead(() => org[model].findFirst({ where: { organizationId: orgId, name: { equals: c.name, mode: 'insensitive' } } }), null) : null;
    if (existing) {
      info(`${model} "${c.name}" exists (${existing[field] ?? 'no code'}, ${existing.currency})`);
      // Japanese name / address / contact: fill the blanks only, never overwrite what the org typed.
      const missing = Object.fromEntries(Object.entries(jp).filter(([k]) => !existing[k]));
      if (Object.keys(missing).length) {
        if (APPLY) await org[model].update({ where: { id: existing.id }, data: missing });
        write(model, `"${c.name}": set ${Object.keys(missing).join(', ')}`);
      }
      return;
    }
    const code = await nextCode(model, field, `${model === 'customer' ? 'C' : 'S'}${c.name.trim().charAt(0).toUpperCase()}`);
    if (APPLY) await org[model].create({ data: { organizationId: orgId, name: c.name, currency: c.currency, email: null, [field]: code, ...jp } });
    write(model, `create ${code} "${c.name}" (${c.currency})${c.note ? ` — ${c.note}` : ''}`);
  };
  for (const s of SUPPLIERS) await ensureContact('supplier', s);
  for (const c of CUSTOMERS) await ensureContact('customer', c);

  // ── 11. Access ────────────────────────────────────────────────────────────
  header('11', 'Access');
  if (!LINK_OSIRIS_ADMINS) {
    info('Osiris superadmins NOT linked (pass --link-osiris-admins to link them)');
  } else {
    const osirisSchema = TARGET === 'public' ? 'public' : 'org_osiris';
    const platformOrgSchema = TARGET === 'public' ? 'public' : 'org_platformorg';
    const uoSchema = TARGET === 'public' ? 'public' : 'platform';
    const admins: Array<{ userId: string }> = await plat.$queryRawUnsafe(
      `SELECT DISTINCT ur."userId" FROM "${osirisSchema}"."UserRole" ur JOIN "${osirisSchema}"."Role" r ON r.id = ur."roleId"
       WHERE ur."organizationId" = $1 AND ur."isActive" AND r.name = 'superadmin'`,
      OSIRIS_ORG_ID,
    );
    const osirisAdmins = new Set(
      (
        (await plat.$queryRawUnsafe(
          `SELECT DISTINCT ur."userId" FROM "${platformOrgSchema}"."UserRole" ur JOIN "${platformOrgSchema}"."Role" r ON r.id = ur."roleId"
           WHERE ur."isActive" AND r.name = 'osirisadmin'`,
        )) as Array<{ userId: string }>
      ).map((r) => r.userId),
    );
    info(`${admins.length} active Osiris superadmin(s):`);
    for (const { userId } of admins) {
      const memberships: Array<{ n: number }> = await plat.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${uoSchema}"."UserOrganization" WHERE "userId" = $1 AND "isActive"`, userId);
      const isOsirisAdmin = osirisAdmins.has(userId);
      if (!isOsirisAdmin) {
        info(`⚠ ${userId} is NOT osirisadmin — ClerkAuthGuard picks their first active UserOrganization (unordered; they have ${memberships[0].n}), so ADH could become their default org`);
      }
      if (APPLY && roleId) {
        await plat.userOrganization.upsert({
          where: { userId_organizationId: { userId, organizationId: orgId } },
          update: { isActive: true },
          create: { userId, organizationId: orgId, isActive: true },
        });
        await org.userRole.upsert({
          where: { userId_roleId_organizationId: { userId, roleId, organizationId: orgId } },
          update: { isActive: true },
          create: { userId, roleId, organizationId: orgId, isActive: true },
        });
      }
      write('access', `${userId}${isOsirisAdmin ? ' (osirisadmin)' : ''} → UserOrganization + "${ROLE_NAME}"`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`${APPLY ? '✅ Applied' : '📝 Dry run'} — ${writes.length} write(s)${APPLY ? '' : ' planned'} — org id ${orgId}`);
  const byStep = writes.reduce<Record<string, number>>((acc, w) => {
    const k = w.split(':')[0];
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  for (const [k, n] of Object.entries(byStep)) console.log(`   ${k.padEnd(14)} ${n}`);
  if (blockers.length) {
    console.log('\n⛔ Blockers (must be cleared before --apply):');
    for (const b of blockers) console.log(`   - ${b}`);
  }
  console.log('\nNext steps:');
  console.log(`   1. Add users (Admin Panel → Users, i.e. POST /admin/users, while viewing as "${ORG_NAME}") with role "${ROLE_NAME}":`);
  for (const u of USERS_TO_ADD) console.log(`        - ${u}`);
  console.log('      They must belong to ADH only — a non-admin in two orgs lands in an arbitrary one.');
  console.log('   2. Do not open Org Settings → Accounting Setup / seed a chart of accounts for this org (would switch GL posting on).');
  if (TARGET === 'tenancy') console.log('   3. Restart the dev API so the tenancy router loads the org-adhjapan client.');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => process.exit(process.exitCode ?? 0));

/** --seal=<file>: a PNG / JPEG (≤ 1 MB) as a data: URL for docDefaults.sealImage. */
function sealDataUrl(file: string): string {
  const buf = fs.readFileSync(path.resolve(file));
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpeg) throw new Error(`--seal: ${file} is not a PNG or JPEG`);
  if (buf.length > 1024 * 1024) throw new Error('--seal: the image must be 1 MB or smaller');
  return `data:image/${isPng ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
}
