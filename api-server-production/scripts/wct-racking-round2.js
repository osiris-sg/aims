/**
 * WCT Racking round 2 (2026-11-18). Dry run by default; --apply runs ONE transaction (after the S3 upload).
 *
 *   DBURL=<url> node scripts/wct-racking-round2.js --logo <transparent.png>                         # dry run
 *   DBURL=<url> node scripts/wct-racking-round2.js --logo <transparent.png> --apply [--confirm-prod]
 *   DBURL=<url> node scripts/wct-racking-round2.js --rollback [--apply ...]   # DB values back from the log (S3 object kept)
 *
 * Changes (each only when it differs; "before" values logged for rollback):
 *  1. Racking logo: the transparent PNG uploaded to S3 as logos/wct-racking-logo.png (a NEW key: WCT (S) keeps
 *     logos/wct-logo.png), and Organization.logo of WCT Racking pointed at it. The org logo prints in the
 *     letterhead of Racking's quotations, invoices and DOs, and shows wherever the app shows the org logo.
 *  2. features.enableRackingWatermark = true (WCT Racking): the logo, pale, behind Racking quotations.
 *  3. Racking's invoice template (its own): title "TAX INVOICE" -> "INVOICE".
 *  4. Racking docTypeDefaults INVOICE + TI2: T&Cs = the quotation footer's PAYMENT METHOD + TERMS & CONDITIONS
 *     (no payment terms, no GST line), Notes empty. NEW invoices only.
 *  5. features.snoSkipTitlesSince = this run's time for WCT (S), BC Air, WCT Racking (only where absent):
 *     section titles take no S/No on WCT-layout documents created from now on; older ones print as before.
 * One "System creation" ActionLog row per change; scripts/wct-racking-round2.log.json.
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const { Client } = require('pg');
const fs = require('fs');
const crypto = require('crypto');

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const RK = '5c700000-0000-4000-8000-5c7000000002';
const BCAIR = '5c700000-0000-4000-8000-5c7000000004';
const INVOICE_TEMPLATE = '950bd41d-5bca-4c7d-95a1-a3a37be9103f'; // "WCT Racking Tax Invoice", owned by Racking
const LOGO_KEY = 'logos/wct-racking-logo.png';
const LOG = __dirname + '/wct-racking-round2.log.json';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes('--apply');
const ROLLBACK = process.argv.includes('--rollback');

const INVOICE_TERMS = `PAYMENT METHOD:
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

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL.replace(/["\r]/g, '')).host.replace('-pooler', '') : '';
  const isProd = new URL(url).host.replace('-pooler', '') === prodHost;
  if (APPLY && isProd && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const logoPath = arg('--logo');
  if (!ROLLBACK && !logoPath) throw new Error('--logo <transparent png> is required');
  const logo = logoPath ? fs.readFileSync(logoPath) : null;
  if (logo && logo.slice(1, 4).toString() !== 'PNG') throw new Error('--logo is not a PNG');

  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  const orgs = await q(`select o.id, o.name, o.logo, o."docTypeDefaults", u.id ui, u.features from "Organization" o join "OrganizationUIConfig" u on u."organizationId"=o.id where o.id = any($1)`, [[WCT, RK, BCAIR]]);
  const byId = Object.fromEntries(orgs.map((o) => [o.id, o]));
  if (!byId[RK] || byId[RK].name !== 'WCT Racking Pte Ltd' || !byId[WCT] || !byId[BCAIR]) throw new Error('WCT group orgs not found');
  const tpl = (await q(`select id, name, "organizationId", "styleConfig" from "DocumentTemplate" where id=$1`, [INVOICE_TEMPLATE]))[0];
  if (!tpl || tpl.organizationId !== RK) throw new Error('Racking invoice template missing');
  const shared = await q(`select count(*)::int n from "OrganizationActiveTemplate" where "templateId"=$1 and "organizationId"<>$2`, [INVOICE_TEMPLATE, RK]);
  if (shared[0].n) throw new Error('the Racking invoice template is activated by another org');

  const rk = byId[RK];
  const before = {
    rackingLogo: rk.logo,
    enableRackingWatermark: (rk.features || {}).enableRackingWatermark,
    invoiceTitle: (tpl.styleConfig || {}).titleText,
    docTypeDefaults: rk.docTypeDefaults,
    snoSkipTitlesSince: Object.fromEntries([WCT, BCAIR, RK].map((id) => [id, (byId[id].features || {}).snoSkipTitlesSince])),
  };
  let target;
  if (ROLLBACK) target = JSON.parse(fs.readFileSync(LOG, 'utf8')).before;
  else {
    const now = new Date().toISOString();
    const dtd = JSON.parse(JSON.stringify(rk.docTypeDefaults || {}));
    for (const k of ['INVOICE', 'TI2']) dtd[k] = { ...(dtd[k] || {}), tnc: INVOICE_TERMS, notes: '' };
    target = {
      rackingLogo: LOGO_KEY,
      enableRackingWatermark: true,
      invoiceTitle: 'INVOICE',
      docTypeDefaults: dtd,
      snoSkipTitlesSince: Object.fromEntries(Object.entries(before.snoSkipTitlesSince).map(([id, v]) => [id, v || now])),
    };
  }
  const changes = Object.keys(target).filter((k) => !same(before[k], target[k]));

  console.log(`${ROLLBACK ? 'ROLLBACK' : 'CHANGES'} (${isProd ? 'PROD' : 'non-prod'}):`);
  if (changes.includes('rackingLogo')) {
    console.log(`  1. WCT Racking Organization.logo: ${before.rackingLogo} -> ${target.rackingLogo}`);
    if (logo) console.log(`     S3 upload ${LOGO_KEY} (${logo.length} bytes, sha256 ${crypto.createHash('sha256').update(logo).digest('hex').slice(0, 16)}); WCT (S) logo: ${byId[WCT].logo} (unchanged)`);
  }
  if (changes.includes('enableRackingWatermark')) console.log(`  2. WCT Racking features.enableRackingWatermark: ${JSON.stringify(before.enableRackingWatermark)} -> ${JSON.stringify(target.enableRackingWatermark)}`);
  if (changes.includes('invoiceTitle')) console.log(`  3. template "${tpl.name}" title: ${JSON.stringify(before.invoiceTitle)} -> ${JSON.stringify(target.invoiceTitle)}`);
  if (changes.includes('docTypeDefaults'))
    for (const k of ['INVOICE', 'TI2']) {
      const a = (before.docTypeDefaults || {})[k] || {};
      const b = (target.docTypeDefaults || {})[k] || {};
      for (const f of ['tnc', 'notes', 'footerMessage']) if (!same(a[f], b[f])) console.log(`  4. WCT Racking docTypeDefaults.${k}.${f}: ${JSON.stringify(String(a[f] ?? '').slice(0, 60))}… -> ${JSON.stringify(String(b[f] ?? '').slice(0, 60))}…`);
    }
  if (changes.includes('snoSkipTitlesSince'))
    for (const id of [WCT, BCAIR, RK]) if (!same(before.snoSkipTitlesSince[id], target.snoSkipTitlesSince[id])) console.log(`  5. ${byId[id].name} features.snoSkipTitlesSince: ${JSON.stringify(before.snoSkipTitlesSince[id])} -> ${JSON.stringify(target.snoSkipTitlesSince[id])}`);
  const others = await q(`select count(*)::int n from "OrganizationUIConfig" where "organizationId" <> all($1) and (features ? 'snoSkipTitlesSince' or features ? 'enableRackingWatermark')`, [[WCT, RK, BCAIR]]);
  console.log(`other orgs carrying these settings: ${others[0].n}`);
  if (!changes.length) { console.log('nothing to do'); await c.end(); return; }
  if (!APPLY) { console.log('DRY RUN: no write (no S3 upload). Re-run with --apply --confirm-prod.'); await c.end(); return; }

  // S3 first (a new key; nothing points at it until the transaction below commits).
  if (!ROLLBACK && changes.includes('rackingLogo')) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } });
    await s3.send(new PutObjectCommand({ Bucket: process.env.RESOURCE_BUCKET || 'aims-osiris', Key: LOGO_KEY, Body: logo, ContentType: 'image/png' }));
    console.log(`uploaded ${LOGO_KEY}`);
  }
  await c.query('begin');
  const logRow = (orgId, resource, note) =>
    c.query(
      `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-racking-round2', 'System creation', $1, 'operator', 'UPDATE', $2, $3, 'SUCCESS')`,
      [orgId, resource, JSON.stringify({ note })],
    );
  const setFeature = async (orgId, key, v) => {
    const ui = byId[orgId].ui;
    if (v === undefined || v === null) await c.query(`update "OrganizationUIConfig" set features = features - $2::text where id=$1`, [ui, key]);
    else await c.query(`update "OrganizationUIConfig" set features = coalesce(features,'{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb) where id=$1`, [ui, key, JSON.stringify(v)]);
  };
  if (changes.includes('rackingLogo')) {
    await c.query(`update "Organization" set logo=$2 where id=$1`, [RK, target.rackingLogo]);
    await logRow(RK, 'organization', `logo: ${before.rackingLogo} -> ${target.rackingLogo} (Racking logo, transparent PNG)`);
  }
  if (changes.includes('enableRackingWatermark')) {
    await setFeature(RK, 'enableRackingWatermark', target.enableRackingWatermark);
    await logRow(RK, 'organization-features', `enableRackingWatermark: ${JSON.stringify(before.enableRackingWatermark)} -> ${JSON.stringify(target.enableRackingWatermark)}`);
  }
  if (changes.includes('invoiceTitle')) {
    await c.query(`update "DocumentTemplate" set "styleConfig" = coalesce("styleConfig",'{}'::jsonb) || jsonb_build_object('titleText', $2::text) where id=$1`, [INVOICE_TEMPLATE, target.invoiceTitle || '']);
    await logRow(RK, 'document-template', `"${tpl.name}" title: ${JSON.stringify(before.invoiceTitle)} -> ${JSON.stringify(target.invoiceTitle)}`);
  }
  if (changes.includes('docTypeDefaults')) {
    await c.query(`update "Organization" set "docTypeDefaults"=$2::jsonb where id=$1`, [RK, JSON.stringify(target.docTypeDefaults)]);
    await logRow(RK, 'organization', 'docTypeDefaults INVOICE/TI2: PAYMENT METHOD + TERMS & CONDITIONS as the T&Cs, Notes empty (new invoices only)');
  }
  if (changes.includes('snoSkipTitlesSince'))
    for (const id of [WCT, BCAIR, RK])
      if (!same(before.snoSkipTitlesSince[id], target.snoSkipTitlesSince[id])) {
        await setFeature(id, 'snoSkipTitlesSince', target.snoSkipTitlesSince[id]);
        await logRow(id, 'organization-features', `snoSkipTitlesSince: ${JSON.stringify(before.snoSkipTitlesSince[id])} -> ${JSON.stringify(target.snoSkipTitlesSince[id])} (section titles take no S/No on documents created from then on)`);
      }
  await c.query('commit');
  if (!ROLLBACK) fs.writeFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), before, after: target }, null, 2));
  console.log(`APPLIED: ${changes.join(', ')}`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
