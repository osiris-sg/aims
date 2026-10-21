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
 *   ... --customers=<path.json>   customer details kept out of the repo (pattern *.customers.json is
 *                                 gitignored): { "customers": [{ "name", "jpName", "jpAddress", "jpContact", "emailDomains" }],
 *                                 "deliveryProfiles": [{ "id", "customerName", "siteName", "address", "notes" }] }.
 *                                 jp* fill blanks on the customer matched by name; delivery profiles replace
 *                                 those with the same id. Without it, customer details are left as they are.
 *   ... --resolution-report=<file.csv>  write the org × template-type resolution, before vs after (step 0)
 *
 * Step 0 (before any write) compares, for every org × document type, the template the app
 * resolves before vs after this run's new templates. The run stops if a new template is
 * isDefault: true or any other org's resolution would change (templates are a cross-org pool).
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
import { DEFAULT_KEEP_DOMAINS } from '../src/ingestion-email/email-triage.rules';
import { JudgeRow, judgeStoredRows } from '../src/ingestion-email/email-filter.judge';
import { ownDomainsOf } from '../src/ingestion-email/email-triage.service';
import { ADH_FILTER_ALLOW_DOMAINS as FILTER_ALLOW_DOMAINS, ADH_FILTER_NOTES as FILTER_NOTES } from '../src/ingestion-email/email-filter.rules';
import { checkTemplatePlan, type TemplateRow } from './lib/template-resolution';
import { backfillOrders } from '../src/shipments/trade-orders-backfill';
import { copyPaymentsToSteps, foldSupplierOrders, moveInvoice2ToOrder } from '../src/shipments/trade-one-process';
import { bankEntity, entityFor } from '../src/shipments/trade-entity';
import { DEFAULT_RATES } from '../src/shipments/trade-estimator';
import { defaultSingleRemarks, supplierKeyPatterns, type CustomerProfile, type SupplierProfile } from '../src/shipments/trade-profile';
import { NOT_TRACKED_NOTE, receiptNotTracked } from '../src/shipments/trade-alerts';
import { IMPORT_NOTE } from '../src/shipments/trade-open-orders';
import { stepPaymentOf } from '../src/shipments/trade-payments';

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const CONFIRM_PROD = argv.includes('--confirm-prod');
const LINK_OSIRIS_ADMINS = argv.includes('--link-osiris-admins');
const TARGET = argv.find((a) => a.startsWith('--target='))?.split('=')[1] as 'public' | 'tenancy' | undefined;
const SEAL_PATH = argv.find((a) => a.startsWith('--seal='))?.slice('--seal='.length);
const CUSTOMERS_PATH = argv.find((a) => a.startsWith('--customers='))?.slice('--customers='.length);
const CUSTOMER_FILE = CUSTOMERS_PATH ? readCustomerFile(CUSTOMERS_PATH) : undefined;
const RESOLUTION_REPORT = argv.find((a) => a.startsWith('--resolution-report='))?.slice('--resolution-report='.length);

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
  { resource: 'shipments', action: 'money', description: 'Can see trade money: cash in / out, margin, profit, open credits (management view)' },
];
// "ADH Manager" (2026-10): everything ADH Staff has, plus money (shipments:money — the manager dashboard).
const MANAGER_ROLE_NAME = 'ADH Manager';
const MANAGER_ROLE_DESCRIPTION = 'ADH Japan management — everything ADH Staff has, plus cash, margin, profit and credits';
const MONEY_PERMISSIONS = ['shipments:money'];

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
// hideInMenu: the module stays ON (routes, data, permissions) but is left out of the menus.
const ENABLED_MODULES: Array<{ code: string; displayName?: string; route?: string; icon?: string; sortOrder?: number; hideInMenu?: boolean; subMenus?: Array<{ key: string; label: string }> }> = [
  {
    code: 'SHIPMENTS',
    // Round P (2026-10-21): the top-nav item reads "Sales" (the module, its routes /portal/shipments/* and its
    // permissions are unchanged — only the label). Under it: Dashboard · Orders · Shipments · Inbox.
    displayName: 'Sales',
    sortOrder: -3, // first — before the global Sales pin (0.5)
    subMenus: [
      // Dashboard (round P: email-first — emails to confirm, filed automatically, tasks, arriving this week; the
      // old Home with cash / margin sits behind enableShipmentsHome, off), Orders (one order process), Shipments
      // (every B/L) and the triaged email Inbox. Round H (2026-10): Declaration, Payments and Stock left the menu
      // (their pages sit behind enableTradeLegacyPages, off).
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'list', label: 'Orders' },
      { key: 'shipments', label: 'Shipments' },
      { key: 'inbox', label: 'Inbox' },
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
    // Trade invoices are stored as Sales invoices, so the module must stay on;
    // ADH works from Invoices / Shipments, so it is not in the menu.
    hideInMenu: true,
    subMenus: [
      { key: 'quotations', label: 'Quotation' },
      { key: 'credit-notes', label: 'Credit Note' },
      { key: 'debit-notes', label: 'Debit Note' },
    ],
  },
  { code: 'USER_MANAGEMENT' },
  { code: 'AUDIT' },
];

/** QMJP (Quarterly Main Japanese Port premium, US$/MT) per quarter, as ADH's invoices quote it. */
const QMJP_BY_QUARTER: Record<string, number> = { '2026-2Q': 351.5, '2026-3Q': 395 };

// Email intake: every email to docs+{orgId}@<EMAIL_INGEST_DOMAIN> is stored
// (.eml + attachments in S3, listed in Org Settings → Shipping & documents);
// nothing is classified yet. All senders: forwards keep the original From.
// Since triage (2026-10): dev runs AUTO, prod starts in TRIAGE (suggestions only) until switched in the app.
// The script only moves a STORE row on; a mode chosen in the app is left alone.
const EMAIL_INTAKE = { enabled: true, routingMode: 'STORE', watchedSenders: [] as string[] };
// 2026-10 (after the hand review of the 18 prod suggestions): prod moves to PARTIAL_AUTO — an email is applied by
// itself only when the guards hold (email-match.rules.ts); dev stays AUTO.
const intakeModeFor = (isProd: boolean) => (isProd ? 'PARTIAL_AUTO' : 'AUTO');
// Sender filter (2026-10): SHADOW first (decide + log, keep everything) — ENFORCE only after the backtest's false
// drops are fixed. Domains seen sending / receiving in ADH's stored intake mail are "seen"; the carriers' sending
// domains not seen yet are marked "unverified"; parties without a known domain are noted "add when known".
/** Modes the script moves on to the wanted one; anything else chosen in the app is left alone. */
const intakeMovesFrom = (isProd: boolean) => (isProd ? ['STORE', 'TRIAGE'] : ['STORE']);

const FEATURE_OVERRIDES: Record<string, boolean> = {
  enableActionLog: true,
  enableConfirmQuotation: false, // keeps quotation confirm from auto-creating Orders
  enableTradeLegacyPages: false, // round H: Declaration / Payments / Stock / Supplier orders pages hidden
  enableTradePipelineGrid: false, // round K: Home's pipeline grid hidden (Orders list progress bars instead)
  enableShipmentsHome: false, // round O/P: the OLD Home (cash / margin) stays off; the Dashboard route shows the email-first dashboard
  enableEmailReasoner: true, // round R: the thread reasoner — live on ADH since the owner's go (2026-10-21)
  enableWhatsAppAgent: true, // round S: WhatsApp shipments agent + pushes — live on ADH since the owner's go (2026-10-22)
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
  ['INVOICE_SINGLE', 'Invoice (single)', 'INVOICES'],
  ['VENDOR_INVOICE', 'Vendor invoice', 'PAYMENTS'],
  ['PAYMENT_PROOF', 'Payment proof', 'PAYMENTS'],
  ['CUSTOMER_PO', 'Customer purchase order (発注書)', 'CUSTOMER'],
  ['BUNDLE_LIST', 'Bundle-number list (NO.取りリスト)', 'CUSTOMS_LOGISTICS'],
  // Their own step 3b rows (prod click-through): step 4 makes the customer PL / COA from them.
  ['CONTAINER_PL', 'Container packing list', 'SUPPLIER'],
  ['PL_XLS', 'Packing list spreadsheet (PL.XLS)', 'SUPPLIER'],
  ['COA_XLS', 'COA summary (COA.XLS)', 'SUPPLIER'],
  // Mitsui Soko's 納品明細 — what was delivered (step 14 evidence; the intake files it there).
  ['DELIVERY_NOTE', 'Delivery note (納品明細)', 'CUSTOMS_LOGISTICS'],
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
        entity: 'ADH_SG',
        block:
          'DBS Bank Ltd\nBank address\t12 Marina Boulevard Level 3 Mbfc Tower 3, Singapore 018982\nBank/Branch Code\t7171/288 (USD)\nBank SWIFT/BIC\tDBSSSGSG\nBeneficiary name\tAsia Deal Hub Pte. Ltd.\nBeneficiary Bank Account No:  2889046798',
      },
      {
        id: 'cfsb',
        label: 'Community Federal Savings Bank',
        entity: 'ADH_SG',
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
    // 請求書 (single invoice, Kato / Hoei): the issuer block exactly as on ADH's Kato invoice (with 担当).
    singleFromBlock: 'アジアディールハブ合同会社\n〒107-0052\n東京都港区赤坂二丁目14-5\nDaiwa赤坂ビル7階\n担当：竹腰 俊朗',
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
    // deliveryProfiles (customer delivery sites) come from --customers.
  } as Record<string, unknown>,
};

