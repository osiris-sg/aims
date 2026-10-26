/**
 * WCT — document templates + letterhead profile, from the paper documents guru
 * photographed on 2026-10-22 (Quotation -014162-R0, Tax Invoice I-015128,
 * Delivery Order DO011982 of WCT (S) Systems Pte Ltd).
 *
 * What templates CAN carry in AIMS (Admin → org → Document Types → Manage
 * Templates → Design; see memory template-design-knobs): editor fields
 * (config.formFields), table columns (config.tableColumnOrder / columnLabels)
 * and the design knobs (styleConfig: logo position, header alignment, title
 * text, which standard blocks print, footer line). They do NOT carry page
 * layout — that is a hard-coded branch per type in CleanDocumentPreview and
 * src/common/services/document-html. So this script sets everything the
 * template mechanism owns; the WCT-specific frame (letterhead with logo
 * beside the company block, Job Location / Subject boxes, S/No column,
 * GST line on the quotation totals, Sales Person / Confirmation-of-Order
 * signature block, "Page n/N") needs its own renderer branch — not done here.
 *
 *   npx ts-node --transpile-only scripts/setup-wct-templates.ts --env dev           # dry run
 *   npx ts-node --transpile-only scripts/setup-wct-templates.ts --env dev --apply
 *   npx ts-node --transpile-only scripts/setup-wct-templates.ts --env prod --apply  # guru runs with `!`
 *
 * 2026-10-22 (later the same day): the frame is now a renderer of its own,
 * src/common/services/document-html/wct.ts, chosen by the design knob
 * `layout: 'wct'` set below (Admin → Manage Templates → Design → Layout). The
 * letterhead's Email / Website are new Organization columns and PayNow UEN
 * lives in bankDetails; all three are set here too.
 *
 * Idempotent: rewrites the three WCT-owned templates' config/styleConfig and
 * the org's address / phone / reg no / docTypeDefaults to the values below.
 * Touches ONLY rows owned by ORG_ID (templates are a cross-org pool: nothing
 * here is isDefault, nothing is activated for any other org).
 */
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';
// Same fixed id as setup-wct-org.ts (not imported: that script runs its main() on load).
const ORG_ID = '5c700000-0000-4000-8000-5c7000000001';
const ORG_NAME = 'WCT';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const APPLY = args.includes('--apply');
loadEnv(ENV);
const log = (label: string, msg: string) => console.log(`  ${label.padEnd(26)} ${msg}`);

// ── Letterhead (Organization columns the renderers print) ─────────────────
// The paper letterhead also prints Email info@wct.com.sg, Website www.wct.com.sg,
// "Company Reg / GST Reg No" and "PayNow UEN 201724603K001" — Organization has
// no columns for email / website / PayNow UEN, so those need the renderer branch.
const ORG_PROFILE = {
  address: '19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099',
  phoneNumber: '6741 1697',
  registrationNumber: '201724603K',
  email: 'info@wct.com.sg',
  website: 'www.wct.com.sg',
};
const PAYNOW_UEN = '201724603K001';

// ── Terms & Conditions, verbatim from the printed quotation (pages 2–3) ──
const QUOTATION_TNC = [
  'All cutting & plastering of ceiling, hacking of provision for inlet/ discharge, roof opening is excluded in this quotation unless stated in above works mentioned.',
  'Goods herein remain the property of WCT (S) Systems Pte Ltd until the full sum of this Project has been received. The buyer irrevocably agrees to allow representative/agent of the seller to enter upon any premises owned or controlled by buyer. WCT (S) Systems Pte Ltd shall not be responsible for a',
  'WCT (S) Systems Pte Ltd will not be liable for any inconvenience, loss, damages, charges or expenses that may arise in the event of inaccessibility of servicing areas.',
  'Whereby WCT (S) Systems Pte Ltd accept such cancellation, WCT (S) Systems Pte Ltd reserves the right to charge the customer with the amount of any losses or expenses directly or indirectly resulting from such cancellation or 50% of the total confirmed quotation, whichever is higher.',
  "Confirmed quotations may be cancelled only by WCT (S) Systems Pte Ltd's written acceptance of such cancellation.",
  'Unless credit facilities have been granted to the customer or unless otherwise specifically provided in writing, the price for the invoice shall be paid by the customer in Cash on Delivery (COD) and in default WCT (S) Systems Pte Ltd shall be entitled to withhold delivery until payment is received',
  'Confirmed quotations will indicate that buyer has agreed to the payment terms given, which will be in accordance with the terms and conditions of invoice.',
  'This quotation is valid for 15 days from the date of provision.',
  'This quotation must be accepted before works will be scheduled.',
  'WCT (S) Systems Pte Ltd reserves the right to revise or withdraw this quotation at any time prior to the quotation being formally accepted.',
  'New MV System built up shall come with proposed-drawing of MV system (layout of unit/ location provided by main con/ owner in autocad format) & as-built drawing of MV system at site after the completion.',
  'If the deposit is not received by WCT (S) Systems Pte Ltd within three (3) months or otherwise stated, an administrative charge of 20% of the Project Value will be charged to the customer.',
  'Prices quoted are subjected to GST.',
  'Any design changes or other scope of work which are not indicated above shall be considered as variable order. Separate charges may apply for variable orders.',
  'Warranty for parts will be voided if the system is found to be changed, replaced, altered not in accordance to the as-built MV design by WCT (S) Systems Pte Ltd.',
  'Warranty of all products will be 12 months against manufacturing defects & workmanship.',
  'Customers shall check and verify the specifications details given by WCT (S) Systems Pte Ltd for confirmed parts such as "VSD Inverter"/"Electric Motor"/ "MV Fan"/ "Electrostatic Air Cleaner"/ "Carbon Bank"/UV Light".',
  'Service reports with Before & After photos given to customers will exclude third party testing/certification: MV Calculation/Odour/Electrical/Layout drawing plan of existing MV system, etc.',
].map((l) => `- ${l}`).join('\n');

