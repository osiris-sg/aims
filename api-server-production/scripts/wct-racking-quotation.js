/**
 * WCT Racking quotation settings (2026-11-18). WCT Racking Pte Ltd ONLY; dry run by default.
 *
 *   DBURL=<url> node scripts/wct-racking-quotation.js                          # dry run (read only)
 *   DBURL=<url> node scripts/wct-racking-quotation.js --apply [--confirm-prod]  # one transaction
 *   DBURL=<url> node scripts/wct-racking-quotation.js --rollback [--apply ...]  # back to the logged "before" values
 *
 * Changes (each only when it differs; every value before is logged for rollback):
 *  1. features.enableRackingLayout = true: the Racking look on the WCT layout (wct.ts design.racking).
 *  2. Organization.taxApplicable true -> false: NEW documents start with Tax "No" (Racking is not GST
 *     registered). Existing documents keep their own setting.
 *  3. docTypeDefaults QUOTATION + QO1: the new footer (PAYMENT TERMS / PAYMENT METHOD / TERMS & CONDITIONS)
 *     as the T&Cs, Notes empty, footer message empty. NEW quotations only; existing ones keep their text.
 *  4. The Racking quotation template (its own, not shared): editor fields Goodwill Discount (+ its %/$
 *     choice, so a $ discount reloads as $), Signed by, Title (default "Manager").
 * Writes one "System creation" ActionLog row per change and scripts/wct-racking-quotation.log.json.
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');

const RK = '5c700000-0000-4000-8000-5c7000000002';
const TEMPLATE = '47ad92a8-ff3b-480b-96af-da5619a5af38'; // "WCT Racking Quotation", owned by Racking
const LOG = __dirname + '/wct-racking-quotation.log.json';
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');

const FOOTER = `PAYMENT TERMS:
First Payment - 50% Upon confirmation
Final Payment - 50% Upon completion of all installation works

PAYMENT METHOD:
• Cheque Method: WCT Racking Pte Ltd
• Pay Now Method: 202100255Z001
• Giro / Transfer Method: OCBC Current Account No: 604-565-648-001

TERMS & CONDITIONS:
• All goods remain the property of WCT Racking Pte Ltd for as long as any account due is left unpaid & shall be released to WCT Racking Pte Ltd when on demand.
• Terms & Conditions may change without prior notice to customer
• Goods herein remain the property of WCT Racking Pte Ltd until the full sum of this Project has been received. The buyer irrevocably agrees to allow representative/agent of the seller to enter upon any premises owned or controlled by the buyer. The Company shall not be responsible for any loss or damage to assets, items or valuable found in or connected to the goods. And in such an event that the goods are deliberately withheld by the client, the Company shall have recourse to the recovery of the racks under law and the Client shall indemnify the Company for all costs involved in the said recovery and any damages or compensation connected to the recourse.
• Kindly make the cheque payable to " WCT Racking Pte Ltd ".
• Please indicate the invoice number when making payment.
• Please note that any overdue payment/s will be listed in DP Credit Bureau's records and this record may be accessed by financial institutions and other approving credit companies.
• If the deposit has failed to be received by the Company within three (3) months or otherwise stated, an administrative charge of 20% of the Project Value will be charged to the Client.
• All products are under general warranty for twelve (12) months from the date of taking over by client. Warranty covers manufacturing defects, except wear & tear, misuse, or faults due to poor maintenance.
• The client is liable for all relevant submission to the government authorities (BCA, SCDF, URA, JTC, etc) if required.
• WCT Racking Pte Ltd shall not be liable for any indirect, incidental, or consequential damages, including loss of data, profits, or business opportunities.`;

const NEW_FIELDS = {
  afterGross: [
    { required: false, fieldName: 'documentInfo.discountPercent', fieldType: 'number', displayLabel: 'Goodwill Discount' },
    {
      required: false, fieldName: 'documentInfo.discountType', fieldType: 'select', defaultValue: 'percent', displayLabel: 'Goodwill Discount type',
      options: [{ label: '%', value: 'percent' }, { label: '$', value: 'amount' }],
    },
  ],
  afterContact: [
    { gridSize: 6, required: false, fieldName: 'documentInfo.signedBy', fieldType: 'text', displayLabel: 'Signed by', displayOrder: 10 },
    { gridSize: 6, required: false, fieldName: 'documentInfo.signedByTitle', fieldType: 'text', defaultValue: 'Manager', displayLabel: 'Title', displayOrder: 11 },
  ],
};

/** The template's formFields with the new fields added (missing ones only), or the same object. */
function withNewFields(formFields) {
  const ff = JSON.parse(JSON.stringify(formFields || {}));
  const tab = (ff.tabs || []).find((t) => t.tabId === 'general');
  if (!tab) throw new Error('template has no general tab');
  const has = (n) => tab.fields.some((f) => f.fieldName === n);
  const insertAfter = (anchor, list) => {
    const add = list.filter((f) => !has(f.fieldName));
    if (!add.length) return;
    const i = tab.fields.findIndex((f) => f.fieldName === anchor);
    tab.fields.splice(i >= 0 ? i + 1 : tab.fields.length, 0, ...add);
  };
  insertAfter('documentInfo.grossTotal', NEW_FIELDS.afterGross);
  insertAfter('documentInfo.salesContact', NEW_FIELDS.afterContact);
  return ff;
}

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL.replace(/["\r]/g, '')).host.replace('-pooler', '') : '';
  const isProd = new URL(url).host.replace('-pooler', '') === prodHost;
  if (APPLY && isProd && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;

  const org = (await q(`select id, name, "taxApplicable", "docTypeDefaults" from "Organization" where id=$1`, [RK]))[0];
  if (!org || org.name !== 'WCT Racking Pte Ltd') throw new Error('WCT Racking org not found');
  const ui = (await q(`select id, features from "OrganizationUIConfig" where "organizationId"=$1`, [RK]))[0];
  const tpl = (await q(`select id, name, "organizationId", config from "DocumentTemplate" where id=$1`, [TEMPLATE]))[0];
  if (!ui || !tpl || tpl.organizationId !== RK) throw new Error('Racking UI config / own quotation template missing');
  const sharedWith = await q(`select o.name from "OrganizationActiveTemplate" a join "Organization" o on o.id=a."organizationId" where a."templateId"=$1 and a."organizationId"<>$2`, [TEMPLATE, RK]);
  if (sharedWith.length) throw new Error(`template is activated by other orgs: ${sharedWith.map((r) => r.name).join(', ')}`);

  const before = {
    enableRackingLayout: (ui.features || {}).enableRackingLayout,
    taxApplicable: org.taxApplicable,
    docTypeDefaults: org.docTypeDefaults,
    templateFormFields: tpl.config && tpl.config.formFields,
  };
  let target;
  if (ROLLBACK) {
    const log = JSON.parse(fs.readFileSync(LOG, 'utf8'));
    target = log.before;
  } else {
    const dtd = JSON.parse(JSON.stringify(org.docTypeDefaults || {}));
    for (const k of ['QUOTATION', 'QO1']) dtd[k] = { ...(dtd[k] || {}), tnc: FOOTER, notes: '', footerMessage: '' };
    target = { enableRackingLayout: true, taxApplicable: false, docTypeDefaults: dtd, templateFormFields: withNewFields(before.templateFormFields) };
  }
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changes = Object.keys(target).filter((k) => !same(before[k], target[k]));

  console.log(`${ROLLBACK ? 'ROLLBACK' : 'CHANGES'} for WCT Racking Pte Ltd (${isProd ? 'PROD' : 'non-prod'}):`);
  if (!same(before.enableRackingLayout, target.enableRackingLayout)) console.log(`  1. features.enableRackingLayout: ${JSON.stringify(before.enableRackingLayout)} -> ${JSON.stringify(target.enableRackingLayout)}`);
  if (!same(before.taxApplicable, target.taxApplicable)) console.log(`  2. Organization.taxApplicable: ${before.taxApplicable} -> ${target.taxApplicable}`);
  if (!same(before.docTypeDefaults, target.docTypeDefaults)) {
    for (const k of ['QUOTATION', 'QO1']) {
      const a = (before.docTypeDefaults || {})[k] || {};
      const b = (target.docTypeDefaults || {})[k] || {};
      for (const f of ['tnc', 'notes', 'footerMessage']) if (!same(a[f], b[f])) console.log(`  3. docTypeDefaults.${k}.${f}: ${JSON.stringify(String(a[f] ?? '').slice(0, 70))}… -> ${JSON.stringify(String(b[f] ?? '').slice(0, 70))}…`);
    }
  }
  if (!same(before.templateFormFields, target.templateFormFields)) {
    const names = (ff) => ((ff && ff.tabs) || []).flatMap((t) => t.fields.map((f) => f.fieldName));
    const a = names(before.templateFormFields);
    const b = names(target.templateFormFields);
    console.log(`  4. template "${tpl.name}" fields added: ${b.filter((n) => !a.includes(n)).join(', ') || '-'}; removed: ${a.filter((n) => !b.includes(n)).join(', ') || '-'}`);
  }
  const otherOrgs = await q(`select count(*)::int n from "OrganizationUIConfig" where "organizationId"<>$1 and features ? 'enableRackingLayout'`, [RK]);
  console.log(`other orgs carrying enableRackingLayout: ${otherOrgs[0].n}`);
  if (!changes.length) { console.log('nothing to do'); await c.end(); return; }
  if (!APPLY) { console.log('DRY RUN: no write. Re-run with --apply --confirm-prod.'); await c.end(); return; }

  await c.query('begin');
  const logRow = async (resource, note) =>
    c.query(
      `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-racking-quotation', 'System creation', $1, 'operator', 'UPDATE', $2, $3, 'SUCCESS')`,
      [RK, resource, JSON.stringify({ note })],
    );
  if (changes.includes('enableRackingLayout')) {
    const v = target.enableRackingLayout;
    if (v === undefined || v === null) await c.query(`update "OrganizationUIConfig" set features = features - 'enableRackingLayout' where id=$1`, [ui.id]);
    else await c.query(`update "OrganizationUIConfig" set features = coalesce(features,'{}'::jsonb) || jsonb_build_object('enableRackingLayout', $2::boolean) where id=$1`, [ui.id, v]);
    await logRow('organization-features', `enableRackingLayout: ${JSON.stringify(before.enableRackingLayout)} -> ${JSON.stringify(v)} (Racking quotation look)`);
  }
  if (changes.includes('taxApplicable')) {
    await c.query(`update "Organization" set "taxApplicable"=$2 where id=$1`, [RK, target.taxApplicable]);
    await logRow('organization', `taxApplicable: ${before.taxApplicable} -> ${target.taxApplicable} (not GST registered; new documents only)`);
  }
  if (changes.includes('docTypeDefaults')) {
    await c.query(`update "Organization" set "docTypeDefaults"=$2::jsonb where id=$1`, [RK, JSON.stringify(target.docTypeDefaults)]);
    await logRow('organization', 'docTypeDefaults QUOTATION/QO1: Racking footer as the T&Cs, Notes and footer message empty (new quotations only)');
  }
  if (changes.includes('templateFormFields')) {
    await c.query(`update "DocumentTemplate" set config = jsonb_set(coalesce(config,'{}'::jsonb), '{formFields}', $2::jsonb) where id=$1`, [TEMPLATE, JSON.stringify(target.templateFormFields)]);
    await logRow('document-template', `"${tpl.name}": Goodwill Discount, Signed by, Title fields`);
  }
  await c.query('commit');
  if (!ROLLBACK) fs.writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), org: RK, template: TEMPLATE, before, after: target }, null, 2));
  console.log(`APPLIED: ${changes.join(', ')}`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