type StepSpec = {
  scope: 'CONTRACT' | 'SHIPMENT' | 'ORDER' | 'SUPPLIER_ORDER';
  sortOrder: number;
  code: string;
  displayNo: string;
  title: string;
  requiredDocTypes: string[];
  /** Offered under the step's collapsed "Optional" heading (never required). Default ['OTHER']. */
  optionalDocTypes?: string[];
  /** Record fields the step needs before it auto-completes (shipment step 2: the B/L details). */
  requiredFields?: string[];
  isOngoing?: boolean;
};
// One order process (2026-10, round H — owner feedback; replaces the supplier / customer split of round E):
// order steps 0 Check contract, 1 PI payment, 2 Invoice #1, 11 Invoice #2 / single invoice, 13 reconciliation;
// shipment steps 3a–10, 12, 14 (6 = the CI payment). Templates no longer listed (SUPPLIER_ORDER, shipment 11)
// are deactivated (not deleted) below.
const STEP_TEMPLATES: StepSpec[] = [
  // 0: link / upload the contract (auto-completes once the order has its contract).
  { scope: 'ORDER', sortOrder: 5, code: 'CHECK_CONTRACT', displayNo: '0', title: 'Check contract', requiredDocTypes: [], requiredFields: ['contractId'], optionalDocTypes: ['CONTRACT', 'OTHER'] },
  { scope: 'ORDER', sortOrder: 10, code: 'PI_PAYMENT', displayNo: '1', title: 'Set up PI payment', requiredDocTypes: ['PI', 'DEPOSIT_PROOF'], optionalDocTypes: ['CONTRACT', 'OTHER'] },
  { scope: 'ORDER', sortOrder: 20, code: 'INVOICE_1', displayNo: '2', title: 'Issue and send Invoice #1', requiredDocTypes: ['INVOICE_1'], optionalDocTypes: ['CUSTOMER_PO', 'PAYMENT_PROOF', 'OTHER'] },
  // 11: Invoice #2 (TWO_STAGE) — or the single invoice for a SINGLE-billing customer — on the order; done once every
  // live shipment has its invoice (one invoice may cover several shipments).
  { scope: 'ORDER', sortOrder: 110, code: 'INVOICE_2', displayNo: '11', title: 'Issue Invoice #2', requiredDocTypes: ['INVOICE_2'], optionalDocTypes: ['INVOICE_SINGLE', 'PAYMENT_PROOF', 'OTHER'] },
  { scope: 'ORDER', sortOrder: 130, code: 'XERO_HANDOFF', displayNo: '13', title: 'Prepare data for Xero reconciliation', requiredDocTypes: [], optionalDocTypes: ['CUSTOMER_PO', 'OTHER'] },
  {
    scope: 'SHIPMENT',
    sortOrder: 10,
    code: 'BL_DRAFT_APPROVAL',
    // ADH's own list numbers shipment work 3–10 (order step 2 is Invoice #1): the B/L draft is 3a, the shipping docs 3b.
    displayNo: '3a',
    title: 'Approve B/L draft (Vedanta)',
    requiredDocTypes: ['BL_DRAFT'],
    // The B/L details are entered here (inline form / "Fill from B/L draft"); the product comes from the order.
    requiredFields: ['blNumber'],
    optionalDocTypes: ['ARRIVAL_NOTICE', 'OTHER'],
  },
  { scope: 'SHIPMENT', sortOrder: 20, code: 'SHIPPING_DOCS', displayNo: '3b', title: 'Receive shipping documents', requiredDocTypes: ['BL', 'CI', 'PL', 'COA', 'COO', 'INSURANCE'], optionalDocTypes: ['CONTAINER_PL', 'PL_XLS', 'COA_XLS', 'PL', 'COA', 'OTHER'] },
  { scope: 'SHIPMENT', sortOrder: 30, code: 'CUSTOMER_DOCS', displayNo: '4', title: 'Create customer documents', requiredDocTypes: ['CUSTOMER_COA', 'CUSTOMER_PL'], optionalDocTypes: ['OTHER'] },
  { scope: 'SHIPMENT', sortOrder: 40, code: 'SEND_DOCS_SCHEDULE', displayNo: '5', title: 'Send documents & ask schedule', requiredDocTypes: [], optionalDocTypes: ['DELIVERY_SCHEDULE', 'OTHER'] },
  { scope: 'SHIPMENT', sortOrder: 50, code: 'CI_PAYMENT', displayNo: '6', title: 'Set up CI payment', requiredDocTypes: ['CI_PAYMENT_PROOF'], optionalDocTypes: ['OTHER'] },
  { scope: 'SHIPMENT', sortOrder: 60, code: 'CUSTOMS_TAX_ESTIMATE', displayNo: '7', title: 'Customs documents & tax estimate', requiredDocTypes: ['SGJP_IV_PL', 'TAX_ESTIMATE'], optionalDocTypes: ['OTHER'] },
  { scope: 'SHIPMENT', sortOrder: 70, code: 'TAX_FUNDS', displayNo: '8', title: 'Prepare import-tax funds', requiredDocTypes: [], optionalDocTypes: ['OTHER'] },
  {
    scope: 'SHIPMENT',
    sortOrder: 80,
    code: 'AN_INSTRUCTIONS',
    displayNo: '9',
    title: 'Send arrival notice & shipping instructions',
    requiredDocTypes: ['ARRIVAL_NOTICE', 'SHIPPING_INSTRUCTIONS', 'TELEX_RELEASE', 'DELIVERY_SCHEDULE'],
    // Mitsui Soko's NO.取りリスト (bundle numbers) is filed here by the email intake.
    optionalDocTypes: ['DELIVERY_SCHEDULE', 'BUNDLE_LIST', 'OTHER'],
  },
  { scope: 'SHIPMENT', sortOrder: 90, code: 'IMPORT_PERMIT', displayNo: '10', title: 'Store & send import permit', requiredDocTypes: ['IMPORT_PERMIT'], optionalDocTypes: ['OTHER'] },
  { scope: 'SHIPMENT', sortOrder: 110, code: 'LOGISTICS_PAYMENT', displayNo: '12', title: 'Pay transport & storage costs', requiredDocTypes: ['VENDOR_INVOICE', 'PAYMENT_PROOF'], optionalDocTypes: ['VENDOR_INVOICE', 'PAYMENT_PROOF', 'OTHER'] },
  { scope: 'SHIPMENT', sortOrder: 130, code: 'DELIVERY_CHANGES', displayNo: '14', title: 'Coordinate delivery changes', requiredDocTypes: [], isOngoing: true, optionalDocTypes: ['DELIVERY_SCHEDULE', 'DELIVERY_NOTE', 'OTHER'] },
];

// Supplier/Customer have no UEN column; gstRegNo is a GST number, so the UEN is
// only reported.
/** Round N: orders made during live click-throughs on prod — flagged isTest (never deleted). */
const TEST_ORDERS = { year: 2026, orderNos: [27, 28, 29] };

const SUPPLIERS = [
  { name: 'Vedanta Aluminium Metal Limited', currency: 'USD' },
  { name: 'Mitsui Soko Co., Ltd.', currency: 'JPY', note: 'warehouse' },
  { name: 'Asia Deal Hub Pte. Ltd.', currency: 'USD', note: 'intra-company, UEN 201931733Z (no UEN field — not stored)' },
];
// Japanese name / address / contact (printed on the Japanese documents) come from --customers.
const CUSTOMERS = [
  { name: 'SUS Co., Ltd.', currency: 'USD' },
  { name: 'Kato Light Metal Industry Co., Ltd.', currency: 'USD' },
  { name: 'Houei', currency: 'USD' },
];

// Customer profiles (TradeSetting.customerProfiles, Org Settings → Customers), keyed here by the customer's
// name. Addresses / delivery sites come from --customers (adh.customers.json, never committed).
// Values edited in the app win: only customers without a profile, and blank keys, are filled.
// Supplier profiles (2026-10): Vedanta issues a PI and a deposit (step 1); Inalum / the Thai P1020 supplier
// don't (hasPI false — set in Org Settings → Suppliers once they are added) and send their own document set.
const SUPPLIER_PROFILE_SEED: Record<string, Omit<SupplierProfile, 'supplierId'>> = {
  'Vedanta Aluminium Metal Limited': { key: 'VEDANTA', label: 'Vedanta', hasPI: true, shippingDocs: null },
};

// Contract master (2026-10). From the PIs / contract scans in ADH_Docs: Vedanta's premium is "midpoint of
// the Main Japanese Port premium for the quarter (Platts) + N USD PMT" — the schedule holds N on the supplier
// side and ADH's billet premium on the client side (margin = client − supplier; SUS 6063 230 − 205 = 25).
// Unknown fields stay blank and are flagged "check" for ADH (Sayaka is updating the contract info).
const VEDANTA = 'Vedanta Aluminium Metal Limited';
const QP_SHIPMENT_MONTH = 'Average LME Cash Settlement Price for the month of scheduled shipment';
const MJP_RULE = 'Midpoint of the Official Main Japanese Port premium for the quarter (Platts) + the contract premium';
const VEDANTA_BALANCE =
  'Provisional price within 3 working days against the provisional invoice + original B/L; final price within 2 business days against the final invoice and documents; the difference settled within 2 working days from the last day of QP.';