// The invoice prints the same list plus the payment instruction and thanks.
const INVOICE_TNC =
  QUOTATION_TNC +
  '\n\nKindly make the cheque payable to " WCT (S) SYSTEMS PTE LTD " and mail to 19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099.' +
  '\n\nThank You for Your Patronage . We look forward to serving you again!';

// Keyed by BOTH the canonical type and the template variant: the editor looks
// up docTypeDefaults[templateVariant] for notes/tnc and falls back to the
// canonical type only for footerMessage (TabbedDocumentCreator ~L1133).
const DOC_DEFAULTS: Record<string, { tnc: string; notes: string; footerMessage: string }> = {
  QUOTATION: { tnc: QUOTATION_TNC, notes: '', footerMessage: 'This is computer generated, no signature is required' },
  QO1: { tnc: QUOTATION_TNC, notes: '', footerMessage: 'This is computer generated, no signature is required' },
  INVOICE: { tnc: INVOICE_TNC, notes: '', footerMessage: 'Computer generated document, no signature is required.' },
  TI2: { tnc: INVOICE_TNC, notes: '', footerMessage: 'Computer generated document, no signature is required.' },
};

// ── Editor fields (config.formFields) — what the office types in ───────────
// The WCT layout prints Attention / Email / Phone under Bill To, the boxed
// Job Location and Subject rows, and the Sales Person / Contact sign-off. The
// stock field sets have none of Email / Phone / Job Location / Sales Contact,
// so each template carries its own General tab.
const f = (fieldName: string, displayLabel: string, fieldType: string = 'text', extra: Record<string, unknown> = {}) => ({
  fieldName,
  displayLabel,
  fieldType,
  required: false,
  ...extra,
});
// gridSize 6 = half width (two per line); the editor pairs consecutive halves.
const half = (fieldName: string, displayLabel: string, fieldType = 'text', extra: Record<string, unknown> = {}) =>
  f(fieldName, displayLabel, fieldType, { gridSize: 6, ...extra });
// Money / summary fields. DynamicFormFields routes any field whose name contains
// rate / gross / disc / subTotal / gst / nett / taxApplicable / absorbTax into
// the RIGHT (summary) column (the Rate / Gross / Disc / Sub-total / Tax / GST /
// Nett rows, like Biofuel's non-formFields layout). Keeping them in the SAME
// tab as the header fields is what fills the right side and lets everything sit
// in one tab (guru 2026-10-27: "fit all the needed fields in one tab, like the
// Biofuel editor's right section").
const SUMMARY_FIELDS = [
  f('documentInfo.rate', 'Rate', 'number'),
  f('documentInfo.currency', 'Currency', 'select', { options: [{ value: 'SGD', label: 'SGD' }, { value: 'USD', label: 'USD' }, { value: 'MYR', label: 'MYR' }], defaultValue: 'SGD' }),
  f('documentInfo.grossTotal', 'Gross Total', 'number'),
  f('documentInfo.discountAmount', 'Disc', 'number'),
  f('documentInfo.subTotal', 'Sub-total', 'number'),
  f('documentInfo.taxApplicable', 'Tax', 'select', { options: [{ value: 'Y', label: 'Yes' }, { value: 'N', label: 'No' }], defaultValue: 'Y' }),
  f('documentInfo.absorbTax', 'Tax Inclusive', 'select', { options: [{ value: 'N', label: 'No' }, { value: 'Y', label: 'Yes' }], defaultValue: 'N' }),
  f('documentInfo.gstPercent', 'GST', 'number', { defaultValue: 9 }),
  f('documentInfo.gstAmount', 'GST Amount', 'number'),
  f('documentInfo.nettTotal', 'Nett Total', 'number'),
];
// ONE tab per document (guru 2026-10-27). Only the fields that are actually on
// WCT's papers, plus Reference. Short fields are half-width so they pack two
// per line (Biofuel-style, no scroll); Customer and the address textareas take
// a full row, and Attention is the editor's packed Contact Person / No / Email
// trio (documentInfo.contact). Validity dropped (it is a T&C line, not a
// field). The money summary lands in the right column.
const formFieldsFor = (type: 'QUOTATION' | 'INVOICE' | 'DELIVERY_ORDER') => {
  const numberLabel = type === 'QUOTATION' ? 'Quotation No.' : type === 'INVOICE' ? 'Invoice No.' : 'Delivery Order No.';
  const left: any[] = [
    half('documentInfo.documentNumber', numberLabel, 'text', { required: true }),
    half('documentInfo.date', 'Date', 'date', { required: true }),
    half('documentInfo.referenceNo', 'Reference'),
  ];
  // Invoice Rev is NOT a typed field: the WCT renderer prints R<n> from the
  // document's own revision (⋮ → Create Revision), so no box here (guru 2026-10-27).
  if (type === 'DELIVERY_ORDER') left.push(half('documentInfo.quotationNo', 'Quotation Number'));
  left.push(f('customer', 'Customer', 'customer', { required: true, dataSource: 'customers' }));
  left.push(f('billTo', type === 'DELIVERY_ORDER' ? 'Sold To (address)' : 'Bill To (address)', 'textarea'));
  if (type === 'DELIVERY_ORDER') left.push(f('deliveryTo', 'Ship To (address)', 'textarea'));
  left.push(f('documentInfo.contact', 'Attention')); // packed Contact Person / No. / Email row
  if (type !== 'DELIVERY_ORDER') {
    // Job Location is a dropdown of the customer's SAVED sites (SiteOffice rows)
    // with "+ Add location" (guru 2026-10-27); the chosen site's text is stored
    // in documentInfo.location and printed in the "Job Location:" box.
    left.push(half('documentInfo.location', 'Job Location', 'siteLocation'), half('documentInfo.subject', 'Subject'));
  }
  if (type === 'QUOTATION') {
    // Reuse the org's salesman picker (shows the salesman's name) rather than a
    // free-text box; Contact is the salesperson's own phone from the sign-off.
    left.push(
      half('documentInfo.salesPerson', 'Sales Person', 'salesman', { dataSource: 'salesmen' }),
      half('documentInfo.salesContact', 'Contact'),
    );
  }
  // Explicit order so the editor lays them out exactly like this, grouped
  // sensibly: document info, then Customer → Bill To → Attention together,
  // then the job details, then the sign-off.
  const ordered = left.map((fld, i) => ({ ...fld, displayOrder: i }));
  // The delivery order is a goods document with no prices — no money summary.
  const right = type === 'DELIVERY_ORDER' ? [] : SUMMARY_FIELDS;
  return { tabs: [{ tabId: 'general', tabLabel: 'General', fields: [...ordered, ...right] }] };
};