type ContractSeed = {
  contractNo: string;
  customer: string;
  product: string;
  grade: string;
  sizeSpec: string | null;
  lineQtyMt: number | null;
  tolerancePct: number;
  incoterm: string;
  destinationPort: string;
  destinationCountry: string;
  periodStart: string | null;
  periodEnd: string | null;
  annualQtyMt: number | null;
  depositDueDays: number;
  qpBasis: string | null;
  balanceTerms: string | null;
  premiumSchedule: Array<{ from: string; to: string | null; grade?: string | null; supplierPremium: number | null; clientPremium: number | null; upcharge: number | null }>;
  checkFields: string[];
};
const CONTRACT_SEED: ContractSeed[] = [
  {
    contractNo: '454003422',
    customer: 'SUS Co., Ltd.',
    product: 'Aluminium Billet',
    grade: '6063',
    sizeSpec: '203 MM (8 inch)',
    lineQtyMt: 300,
    tolerancePct: 5,
    incoterm: 'CIF',
    destinationPort: 'Yokohama',
    destinationCountry: 'Japan',
    periodStart: null,
    periodEnd: null,
    annualQtyMt: null,
    depositDueDays: 5,
    qpBasis: null,
    balanceTerms: null,
    // PI 9331004128: premium 556.50 = 2QMJP 351.5 + 205; invoices bill 230 (#11).
    premiumSchedule: [{ from: '2026-06', to: null, supplierPremium: 205, clientPremium: 230, upcharge: null }],
    checkFields: ['periodStart', 'periodEnd', 'annualQtyMt', 'qpBasis', 'balanceTerms'],
  },
  {
    contractNo: '454003255',
    customer: 'SUS Co., Ltd.',
    product: 'Aluminium Billet',
    grade: '6005',
    sizeSpec: '203 MM (8 inch)',
    lineQtyMt: 120,
    tolerancePct: 5,
    incoterm: 'CIF',
    destinationPort: 'Yokohama',
    destinationCountry: 'Japan',
    periodStart: null,
    periodEnd: null,
    annualQtyMt: null,
    depositDueDays: 5,
    qpBasis: null,
    balanceTerms: null,
    // PI 9331004127: premium 513.50 = 351.5 + 162; SUS 6005 invoice: 190 billet + 10 upcharge (margin 38).
    premiumSchedule: [{ from: '2026-06', to: null, supplierPremium: 162, clientPremium: 190, upcharge: 10 }],
    checkFields: ['periodStart', 'periodEnd', 'annualQtyMt', 'qpBasis', 'balanceTerms'],
  },
  {
    contractNo: '454003598',
    customer: 'Kato Light Metal Industry Co., Ltd.',
    product: 'Aluminium Billet',
    grade: '6005',
    sizeSpec: '203 MM (8 inch)',
    lineQtyMt: 50,
    tolerancePct: 5,
    incoterm: 'CIF',
    destinationPort: 'Nagoya',
    destinationCountry: 'Japan',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    annualQtyMt: 50,
    depositDueDays: 3,
    qpBasis: QP_SHIPMENT_MONTH,
    balanceTerms: VEDANTA_BALANCE,
    // Contract: MJP + 260; PI 9331004129 611.50 = 351.5 + 260. Kato orders bill 285 / 287 / 260 — per order.
    // The schedule row is 6005's: Kato's 6063 orders (a second line, 10h) price on their own order premiums.
    premiumSchedule: [{ from: '2026-07', to: null, grade: '6005', supplierPremium: 260, clientPremium: 285, upcharge: null }],
    checkFields: ['premiumSchedule'],
  },
  {
    contractNo: '454003652',
    customer: 'Houei',
    product: 'Aluminium Ingot',
    grade: 'P1020',
    sizeSpec: null,
    lineQtyMt: 150,
    tolerancePct: 2,
    incoterm: 'CIF',
    destinationPort: 'Laem Chabang',
    destinationCountry: 'Thailand',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    annualQtyMt: 150,
    depositDueDays: 3,
    qpBasis: QP_SHIPMENT_MONTH,
    balanceTerms: VEDANTA_BALANCE,
    // Contract: MJP + 5; PI 9331004202 (scan, read by the AI pipeline): LME 3,260.10 + 400.00 = 3,660.10, 150 MT.
    premiumSchedule: [{ from: '2026-08', to: null, supplierPremium: 5, clientPremium: null, upcharge: null }],
    checkFields: ['premiumSchedule', 'sizeSpec'],
  },
];
/** LME cash monthly averages (US$/MT) from ADH's invoices — the price check's basis. */
const LME_SEED: Record<string, number> = { '2026-06': 3458.64, '2026-07': 3155.98 };

const PROFILE_SEED: Record<string, Omit<CustomerProfile, 'customerId'>> = {
  'SUS Co., Ltd.': {
    key: 'SUS',
    label: 'SUS',
    billingMode: 'TWO_STAGE',
    sendImportPermit: true,
    port: 'Yokohama',
    truckCapacityT: 20,
    customsRatePerMt: 2800,
    emailDomains: [],
    docVariants: { CUSTOMER_PL: 'CUSTOMER_PL_SUS', CUSTOMER_COA: 'CUSTOMER_COA_SUS', INVOICE: 'INVOICE_2' },
    defaultBankId: 'dbs',
    // 宛先 on SUS's PL / COA (the address / contact come from --customers).
    docAddressee: 'SUS株式会社 福島製造グループ',
  },
  'Kato Light Metal Industry Co., Ltd.': {
    key: 'KATO',
    label: '加藤軽金属工業',
    billingMode: 'SINGLE',
    sendImportPermit: false,
    port: 'Nagoya',
    truckCapacityT: 10,
    customsRatePerMt: 2300,
    emailDomains: [], // from --customers (emailDomains) — contacts stay out of the repo
    docVariants: { CUSTOMER_PL: 'CUSTOMER_PL_KATO', CUSTOMER_COA: 'CUSTOMER_COA_KATO', INVOICE: 'INVOICE_SINGLE' },
    invoiceRemarks: defaultSingleRemarks('名古屋'),
    // Kato's sample invoice prints CFSB (an ADH SG account on an ADH JP invoice).
    defaultBankId: 'cfsb',
  },
  Houei: {
    key: 'HOEI',
    label: 'Hoei',
    billingMode: 'SINGLE',
    sendImportPermit: false,
    port: 'Nagoya',
    truckCapacityT: 10,
    customsRatePerMt: 2300,
    emailDomains: [],
    docVariants: { CUSTOMER_PL: 'CUSTOMER_PL_HOEI', CUSTOMER_COA: 'CUSTOMER_COA_HOEI', INVOICE: 'INVOICE_SINGLE' },
    invoiceRemarks: defaultSingleRemarks('名古屋'),
    // DBS for now — not confirmed by ADH ("check" in Settings → Customers).
    defaultBankId: 'dbs',
    defaultBankCheck: true,
  },
};

// The org's templates are its own active ones; isDefault stays false so they
// never become the cross-org fallback (checked by step 0 before any write).
const TEMPLATE_IS_DEFAULT = false;

const USERS_TO_ADD = ['sayaka.matsuki', 'toshiro.takekoshi', 'natsumi', 'finance'].map((u) => `${u}@asiadealhub.com`);