// ── Templates (WCT-owned rows seeded by setup-wct-org.ts) ─────────────────
const TEMPLATES: Array<{
  type: string;
  templateVariant: string;
  name: string;
  config: Record<string, unknown>;
  styleConfig: Record<string, unknown> | null;
}> = [
  {
    type: 'QUOTATION',
    templateVariant: 'QO1',
    name: 'WCT Quotation',
    // S/No · Description · Qty · Unit Price · Amount.
    config: {
      tableColumnOrder: ['no', 'description', 'quantity', 'unitPrice', 'amount'],
      columnLabels: { no: 'S/No', description: 'Description', quantity: 'Qty', unitPrice: 'Unit Price', amount: 'Amount' },
      formFields: formFieldsFor('QUOTATION'),
    },
    styleConfig: {
      layout: 'wct',
      logoPosition: 'left',
      headerAlign: 'left',
      titleText: 'QUOTATION',
      showDueDate: false,
      showBankDetails: false,
      showAmountInWords: false,
      showGeneratedNote: true,
      tableHeaderFill: false,
      footerText: '',
    },
  },
  {
    type: 'INVOICE',
    // TI2 = the TAX INVOICE layout both renderers share (TI is an older
    // portal-only layout the server does not port).
    templateVariant: 'TI2',
    name: 'WCT Tax Invoice',
    config: {
      tableColumnOrder: ['no', 'description', 'quantity', 'unitPrice', 'amount'],
      columnLabels: { no: 'S/No', description: 'Description', quantity: 'Qty', unitPrice: 'Unit Price', amount: 'Amount' },
      formFields: formFieldsFor('INVOICE'),
    },
    styleConfig: {
      layout: 'wct',
      logoPosition: 'left',
      headerAlign: 'left',
      titleText: 'TAX INVOICE',
      showDueDate: false,
      showBankDetails: false, // the cheque instruction sits inside the T&Cs on paper
      showAmountInWords: false,
      showGeneratedNote: true,
      tableHeaderFill: false,
      footerText: '',
    },
  },
  {
    type: 'DELIVERY_ORDER',
    templateVariant: 'DO',
    name: 'WCT Delivery Order',
    // S/No · DESCRIPTION · QTY · REMARK — a goods document, no prices.
    config: {
      tableColumnOrder: ['no', 'description', 'quantity', 'remarks'],
      columnLabels: { no: 'S/No', description: 'DESCRIPTION', quantity: 'QTY', remarks: 'REMARK' },
      formFields: formFieldsFor('DELIVERY_ORDER'),
    },
    styleConfig: { layout: 'wct', logoPosition: 'left', titleText: 'DELIVERY ORDER' },
  },
];

const { plat, disconnect } = clientsFor(ENV, 'org_wct');

async function main() {
  console.log(`env=${ENV}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}  org=${ORG_NAME} ${ORG_ID}\n`);
  const org = await plat.organization.findUnique({ where: { id: ORG_ID }, select: { id: true, name: true, address: true, docTypeDefaults: true, bankDetails: true } });
  if (!org) throw new Error(`${ORG_NAME} not found — run setup-wct-org.ts first`);

  // 1. Letterhead + per-type defaults on the org
  const defaults = { ...((org.docTypeDefaults as any) || {}), ...DOC_DEFAULTS };
  const bankDetails = { ...((org.bankDetails as any) || {}), paynowUen: PAYNOW_UEN };
  log('Organization', `address / phone / reg no / email / website → "${ORG_PROFILE.address}" · ${ORG_PROFILE.phoneNumber} · ${ORG_PROFILE.registrationNumber} · ${ORG_PROFILE.email} · ${ORG_PROFILE.website}; bankDetails.paynowUen ${PAYNOW_UEN}`);
  log('docTypeDefaults', `${Object.keys(DOC_DEFAULTS).join(', ')} (T&Cs ${QUOTATION_TNC.split('\n').length} lines; invoice + cheque line)`);
  if (APPLY) {
    await plat.organization.update({ where: { id: ORG_ID }, data: { ...ORG_PROFILE, docTypeDefaults: defaults, bankDetails } });
  }

  // 1b. Editor flags: drop the Project picker row (guru 2026-10-27 — WCT does
  // not link quotations to projects in the editor).
  const ui = await plat.organizationUIConfig.findUnique({ where: { organizationId: ORG_ID } });
  const features = { ...((ui?.features as any) || {}), enableQuotationProjectLink: false };
  log('UIConfig', 'enableQuotationProjectLink → false (removes the Project row)');
  if (APPLY && ui) {
    await plat.organizationUIConfig.update({ where: { organizationId: ORG_ID }, data: { features } });
  }

  // 2. Templates — only rows WCT owns
  for (const t of TEMPLATES) {
    const row = await plat.documentTemplate.findFirst({ where: { organizationId: ORG_ID, type: t.type }, select: { id: true, name: true, templateVariant: true } });
    if (!row) {
      log(`Template ${t.type}`, 'MISSING — run setup-wct-org.ts first');
      continue;
    }
    log(`Template ${t.type}`, `${row.id} "${row.name}" ${row.templateVariant} → "${t.name}" ${t.templateVariant}; columns ${(t.config.tableColumnOrder as string[]).join('·')}; knobs ${t.styleConfig ? JSON.stringify(t.styleConfig) : 'none'}`);
    if (APPLY) {
      await plat.documentTemplate.update({
        where: { id: row.id },
        data: { name: t.name, templateVariant: t.templateVariant, config: t.config, styleConfig: t.styleConfig ?? undefined, isActive: true },
      });
    }
  }
  // Nothing else: no isDefault, no OrganizationActiveTemplate rows for other orgs.
}

main()
  .then(() => console.log(`\n${APPLY ? 'DONE' : 'DRY RUN DONE'}${APPLY ? '' : ' — re-run with --apply to write.'}`))
  .catch((e) => {
    console.error('❌', e?.message || e);
    process.exit(1);
  })
  .finally(() => disconnect());