const TRADE_TABLES = ['TradeDocType', 'Contract', 'TradeOrder', 'SupplierOrder', 'Shipment', 'TradeStepTemplate', 'TradeStep', 'TradeFile', 'TradeFileLink'];

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

  // ── 0. Template resolution guard (before any write) ───────────────────────
  header('0', 'Template resolution guard (every org × type, before vs after)');
  const existingOrg = await plat.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  const guardOrgId: string = existingOrg?.id ?? PLACEHOLDER_ORG_ID;
  const templateTypes = DEFAULT_DOCUMENT_TEMPLATES.map((t) => t.type);
  const allTemplates: TemplateRow[] = await plat.documentTemplate.findMany({
    where: { type: { in: templateTypes } },
    select: { id: true, organizationId: true, type: true, isActive: true, isDefault: true, createdAt: true },
  });
  const ownTypes = new Set(allTemplates.filter((t) => t.organizationId === guardOrgId).map((t) => t.type));
  const plannedAt = new Date();
  // The rows step 6 creates — isDefault: false, so they never become another org's fallback.
  const plannedTemplates: TemplateRow[] = DEFAULT_DOCUMENT_TEMPLATES.filter((t) => !ownTypes.has(t.type)).map((t, i) => ({
    id: `<planned-${t.type}>`,
    organizationId: guardOrgId,
    type: t.type,
    isActive: true,
    isDefault: TEMPLATE_IS_DEFAULT,
    createdAt: new Date(plannedAt.getTime() + i),
  }));
  const orgList: Array<{ id: string; name: string }> = await plat.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const templateCheck = checkTemplatePlan({
    ownOrgId: guardOrgId,
    orgIds: orgList.map((o) => o.id),
    types: templateTypes,
    templates: allTemplates,
    selections: await plat.organizationActiveTemplate.findMany({ where: { type: { in: templateTypes } }, select: { organizationId: true, type: true, templateId: true, isPrimary: true } }),
    planned: plannedTemplates,
  });
  const orgName = (id: string) => (id === guardOrgId ? ORG_NAME : (orgList.find((o) => o.id === id)?.name ?? id));
  const ownerOf = (tid: string | null) => (tid ? (tid.startsWith('<planned-') ? `${ORG_NAME} (new)` : orgName(allTemplates.find((t) => t.id === tid)?.organizationId ?? '?')) : 'none');
  for (const id of [...new Set(templateCheck.cells.map((c) => c.organizationId))]) {
    const cells = templateCheck.cells.filter((c) => c.organizationId === id);
    const changed = cells.filter((c) => c.before !== c.after);
    info(`${orgName(id).padEnd(34)} ${changed.length ? `${changed.length}/${cells.length} change → ${[...new Set(changed.map((c) => ownerOf(c.after)))].join(', ')}` : `${cells.length}/${cells.length} identical`}`);
  }
  if (RESOLUTION_REPORT) {
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = ['org,type,before_template,before_owner,after_template,after_owner,identical'];
    for (const c of templateCheck.cells) lines.push([orgName(c.organizationId), c.type, c.before ?? '', ownerOf(c.before), c.after ?? '', ownerOf(c.after), String(c.before === c.after)].map(q).join(','));
    fs.writeFileSync(path.resolve(RESOLUTION_REPORT), lines.join('\n') + '\n');
    info(`resolution report → ${RESOLUTION_REPORT}`);
  }
  if (templateCheck.errors.length) {
    console.error('\n❌ Template guard failed — nothing written:');
    for (const e of templateCheck.errors) console.error(`   - ${e}`);
    process.exit(1);
  }
  info(`✓ only "${ORG_NAME}" changes; ${plannedTemplates.length} new template(s), all isDefault: false`);

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
  // Staff: no money; the Manager role (3b) adds it.
  const granted = [...permByName.values()].filter((p) => (ROLE_RESOURCES.includes(p.resource) || ROLE_EXTRA_PERMISSIONS.includes(p.name)) && !MONEY_PERMISSIONS.includes(p.name));
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

  // ── 3b. Role "ADH Manager" ────────────────────────────────────────────────
  header('3b', `Role "${MANAGER_ROLE_NAME}"`);
  const managerGranted = [...granted, ...[...permByName.values()].filter((p) => MONEY_PERMISSIONS.includes(p.name))];
  const existingManager = orgExists ? await orgRead(() => org.role.findFirst({ where: { organizationId: orgId, name: MANAGER_ROLE_NAME } }), null) : null;
  if (APPLY) {
    const ids = (await org.permission.findMany({ where: { name: { in: managerGranted.map((p) => p.name) } }, select: { id: true } })).map((p: any) => ({ id: p.id }));
    if (existingManager) {
      await org.role.update({ where: { id: existingManager.id }, data: { description: MANAGER_ROLE_DESCRIPTION, allowedModules: ROLE_MODULES, permissions: { set: ids } } });
    } else {
      await org.role.create({ data: { organizationId: orgId, name: MANAGER_ROLE_NAME, description: MANAGER_ROLE_DESCRIPTION, allowedModules: ROLE_MODULES, permissions: { connect: ids } } });
    }
  }
  write('role', `${existingManager ? 'sync' : 'create'} "${MANAGER_ROLE_NAME}" — modules ${ROLE_MODULES.join('/')}, ${managerGranted.length} permissions (staff + money)`);

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
      ...(wanted?.hideInMenu ? { hideInMenu: true } : {}),
    };
    const row = { enabled, displayName: wanted?.displayName ?? cat.displayName, icon: wanted?.icon ?? cat.icon, sortOrder: wanted?.sortOrder ?? cat.sortOrder, config };
    if (APPLY) {
      await plat.organizationModule.upsert({
        where: { organizationId_moduleCode: { organizationId: orgId, moduleCode: cat.moduleCode } },
        update: row,
        create: { organizationId: orgId, moduleCode: cat.moduleCode, ...row },
      });
    }
    write(
      'module',
      `${cat.moduleCode.padEnd(20)} ${enabled ? 'ON ' : 'off'}${enabled ? `  order ${row.sortOrder}` : ''}${wanted?.displayName ? `  "${wanted.displayName}"` : ''}${wanted?.route ? `  ${wanted.route}` : ''}${wanted?.subMenus ? `  (${wanted.subMenus.map((s) => s.key).join(', ')})` : ''}${wanted?.hideInMenu ? '  [hidden from menu]' : ''}`,
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
        // Never true: an isDefault template is every template-less org's fallback (step 0).
        isDefault: TEMPLATE_IS_DEFAULT,
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
    const bad = [...s.requiredDocTypes, ...(s.optionalDocTypes ?? [])].filter((d) => !docCodes.has(d));
    if (bad.length) throw new Error(`step ${s.code} requires unknown doc types: ${bad.join(', ')}`);
  }
  const haveSteps = new Map<string, any>(
    orgExists ? (await tradeRead(() => org.tradeStepTemplate.findMany({ where: { organizationId: orgId } }), [])).map((t: any) => [`${t.scope}:${t.code}`, t]) : [],
  );
  for (const s of STEP_TEMPLATES) {
    const data = {
      title: s.title,
      displayNo: s.displayNo,
      sortOrder: s.sortOrder,
      requiredDocTypes: s.requiredDocTypes,
      optionalDocTypes: s.optionalDocTypes ?? ['OTHER'],
      requiredFields: s.requiredFields ?? [],
      isOngoing: !!s.isOngoing,
      isActive: true,
    };
    const cur = haveSteps.get(`${s.scope}:${s.code}`);
    const same =
      cur &&
      cur.title === data.title &&
      cur.displayNo === data.displayNo &&
      cur.sortOrder === data.sortOrder &&
      cur.isOngoing === data.isOngoing &&
      cur.isActive &&
      JSON.stringify(cur.requiredDocTypes) === JSON.stringify(data.requiredDocTypes) &&
      JSON.stringify(cur.optionalDocTypes ?? []) === JSON.stringify(data.optionalDocTypes) &&
      JSON.stringify(cur.requiredFields ?? []) === JSON.stringify(data.requiredFields);
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
      `${cur ? 'update' : 'create'} ${s.scope.padEnd(8)} ${String(s.sortOrder).padStart(3)} #${s.displayNo.padEnd(3)} ${s.code.padEnd(20)} [${s.requiredDocTypes.join(', ')}]${s.requiredFields?.length ? ` +fields ${s.requiredFields.join('/')}` : ''}${s.isOngoing ? ' ongoing' : ''}`,
    );
  }

  // Templates no longer in the list (the contract-level steps before orders, shipment step 13): deactivated, not deleted.
  const listed = new Set(STEP_TEMPLATES.map((x) => `${x.scope}:${x.code}`));
  for (const [key, cur] of haveSteps) {
    if (listed.has(key) || !cur.isActive) continue;
    if (APPLY) await org.tradeStepTemplate.update({ where: { id: cur.id }, data: { isActive: false } });
    write('stepTemplate', `deactivate ${key} (${cur.title}) — kept for existing records`);
  }

  // Steps snapshot their template's number: renumbered templates relabel the existing steps (label only — status/files untouched).
  if (orgExists) {
    for (const s of STEP_TEMPLATES) {
      const owner =
        s.scope === 'SUPPLIER_ORDER' ? { supplierOrderId: { not: null } } : s.scope === 'ORDER' ? { orderId: { not: null } } : { shipmentId: { not: null } };
      const where = { organizationId: orgId, code: s.code, ...owner, NOT: { displayNo: s.displayNo } };
      const n = await tradeRead(() => org.tradeStep.count({ where }), 0);
      if (!n) continue;
      if (APPLY) await org.tradeStep.updateMany({ where, data: { displayNo: s.displayNo } });
      write('tradeStep', `renumber ${n} ${s.scope.toLowerCase()} step(s) ${s.code} → #${s.displayNo}`);
    }
    // Steps also snapshot their "Optional" doc types: a template that offers more (step 3b's Container PL / PL.XLS /
    // COA.XLS rows) passes them on to the existing steps — what is offered only; status, files and requirements untouched.
    for (const s of STEP_TEMPLATES) {
      const want = s.optionalDocTypes ?? ['OTHER'];
      const owner =
        s.scope === 'SUPPLIER_ORDER' ? { supplierOrderId: { not: null } } : s.scope === 'ORDER' ? { orderId: { not: null } } : { shipmentId: { not: null } };
      const rows: Array<{ id: string; optionalDocTypes: string[] }> = await tradeRead(
        () => org.tradeStep.findMany({ where: { organizationId: orgId, code: s.code, notApplicable: false, ...owner }, select: { id: true, optionalDocTypes: true } }),
        [],
      );
      const stale = rows.filter((r) => want.some((d) => !(r.optionalDocTypes ?? []).includes(d)));
      if (!stale.length) continue;
      if (APPLY) await org.tradeStep.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { optionalDocTypes: want } });
      write('tradeStep', `offer ${stale.length} ${s.scope.toLowerCase()} step(s) ${s.code} the optional types [${want.join(', ')}]`);
    }
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
  const curDefaults = (curSettings?.docDefaults as Record<string, unknown> | null) ?? {};
  // --customers delivery profiles replace the ones with the same id IN PLACE (round O: the stored order is kept, so a
  // profile added in the app — e.g. Kato's — doesn't make every run reorder the list and report a change); new ids
  // are appended; others are kept.
  const fileProfiles = CUSTOMER_FILE?.deliveryProfiles;
  const storedProfiles = (curDefaults.deliveryProfiles as Array<{ id: string }> | undefined) ?? [];
  const deliveryProfiles = fileProfiles?.length
    ? [...storedProfiles.map((p) => fileProfiles.find((f) => f.id === p.id) ?? p), ...fileProfiles.filter((f) => !storedProfiles.some((p) => p.id === f.id))]
    : undefined;
  const desiredDefaults: Record<string, unknown> = {
    ...curDefaults,
    ...TRADE_SETTINGS.docDefaults,
    ...(seal ? { sealImage: seal } : {}),
    ...(deliveryProfiles ? { deliveryProfiles } : {}),
    // QMJP by quarter: seeded quarters fill gaps; values edited in the app win.
    qmjpByQuarter: { ...QMJP_BY_QUARTER, ...((curDefaults.qmjpByQuarter as Record<string, number> | undefined) ?? {}) },
    // Email intake: counterparty domains never purged automatically — seeded once, edited in Org Settings → Shipping.
    intakeKeepDomains: Array.isArray(curDefaults.intakeKeepDomains) ? curDefaults.intakeKeepDomains : DEFAULT_KEEP_DOMAINS,
  };
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
    // Exactly which keys change (round N) — so a dry run shows whether an app-edited text would be reset.
    const changedKeys = [
      ...(curSettings?.defaultConsignee !== desired.defaultConsignee ? ['defaultConsignee'] : []),
      ...(curSettings?.defaultNotifyParty !== desired.defaultNotifyParty ? ['defaultNotifyParty'] : []),
      ...[...new Set([...Object.keys(curDefaults), ...Object.keys(desiredDefaults)])].filter((key) => !sameJson(curDefaults[key], desiredDefaults[key])).map((key) => `docDefaults.${key}`),
    ];
    info(`  changed: ${changedKeys.join(', ') || '(none)'}`);
    write(
      'tradeSetting',
      `${curSettings ? 'update' : 'create'} consignee "${TRADE_SETTINGS.defaultConsignee.split('\n')[0]}…", notify party "${TRADE_SETTINGS.defaultNotifyParty.split('\n')[0]}…", ${Object.keys(TRADE_SETTINGS.docDefaults).length} document texts${seal ? ', seal image' : ''}${Array.isArray(curDefaults.intakeKeepDomains) ? '' : `, intake keep-domains (${DEFAULT_KEEP_DOMAINS.length})`}${fileProfiles?.length ? `, ${fileProfiles.length} delivery profile(s) from --customers` : ''}`,
    );
  }

  // ── 9c. Email intake (store only) ─────────────────────────────────────────
  header('9c', 'Email intake (docs+{orgId}@ address: STORE / TRIAGE → PARTIAL_AUTO on prod, AUTO on dev)');
  const curIntake = orgExists ? await orgRead(() => org.emailIngestConfig.findUnique({ where: { organizationId: orgId } }), null) : null;
  const wantMode = intakeModeFor(isProd);
  if (curIntake && curIntake.enabled && (curIntake.routingMode === wantMode || !intakeMovesFrom(isProd).includes(curIntake.routingMode))) {
    info(`email intake on (${curIntake.routingMode}) — left as set in the app; senders: ${JSON.stringify(curIntake.watchedSenders)}`);
  } else {
    if (APPLY) {
      await org.emailIngestConfig.upsert({
        where: { organizationId: orgId },
        update: { enabled: true, routingMode: wantMode },
        create: { organizationId: orgId, ...EMAIL_INTAKE, routingMode: wantMode },
      });
    }
    write('emailIntake', `${curIntake ? 'update' : 'create'} EmailIngestConfig enabled, routingMode ${curIntake?.routingMode ?? '—'} → ${wantMode}${curIntake ? '' : ', all senders'}`);
  }
  // Sender filter: the allow-list seeded when empty (edited in Settings → Shipping → Email filter), notes filled
  // (Round M: the filter as it stands after this step — for the 9d backfill below.)
  let filterAfter: { mode: string; allowDomains: string[]; allowAddresses: string[] } | null = null;
  // per key, and OFF → SHADOW (a SHADOW / ENFORCE chosen in the app is left alone). Round L: single addresses from
  // --customers (emailFilterAddresses) are added to allowAddresses with their note — never printed (count only).
  {
    const cur = curIntake as { allowDomains?: string[]; allowAddresses?: string[]; filterMode?: string; filterNotes?: Record<string, string> | null } | null;
    const data: Record<string, unknown> = {};
    const wantAddrs = (CUSTOMER_FILE?.emailFilterAddresses ?? []).map((a) => ({ address: String(a.address ?? '').trim().toLowerCase(), note: a.note })).filter((a) => /^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(a.address));
    const haveAddrs = new Set((cur?.allowAddresses ?? []).map((a) => a.toLowerCase()));
    const newAddrs = wantAddrs.filter((a) => !haveAddrs.has(a.address));
    if (newAddrs.length) data.allowAddresses = [...(cur?.allowAddresses ?? []), ...newAddrs.map((a) => a.address)];
    const addrNotes = Object.fromEntries(wantAddrs.filter((a) => a.note).map((a) => [a.address, a.note as string]));
    const notes = { ...FILTER_NOTES, ...((cur?.filterNotes as Record<string, string> | null) ?? {}), ...addrNotes };
    if (!cur?.allowDomains?.length) data.allowDomains = FILTER_ALLOW_DOMAINS;
    // Key order doesn't matter (Postgres JSON keeps its own) — only a changed / added note is a write.
    const curNotes = (cur?.filterNotes ?? {}) as Record<string, string>;
    if (Object.keys(notes).length !== Object.keys(curNotes).length || Object.entries(notes).some(([k, v]) => curNotes[k] !== v)) data.filterNotes = notes;
    if (!cur?.filterMode || cur.filterMode === 'OFF') data.filterMode = 'SHADOW';
    if (curIntake)
      filterAfter = {
        mode: (data.filterMode as string) ?? cur?.filterMode ?? 'OFF',
        allowDomains: (data.allowDomains as string[]) ?? cur?.allowDomains ?? [],
        allowAddresses: (data.allowAddresses as string[]) ?? cur?.allowAddresses ?? [],
      };
    if (Object.keys(data).length) {
      if (APPLY) await org.emailIngestConfig.update({ where: { organizationId: orgId }, data });
      write(
        'emailFilter',
        [
          data.allowDomains ? `allow ${FILTER_ALLOW_DOMAINS.length} domains (${FILTER_ALLOW_DOMAINS.join(', ')})` : null,
          newAddrs.length ? `add ${newAddrs.length} allowed address(es) (${newAddrs.map((a) => `@${a.address.split('@')[1]}${a.note ? ` — "${a.note}"` : ''}`).join(', ')})` : null,
          data.filterNotes
            ? `notes: ${Object.entries(notes)
                .filter(([k, v]) => (cur?.filterNotes ?? {})[k] !== v)
                .map(([k, v]) => `${k.includes('@') ? `@${k.split('@')[1]}` : k} = ${v}`)
                .join('; ')}`
            : null,
          data.filterMode ? `filterMode ${cur?.filterMode ?? 'OFF'} → SHADOW` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      );
    } else info(`sender filter ${cur?.filterMode} — ${cur?.allowDomains?.length ?? 0} allowed domains, ${cur?.allowAddresses?.length ?? 0} address(es) (left as set in the app)`);
  }

  // 9d (round M). SHADOW backfill: emails stored before the filter went on were never judged, so Shipments ›
  // Inbox › Filter preview showed "kept 0 · would drop 0". Judge the last 30 days of rows that still have
  // metadata with the same rule as live intake (email-filter.judge.ts) and write ONLY filterVerdict /
  // filterReason on rows that have none — no content, state or match changes. Purged rows are skipped.
  if (filterAfter && filterAfter.mode !== 'OFF') {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows: Array<JudgeRow & { filterVerdict: string | null }> = await orgRead(
      () =>
        org.emailIngestLog.findMany({
          where: { organizationId: orgId, createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, messageId: true, fromAddress: true, subject: true, inboxState: true, rawMeta: true, threadKey: true, inReplyTo: true, orderId: true, filterVerdict: true },
        }),
      [],
    );
    const ts = await orgRead(() => org.tradeSetting.findUnique({ where: { organizationId: orgId }, select: { docDefaults: true, supplierProfiles: true } }), null);
    const sk = supplierKeyPatterns(ts?.supplierProfiles);
    const orders: Array<{ id: string; orderNo: number }> = await orgRead(() => org.tradeOrder.findMany({ where: { organizationId: orgId }, select: { id: true, orderNo: true } }), []);
    const judged = judgeStoredRows(rows, { allowDomains: filterAfter.allowDomains, allowAddresses: filterAfter.allowAddresses, keyPatterns: [...sk.pi, ...sk.contract, ...sk.ci] }, ownDomainsOf((ts?.docDefaults as Record<string, unknown> | null) ?? null), new Map(orders.map((o) => [o.id, o.orderNo])));
    const todo = judged.filter((j) => !j.skipped && !rows.find((x) => x.id === j.id)?.filterVerdict);
    if (todo.length) {
      if (APPLY) for (const j of todo) await org.emailIngestLog.update({ where: { id: j.id }, data: { filterVerdict: j.keep ? 'KEEP' : 'DROP', filterReason: j.reason } });
      const keep = todo.filter((j) => j.keep).length;
      write('filterBackfill', `judge ${todo.length} stored email(s) of the last 30 days (filterVerdict / filterReason only): KEEP ${keep} · DROP ${todo.length - keep}; ${judged.filter((j) => j.skipped).length} purged row(s) skipped`);
    } else info(`filter backfill: nothing to judge (${rows.filter((x) => x.filterVerdict).length} already judged, ${judged.filter((j) => j.skipped).length} purged)`);
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
  // Round M: suppliers from --customers (kept out of the repo).
  for (const s of CUSTOMER_FILE?.suppliers ?? []) await ensureContact('supplier', { name: s.name, currency: s.currency ?? 'USD', note: s.note });
  if (!CUSTOMER_FILE) info('customer Japanese name / address / contact left as they are (pass --customers=<json> to fill them)');
  for (const c of CUSTOMERS) {
    const detail = CUSTOMER_FILE?.customers?.find((d) => d.name.toLowerCase() === c.name.toLowerCase());
    await ensureContact('customer', { ...c, jpName: detail?.jpName, jpAddress: detail?.jpAddress, jpContact: detail?.jpContact });
  }

  // ── 10b. Customer profiles + estimator rates ──────────────────────────────
  header('10b', 'Customer profiles + estimator rates');
  const tsRow = orgExists ? await tradeRead(() => org.tradeSetting.findUnique({ where: { organizationId: orgId } }), null) : null;
  const curProfiles = ((tsRow?.customerProfiles as Record<string, CustomerProfile> | null) ?? {}) as Record<string, CustomerProfile>;
  const nextProfiles: Record<string, CustomerProfile> = { ...curProfiles };
  // Legacy delivery profiles (docDefaults.deliveryProfiles) move into the customer's profile.
  const legacySites = [...(((tsRow?.docDefaults as Record<string, unknown> | null)?.deliveryProfiles as Array<any> | undefined) ?? []), ...(CUSTOMER_FILE?.deliveryProfiles ?? [])];
  for (const [name, seed] of Object.entries(PROFILE_SEED)) {
    const cust = orgExists ? await orgRead(() => org.customer.findFirst({ where: { organizationId: orgId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } }), null) : null;
    if (!cust) {
      info(`profile for "${name}": customer not created yet${APPLY ? '' : ' (dry run)'} — set on the next run`);
      continue;
    }
    const site = legacySites.find((p) => p?.customerName && name.toLowerCase().includes(String(p.customerName).toLowerCase()));
    const cur = curProfiles[cust.id];
    const want: CustomerProfile = {
      customerId: cust.id,
      ...seed,
      emailDomains: CUSTOMER_FILE?.customers?.find((c) => c.name.toLowerCase() === name.toLowerCase())?.emailDomains ?? seed.emailDomains,
      deliveryProfile: site
        ? {
            siteName: site.siteName,
            address: site.address,
            notes: site.notes ?? '',
            // Round N: the site's own 倉庫名 (Kato / Nagoya: blank + check until ADH confirms it).
            ...(site.label ? { label: site.label } : {}),
            ...(site.warehouseName ? { warehouseName: site.warehouseName } : {}),
            ...(site.warehouseCheck ? { warehouseCheck: true } : {}),
          }
        : null,
    };
    // App edits win: keep every key already set, fill the rest.
    const merged = cur ? ({ ...want, ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))) } as CustomerProfile) : want;
    // A bank picked in the app is confirmed: don't put the seed's "check" back on it.
    if (cur?.defaultBankId && !cur.defaultBankCheck) delete merged.defaultBankCheck;
    if (cur && sameJson(cur, merged)) {
      info(`profile "${seed.key}" set (${merged.billingMode}, ${merged.port ?? '—'}, ${merged.truckCapacityT}t)`);
      continue;
    }
    nextProfiles[cust.id] = merged;
    write(
      'profile',
      `${cur ? 'fill' : 'create'} ${seed.key}: ${merged.billingMode}, import permit ${merged.sendImportPermit ? 'sent' : 'not sent'}, ${merged.port} ${merged.truckCapacityT}t ¥${merged.customsRatePerMt}/MT, templates ${Object.values(merged.docVariants).join('/')}, bank ${merged.defaultBankId ?? 'org default'}${merged.defaultBankCheck ? ' (check)' : ''}${merged.deliveryProfile ? `, delivery site "${merged.deliveryProfile.siteName}"` : ''}`,
    );
  }
  const curRates = (tsRow?.estimatorRates as Record<string, unknown> | null) ?? null;
  const wantRates = { ...DEFAULT_RATES, ...(curRates ?? {}) };
  if (curRates && sameJson(curRates, wantRates)) info('estimator rates set');
  else write('estimatorRates', `${curRates ? 'fill' : 'set'} estimator rates: customs ¥${wantRates.customsPerMt}/MT ×${wantRates.taxMultiplier}, B/L ¥${wantRates.blFee}, trucks ${JSON.stringify(wantRates.truckRates)}, storage ¥${wantRates.storagePerContainer}/CNT ¥${wantRates.storagePerMt}/MT, washing ¥${wantRates.washingPerContainer}/CNT, detention ¥${wantRates.detentionPerContainer}/CNT, import tax = permit formula (7.8% + 22/78)`);
  if (APPLY && orgExists && tradeReady && (!sameJson(curProfiles, nextProfiles) || !curRates || !sameJson(curRates, wantRates))) {
    await org.tradeSetting.upsert({
      where: { organizationId: orgId },
      update: { customerProfiles: nextProfiles as any, estimatorRates: wantRates as any },
      create: { organizationId: orgId, customerProfiles: nextProfiles as any, estimatorRates: wantRates as any },
    });
  }

  // Supplier profiles: the script's keys fill a profile; anything set in the app wins.
  const curSupProfiles = ((tsRow?.supplierProfiles as Record<string, SupplierProfile> | null) ?? {}) as Record<string, SupplierProfile>;
  const nextSupProfiles: Record<string, SupplierProfile> = { ...curSupProfiles };
  const supplierSeeds: Record<string, Omit<SupplierProfile, 'supplierId'>> = {
    ...SUPPLIER_PROFILE_SEED,
    ...Object.fromEntries((CUSTOMER_FILE?.suppliers ?? []).filter((x) => x.profile).map((x) => [x.name, x.profile!])),
  };
  for (const [name, seed] of Object.entries(supplierSeeds)) {
    const sup = orgExists ? await orgRead(() => org.supplier.findFirst({ where: { organizationId: orgId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } }), null) : null;
    // Dry run: a supplier this run creates gets its profile in the same (applied) run — show it as planned.
    const newThisRun = !sup && !APPLY && (CUSTOMER_FILE?.suppliers ?? []).some((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!sup && !newThisRun) {
      info(`supplier profile for "${name}": supplier not created yet${APPLY ? '' : ' (dry run)'} — set on the next run`);
      continue;
    }
    const supId = sup?.id ?? `(new ${name})`;
    const cur = curSupProfiles[supId];
    const merged = cur ? ({ ...seed, ...cur, supplierId: supId } as SupplierProfile) : ({ ...seed, supplierId: supId } as SupplierProfile);
    if (cur && sameJson(cur, merged)) {
      info(`supplier profile "${seed.key}" set (PI ${merged.hasPI ? 'yes' : 'no'})`);
      continue;
    }
    if (sup) nextSupProfiles[sup.id] = merged;
    write(
      'supplierProfile',
      `${cur ? 'fill' : 'create'} ${seed.key}: PI ${merged.hasPI ? 'yes (deposit on step 1)' : 'no (step 1 N/A, CI paid in full)'}${merged.pricingMode ? `, pricing ${merged.pricingMode}${merged.priceUnit ? ` ${merged.priceUnit}` : ''}` : ''}${merged.country ? `, ${merged.country}` : ''}${merged.loadingPort ? ` / ${merged.loadingPort}` : ''}${merged.paymentTerms ? `, ${merged.paymentTerms.advancePct}% advance / balance vs ${merged.paymentTerms.balanceAgainst}${merged.paymentTerms.balanceDays ? ` (${merged.paymentTerms.balanceDays} bank days)` : ''}` : ''}${[...(merged.piNoPatterns ?? []), ...(merged.contractNoPatterns ?? [])].length ? `, keys ${[...(merged.piNoPatterns ?? []), ...(merged.contractNoPatterns ?? [])].join(' ')}` : ''}`,
    );
  }
  if (APPLY && orgExists && tradeReady && !sameJson(curSupProfiles, nextSupProfiles)) {
    await org.tradeSetting.upsert({
      where: { organizationId: orgId },
      update: { supplierProfiles: nextSupProfiles as any },
      create: { organizationId: orgId, supplierProfiles: nextSupProfiles as any },
    });
  }

  // ── 10b2 (round N). Click-through test orders → "Mark as test" (hidden by default; nothing deleted) ─────────
  if (tradeReady && org.tradeOrder) {
    const tests: Array<{ id: string; orderNo: number; isTest: boolean }> = await orgRead(
      () => org.tradeOrder.findMany({ where: { organizationId: orgId, year: TEST_ORDERS.year, orderNo: { in: TEST_ORDERS.orderNos } }, select: { id: true, orderNo: true, isTest: true } }),
      [],
    );
    const todo = tests.filter((o) => !o.isTest);
    if (todo.length) {
      if (APPLY) await org.tradeOrder.updateMany({ where: { organizationId: orgId, id: { in: todo.map((o) => o.id) } }, data: { isTest: true } });
      write('testOrders', `mark as test: ${todo.map((o) => `#${o.orderNo}`).join(', ')} (hidden from lists, Home, counts and alerts — "Show test orders" brings them back)`);
    } else info(`test orders: ${tests.length ? `${tests.map((o) => `#${o.orderNo}`).join(', ')} already marked` : 'none of the click-through orders exist here'}`);
  }

  // ── 10c. Orders backfill (deals from before orders → Order + shipments) ───
  header('10c', 'Orders backfill (Contract → Order → Shipment)');
  if (!tradeReady || !org.tradeOrder) {
    info('TradeOrder table / client not ready — push the schema first');
  } else {
    const bf = await backfillOrders(org, orgId, { apply: APPLY, write, info });
    if (!bf.orders.length) info('nothing to backfill (every shipment has an order)');
    // Existing Customer PL / COA drafts and PDFs were made with the Kato layout: tag them.
    const untagged = await org.tradeGeneratedDoc.count({ where: { organizationId: orgId, docType: { in: ['CUSTOMER_PL', 'CUSTOMER_COA'] }, templateKey: null } });
    if (untagged) {
      if (APPLY) {
        await org.tradeGeneratedDoc.updateMany({ where: { organizationId: orgId, docType: 'CUSTOMER_PL', templateKey: null }, data: { templateKey: 'CUSTOMER_PL_KATO' } });
        await org.tradeGeneratedDoc.updateMany({ where: { organizationId: orgId, docType: 'CUSTOMER_COA', templateKey: null }, data: { templateKey: 'CUSTOMER_COA_KATO' } });
      }
      write('templateKey', `tag ${untagged} existing Customer PL / COA document(s) with the Kato template key`);
    }
  }

  // ── 10d. Contract master (2026-10): pricing basis, quantities, premium schedule ─
  header('10d', 'Contract master (premium schedule, QP / QMJP rules) + LME averages');
  if (!tradeReady || !org.contract) {
    info('Contract table / client not ready — push the schema first');
  } else {
    const vedanta = await orgRead(() => org.supplier.findFirst({ where: { organizationId: orgId, name: { equals: VEDANTA, mode: 'insensitive' } }, select: { id: true } }), null);
    for (const c of CONTRACT_SEED) {
      const cust = await orgRead(() => org.customer.findFirst({ where: { organizationId: orgId, name: { equals: c.customer, mode: 'insensitive' } }, select: { id: true } }), null);
      const cur = await orgRead(() => org.contract.findFirst({ where: { organizationId: orgId, contractNo: c.contractNo } }), null);
      const master: Record<string, unknown> = {
        grade: c.grade,
        sizeSpec: c.sizeSpec,
        periodStart: c.periodStart ? new Date(c.periodStart) : null,
        periodEnd: c.periodEnd ? new Date(c.periodEnd) : null,
        annualQtyMt: c.annualQtyMt,
        tolerancePct: c.tolerancePct,
        qpBasis: c.qpBasis,
        qmjpRule: MJP_RULE,
        balanceTerms: c.balanceTerms,
        premiumSchedule: c.premiumSchedule,
      };
      if (!cur) {
        if (!vedanta || !cust) {
          info(`contract ${c.contractNo}: ${!vedanta ? 'Vedanta' : c.customer} not created yet${APPLY ? '' : ' (dry run)'} — set on the next run`);
          continue;
        }
        if (APPLY) {
          await org.contract.create({
            data: {
              organizationId: orgId,
              contractNo: c.contractNo,
              supplierId: vedanta.id,
              customerId: cust.id,
              incoterm: c.incoterm,
              destinationPort: c.destinationPort,
              destinationCountry: c.destinationCountry,
              currency: 'USD',
              depositPercent: 10,
              depositDueDays: c.depositDueDays,
              depositDueUnit: 'BUSINESS',
              ...master,
              checkFields: c.checkFields,
              notes: 'Contract master seeded from the PI / contract scans (2026-10)',
              lines: { create: [{ organizationId: orgId, sortOrder: 0, product: c.product, grade: c.grade, sizeSpec: c.sizeSpec, quantityMt: c.lineQtyMt, tolerancePct: c.tolerancePct, supplierPremium: c.premiumSchedule[0]?.supplierPremium ?? null, clientPremium: c.premiumSchedule[0]?.clientPremium ?? null, billetPremium: c.premiumSchedule[0]?.clientPremium ?? null, upcharge: c.premiumSchedule[0]?.upcharge ?? null }] },
            },
          });
        }
        write('contract', `create ${c.contractNo} (${c.customer} · ${c.grade} · ${c.lineQtyMt ?? '?'} MT, ${c.destinationPort}) — check: ${c.checkFields.join(', ') || 'none'}`);
        continue;
      }
      // Existing contract: only blank master fields are filled (anything set in the app wins).
      const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
      const fill = Object.fromEntries(Object.entries(master).filter(([k, v]) => !blank(v) && blank((cur as Record<string, unknown>)[k])));
      if (blank(cur.checkFields) && c.checkFields.length) fill.checkFields = c.checkFields;
      if (!Object.keys(fill).length) {
        info(`contract ${c.contractNo} master set`);
        continue;
      }
      if (APPLY) await org.contract.update({ where: { id: cur.id }, data: fill });
      write('contract', `fill ${c.contractNo}: ${Object.keys(fill).join(', ')}`);
    }
    // LME monthly averages for the price check: months set in the app win.
    const dd = ((tsRow?.docDefaults as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const curLme = (dd.lmeByMonth as Record<string, number> | undefined) ?? {};
    const addLme = Object.fromEntries(Object.entries(LME_SEED).filter(([m]) => curLme[m] === undefined));
    if (!Object.keys(addLme).length) info('LME averages set');
    else {
      if (APPLY && orgExists) {
        const fresh = await org.tradeSetting.findUnique({ where: { organizationId: orgId }, select: { docDefaults: true } });
        await org.tradeSetting.update({ where: { organizationId: orgId }, data: { docDefaults: { ...((fresh?.docDefaults as object) ?? {}), lmeByMonth: { ...curLme, ...addLme } } as any } });
      }
      write('lme', `add LME averages ${Object.entries(addLme).map(([m, v]) => `${m} ${v}`).join(', ')}`);
    }
  }

  // ── 10e. One order process (2026-10, round H): supplier orders fold back into their orders ─
  header('10e', 'One order process (PI fields + steps 0 / 1 back on the order, step 11 on the order, payments → steps)');
  if (!tradeReady || !org.supplierOrder || !org.tradeOrder) {
    info('SupplierOrder / TradeOrder table / client not ready — push the schema first');
  } else {
    const spec = (code: string) => {
      const t = STEP_TEMPLATES.find((x) => x.scope === 'ORDER' && x.code === code)!;
      return { code: t.code, displayNo: t.displayNo, title: t.title, sortOrder: t.sortOrder, requiredDocTypes: t.requiredDocTypes, optionalDocTypes: t.optionalDocTypes ?? ['OTHER'], requiredFields: t.requiredFields ?? [] };
    };
    const ts = await org.tradeSetting.findUnique({ where: { organizationId: orgId }, select: { supplierProfiles: true, customerProfiles: true } });
    const noPi = new Set(Object.entries((ts?.supplierProfiles ?? {}) as Record<string, { hasPI?: boolean }>).filter(([, p]) => p?.hasPI === false).map(([id]) => id));
    const single = new Set(Object.entries((ts?.customerProfiles ?? {}) as Record<string, { billingMode?: string }>).filter(([, p]) => p?.billingMode === 'SINGLE').map(([id]) => id));
    const f = await foldSupplierOrders(org, orgId, { apply: APPLY, templates: [spec('CHECK_CONTRACT'), spec('PI_PAYMENT')], noPiSupplierIds: noPi, write });
    const m = await moveInvoice2ToOrder(org, orgId, { apply: APPLY, template: spec('INVOICE_2'), singleCustomerIds: single, write });
    const p = org.tradePayment ? await copyPaymentsToSteps(org, orgId, { apply: APPLY, write }) : null;
    info(
      `copy-back: ${f.orders} order(s) touched — ${f.piFields} PI field(s), ${f.steps} step(s) moved, ${f.copies} copied, ${f.fileLinks} file link(s), ${f.added} step(s) added; ` +
        `step 11: ${m.orderSteps} order step(s) added, ${m.shipmentSteps} shipment step(s) → N/A; ` +
        (p ? `payments: ${p.payments} row(s) — ${p.copied} copied to steps, ${p.notOneToOne} not 1:1, ${p.noStep} without a step, ${p.already} step(s) already filled` : 'payments: table not there'),
    );
  }

  // ── 10f. Entities (2026-10): ADH JP / ADH SG on generated documents and bank accounts ─
  header('10f', 'Issuing entities (generated documents, bank accounts)');
  if (!tradeReady || !org.tradeGeneratedDoc) {
    info('TradeGeneratedDoc table / client not ready — push the schema first');
  } else {
    const untaggedDocs: Array<{ id: string; docType: string }> = await org.tradeGeneratedDoc.findMany({ where: { organizationId: orgId, issuingEntity: null }, select: { id: true, docType: true } });
    if (!untaggedDocs.length) info('every generated document has its entity');
    else {
      const byEntity = new Map<string, string[]>();
      for (const d of untaggedDocs) byEntity.set(entityFor(d.docType), [...(byEntity.get(entityFor(d.docType)) ?? []), d.id]);
      for (const [entity, ids] of byEntity) {
        if (APPLY) await org.tradeGeneratedDoc.updateMany({ where: { organizationId: orgId, id: { in: ids } }, data: { issuingEntity: entity } });
        write('entity', `tag ${ids.length} generated document(s) ${entity}`);
      }
    }
    const fresh = await tradeRead(() => org.tradeSetting.findUnique({ where: { organizationId: orgId }, select: { docDefaults: true } }), null);
    const banks = (((fresh?.docDefaults as Record<string, unknown> | null)?.banks as Array<Record<string, unknown>> | undefined) ?? []).filter(Boolean);
    const untaggedBanks = banks.filter((b) => b.entity !== 'ADH_JP' && b.entity !== 'ADH_SG');
    if (!untaggedBanks.length) info(banks.length ? 'every bank account has its entity' : 'no bank accounts yet');
    else {
      const next = banks.map((b) => ({ ...b, entity: bankEntity(b as { label?: string; entity?: string }) }));
      if (APPLY) await org.tradeSetting.update({ where: { organizationId: orgId }, data: { docDefaults: { ...((fresh?.docDefaults as object) ?? {}), banks: next } as any } });
      write('entity', `tag ${untaggedBanks.length} bank account(s): ${untaggedBanks.map((b) => `${b.label} → ${bankEntity(b as { label?: string })}`).join(', ')}`);
    }
  }

  // ── 10g. Premiums = fixed part (QMJP is added by quarter when pricing) ────
  // Stored premiums were sometimes QMJP-inclusive (a PI's 556.50 = 2Q QMJP 351.5 + 205). From
  // round F every stored premium is the fixed part; finalized documents are never touched.
  header('10g', 'Premiums: stored as the fixed part (QMJP added by quarter)');
  if (!tradeReady || !org.supplierOrder) {
    info('trade tables / client not ready — push the schema first');
  } else {
    const SUPPLIER_FIXED: Record<string, number> = { '556.5': 205, '513.5': 162 };
    const CLIENT_FIXED: Record<string, number> = { '581.5': 230, '551.5': 200 };
    const key = (v: unknown) => (v === null || v === undefined ? '' : String(Number(v)));
    // 551.50 → 200 is the client's total fixed premium (6005: 190 + 10 upcharge): a row with its own upcharge keeps it apart.
    const clientFixed = (v: unknown, upcharge: unknown) => (CLIENT_FIXED[key(v)] === undefined ? null : CLIENT_FIXED[key(v)] - (key(v) === '551.5' ? Number(upcharge ?? 0) : 0));
    let moved = 0;
    const orders: Array<{ id: string; orderNo: number; supplierPremium: unknown; clientPremium: unknown; upcharge: unknown }> = await org.tradeOrder.findMany({ where: { organizationId: orgId }, select: { id: true, orderNo: true, supplierPremium: true, clientPremium: true, upcharge: true } });
    for (const o of orders) {
      const sp = SUPPLIER_FIXED[key(o.supplierPremium)];
      const cp = clientFixed(o.clientPremium, o.upcharge);
      if (sp === undefined && cp === null) continue;
      if (APPLY) await org.tradeOrder.update({ where: { id: o.id }, data: { ...(sp !== undefined ? { supplierPremium: sp } : {}), ...(cp !== null ? { clientPremium: cp } : {}) } });
      write('premium', `order #${o.orderNo}: ${sp !== undefined ? `supplier ${key(o.supplierPremium)} → ${sp}` : ''}${sp !== undefined && cp !== null ? ', ' : ''}${cp !== null ? `client ${key(o.clientPremium)} → ${cp}` : ''}`);
      moved++;
    }
    const sos: Array<{ id: string; year: number; soNo: number; supplierPremium: unknown }> = await org.supplierOrder.findMany({ where: { organizationId: orgId }, select: { id: true, year: true, soNo: true, supplierPremium: true } });
    for (const so of sos) {
      const sp = SUPPLIER_FIXED[key(so.supplierPremium)];
      if (sp === undefined) continue;
      if (APPLY) await org.supplierOrder.update({ where: { id: so.id }, data: { supplierPremium: sp } });
      write('premium', `supplier order ${so.year}-S${so.soNo}: supplier ${key(so.supplierPremium)} → ${sp}`);
      moved++;
    }
    const lines: Array<{ id: string; grade: string | null; supplierPremium: unknown; clientPremium: unknown; billetPremium: unknown; upcharge: unknown; contract: { contractNo: string } }> = await org.contractLine.findMany({
      where: { contract: { organizationId: orgId } },
      select: { id: true, grade: true, supplierPremium: true, clientPremium: true, billetPremium: true, upcharge: true, contract: { select: { contractNo: true } } },
    });
    for (const l of lines) {
      const sp = SUPPLIER_FIXED[key(l.supplierPremium)];
      // A line keeps the client premium in two columns (clientPremium, and billetPremium for the 請求書 helper).
      const cp = clientFixed(l.clientPremium, l.upcharge);
      const bp = clientFixed(l.billetPremium, l.upcharge);
      if (sp === undefined && cp === null && bp === null) continue;
      if (APPLY)
        await org.contractLine.update({ where: { id: l.id }, data: { ...(sp !== undefined ? { supplierPremium: sp } : {}), ...(cp !== null ? { clientPremium: cp } : {}), ...(bp !== null ? { billetPremium: bp } : {}) } });
      const parts = [sp !== undefined ? `supplier ${key(l.supplierPremium)} → ${sp}` : '', cp !== null ? `client ${key(l.clientPremium)} → ${cp}` : '', bp !== null ? `billet ${key(l.billetPremium)} → ${bp}` : ''];
      write('premium', `contract ${l.contract.contractNo} line ${l.grade ?? '—'}: ${parts.filter(Boolean).join(', ')}`);
      moved++;
    }
    if (!moved) info('every stored premium is the fixed part');
  }

  // ── 10h. Kato contract 454003598: a 6063 line (2026-10) ────────────────────
  // Kato also buys 6063 under 454003598 (#17 / #21 / #22): the line lets those orders and their price checks find
  // their grade. Vedanta's 6063 fixed premium for Kato isn't confirmed ("check"); the client premium is per order.
  // The 6005 schedule row is tagged 6005 so it never prices a 6063 order, and the 260 the task-list import copied
  // from the 6005 line onto the 6063 orders / supplier orders is cleared (flagged "check" already).
  header('10h', 'Kato contract 454003598: 6063 line');
  if (!tradeReady || !org.contract) {
    info('Contract table / client not ready — push the schema first');
  } else {
    const kc = await orgRead(
      () => org.contract.findFirst({ where: { organizationId: orgId, contractNo: '454003598' }, select: { id: true, premiumSchedule: true, lines: { select: { id: true, grade: true, sortOrder: true, supplierPremium: true } } } }),
      null,
    );
    if (!kc) info(`contract 454003598 not created yet${APPLY ? '' : ' (dry run)'} — set on the next run`);
    else {
      let did = 0;
      const lines = kc.lines as Array<{ id: string; grade: string | null; sortOrder: number; supplierPremium: unknown }>;
      if (!lines.some((l) => (l.grade ?? '').trim() === '6063')) {
        if (APPLY)
          await org.contractLine.create({
            data: {
              organizationId: orgId,
              contractId: kc.id,
              sortOrder: Math.max(0, ...lines.map((l) => l.sortOrder)) + 1,
              product: 'Aluminium Billet',
              grade: '6063',
              tolerancePct: 5,
              supplierPremium: null,
              clientPremium: null,
              billetPremium: null,
              notes: 'Supplier fixed premium: check (not confirmed by ADH). Client premium: per order.',
            },
          });
        write('contractLine', 'contract 454003598: add line 6063 (supplier fixed premium "check", client premium per order)');
        did++;
      }
      const sched = (Array.isArray(kc.premiumSchedule) ? kc.premiumSchedule : []) as Array<Record<string, unknown>>;
      if (sched.length && sched.every((r) => !r.grade)) {
        if (APPLY) await org.contract.update({ where: { id: kc.id }, data: { premiumSchedule: sched.map((r) => ({ ...r, grade: '6005' })) as any } });
        write('contract', `contract 454003598: premium schedule row(s) → grade 6005 (${sched.map((r) => `${r.from} ${r.supplierPremium ?? '—'} / ${r.clientPremium ?? '—'}`).join(', ')})`);
        did++;
      }
      // The import's 6005 default on the 6063 orders: cleared only while still flagged "check".
      // The 6005 value they got: the 6005 line's, else the (then ungraded) schedule row's.
      const p6005 = lines.find((l) => (l.grade ?? '').trim() === '6005')?.supplierPremium ?? sched.find((r) => !r.grade || r.grade === '6005')?.supplierPremium;
      const os: Array<{ id: string; orderNo: number; grade: string | null; supplierPremium: unknown; checkFields: string[]; supplierOrderId: string | null }> = await org.tradeOrder.findMany({
        where: { organizationId: orgId, contractId: kc.id, grade: { startsWith: '6063' } },
        select: { id: true, orderNo: true, grade: true, supplierPremium: true, checkFields: true, supplierOrderId: true },
      });
      for (const o of os) {
        if (p6005 === null || p6005 === undefined || !o.checkFields.includes('supplierPremium')) continue;
        if (o.supplierPremium !== null && Number(o.supplierPremium) === Number(p6005)) {
          if (APPLY) await org.tradeOrder.update({ where: { id: o.id }, data: { supplierPremium: null } });
          write('premium', `order #${o.orderNo} (${o.grade}): supplier ${Number(o.supplierPremium)} (6005's) → blank ("check")`);
          did++;
        }
        if (!o.supplierOrderId) continue;
        const so = await org.supplierOrder.findFirst({ where: { id: o.supplierOrderId }, select: { id: true, year: true, soNo: true, supplierPremium: true } });
        if (so && so.supplierPremium !== null && Number(so.supplierPremium) === Number(p6005)) {
          if (APPLY) await org.supplierOrder.update({ where: { id: so.id }, data: { supplierPremium: null } });
          write('premium', `supplier order ${so.year}-S${so.soNo} (#${o.orderNo}): supplier ${Number(so.supplierPremium)} → blank ("check")`);
          did++;
        }
      }
      if (!did) info('contract 454003598 has its 6063 line; schedule graded; 6063 orders priced on their own');
    }
  }

  // ── 10i. Reminders (round O) ──────────────────────────────────────────────
  // Open reminders that the app's rules now close: an INVOICE_DUE on an invoice
  // whose receipt AIMS never tracked (closed order / imported receipt step, no
  // receipt on the step — "imported, payment not tracked"), and a FREE_TIME on a
  // shipment that is past the port (step 9 done, or step 8 imported "completed
  // before AIMS") or closed. Everything else is listed and kept. The hourly
  // sweep would resolve the same rows on its own; this step does it now and
  // shows exactly which.
  header('10i', 'Reminders (imported invoices, cleared shipments)');
  if (!tradeReady || !org.tradeAlert) {
    info('TradeAlert table / client not ready — push the schema first');
  } else {
    const open = await orgRead(
      () => org.tradeAlert.findMany({ where: { organizationId: orgId, status: { in: ['DUE', 'SCHEDULED'] } }, orderBy: { dueAt: 'asc' }, select: { id: true, kind: true, key: true, title: true, status: true, shipmentId: true, orderId: true } }),
      [] as Array<{ id: string; kind: string; key: string; title: string; status: string; shipmentId: string | null; orderId: string | null }>,
    );
    if (!open.length) info('no open reminders');
    let closed = 0;
    for (const a of open) {
      let why: string | null = null;
      if (a.kind === 'INVOICE_DUE') {
        const g = await org.tradeGeneratedDoc.findFirst({
          where: { id: a.key.slice('INVOICE_DUE:'.length), organizationId: orgId },
          select: { docType: true, orderId: true, order: { select: { status: true } }, shipment: { select: { orderId: true, order: { select: { status: true } } } } },
        });
        if (g) {
          const orderId = g.orderId ?? g.shipment?.orderId ?? null;
          const order = g.order ?? g.shipment?.order ?? null;
          const step = await org.tradeStep.findFirst({ where: { organizationId: orgId, orderId, shipmentId: null, code: g.docType === 'INVOICE_1' ? 'INVOICE_1' : 'INVOICE_2' }, select: { payment: true, skipReason: true } });
          const paid = stepPaymentOf(step?.payment)?.amount ?? 0;
          if (receiptNotTracked({ orderStatus: order?.status ?? null, stepSkipReason: step?.skipReason ?? null, paid })) why = `${NOT_TRACKED_NOTE.replace(/\.$/, '')} (order ${order?.status ?? '—'}, no receipt on the step)`;
          else why = null;
          if (!why) info(`keep "${a.title}" — order ${order?.status ?? '—'}, receipt ${paid > 0 ? `recorded ${paid}` : 'not recorded'}`);
        } else why = 'invoice no longer exists';
      } else if (a.kind === 'FREE_TIME' && a.shipmentId) {
        const sh = await org.shipment.findFirst({ where: { id: a.shipmentId, organizationId: orgId }, select: { status: true, steps: { select: { code: true, status: true, skipReason: true } } } });
        if (!sh) why = 'shipment no longer exists';
        else {
          const step = (code: string) => sh.steps.find((x: { code: string }) => x.code === code);
          const cleared = step('AN_INSTRUCTIONS')?.status === 'DONE' || (step('TAX_FUNDS')?.status === 'DONE' && step('TAX_FUNDS')?.skipReason === IMPORT_NOTE);
          if (sh.status !== 'OPEN') why = `shipment ${sh.status}`;
          else if (cleared) why = 'past the port (step 9 done)';
          else {
            const current = sh.steps.find((x: { status: string }) => x.status === 'IN_PROGRESS') ?? sh.steps.find((x: { status: string }) => x.status === 'NOT_STARTED');
            info(`keep "${a.title}" — live (shipment OPEN, ${current ? `step ${current.code} ${current.status}` : 'steps done'})`);
          }
        }
      } else info(`keep "${a.title}" (${a.kind}, ${a.status})`);
      if (!why) continue;
      if (APPLY) await org.tradeAlert.update({ where: { id: a.id }, data: { status: 'DONE', resolvedAt: new Date() } });
      write('reminder', `close "${a.title}" — ${why}`);
      closed++;
    }
    if (open.length && !closed) info('every open reminder is live');
  }

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

type CustomerFile = {
  customers?: Array<{ name: string; jpName?: string; jpAddress?: string; jpContact?: string; emailDomains?: string[] }>;
  deliveryProfiles?: Array<{ id: string; customerName: string; siteName: string; address: string; notes?: string; label?: string; warehouseName?: string; warehouseCheck?: boolean }>;
  /** Round L: single sender addresses for the email filter's allow-list (people on gmail.com etc.) — kept out of the repo. */
  emailFilterAddresses?: Array<{ address: string; note?: string }>;
  /** Round M: further suppliers (SIAE…) with their profile — created like the built-in ones, profile filled (app edits win). */
  suppliers?: Array<{ name: string; currency?: string; address?: string; note?: string; profile?: Omit<SupplierProfile, 'supplierId'> }>;
};
/** --customers=<file>: customer details kept out of the repo (see the header). */
function readCustomerFile(file: string): CustomerFile {
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as CustomerFile;
  for (const c of data.customers ?? []) if (!c?.name) throw new Error('--customers: every customer needs a "name"');
  for (const p of data.deliveryProfiles ?? []) if (!p?.id || !p.siteName) throw new Error('--customers: every delivery profile needs "id" and "siteName"');
  return data;
}

/** --seal=<file>: a PNG / JPEG (≤ 1 MB) as a data: URL for docDefaults.sealImage. */
function sealDataUrl(file: string): string {
  const buf = fs.readFileSync(path.resolve(file));
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isPng && !isJpeg) throw new Error(`--seal: ${file} is not a PNG or JPEG`);
  if (buf.length > 1024 * 1024) throw new Error('--seal: the image must be 1 MB or smaller');
  return `data:image/${isPng ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
}
