#!/usr/bin/env node
/**
 * WCT group DOs and invoices (2026-11-23, Elroy: "Link text must never show in either box; links live only in Link
 * Document pills"). The editor's left box is now Customer Remarks (config.remarks, printed) and the right box Internal
 * remarks (config.internalRemarks, never printed); the old Reference text box is gone. Existing data:
 *
 *  A. config.referenceNo / documentInfo.referenceNo holding link text ("ORD... · QO...", "ORD... · DO1, DO2") is
 *     cleared (the link itself lives on the order; the DO PDF used to print it as the Quotation Number fallback).
 *  B. config.remarks that IS link text (the old right box showed the Reference, so a save wrote it there) is cleared:
 *     it printed on the PDF as "Remarks: ORD... · QO...".
 *  C. config.remarks that STARTS with link text followed by the person's own words: the link text is cut off, the
 *     words stay.
 *  D. config.referenceNo with real text (not link text, not the Subject, not the remarks) and no Internal remarks yet:
 *     copied into Internal remarks so it still shows (referenceNo itself is kept).
 *
 *   node scripts/wct-doc-remarks-cleanup.js --env prod            (dry run: counts + samples, writes nothing)
 *   node scripts/wct-doc-remarks-cleanup.js --env prod --apply    (only after the owner's APPLY; steps A, B, C)
 *   ... --apply --steps ABCD                                         (D too, only if the owner asks for it)
 * Re-runnable: each step only picks rows that still need it. Voided / cancelled documents are included (text only).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const env = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'dev';
const apply = args.includes('--apply');
// Steps to apply (default A, B, C). D (copy real Reference text into Internal remarks) only when named: at WCT it is
// mostly the old ERP's cross-reference numbers (I-015239, Q26-090), close to link text.
const steps = (args.includes('--steps') ? args[args.indexOf('--steps') + 1] : 'ABC').toUpperCase();
const PARENT = '5c700000-0000-4000-8000-5c7000000001';
const TYPES = ['DELIVERY_ORDER', 'DO', 'INVOICE', 'TAX_INVOICE', 'INV'];

// Same pattern as orders/order-billing.ts isLinkText: an order number, then document numbers.
const LINK = '^ORD[A-Z0-9-]*[0-9]( · [A-Za-z0-9()-]+(, *[A-Za-z0-9()-]+)*)?$';
const LINK_PREFIX = '^ORD[A-Z0-9-]*[0-9]( · [A-Za-z0-9()-]+(, *[A-Za-z0-9()-]+)*)?';

function dbUrl() {
  const key = env === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
  if (process.env[key]) return process.env[key];
  const line = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not set`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

const T = (x) => `NULLIF(btrim(COALESCE(${x}, '')), '')`;
const REF = T(`d.config->>'referenceNo'`);
const DIREF = T(`d.config->'documentInfo'->>'referenceNo'`);
const REM = T(`d.config->>'remarks'`);
const SUBJ = T(`COALESCE(NULLIF(d.config->>'subject', ''), d.config->'documentInfo'->>'subject')`);
const INTERNAL = T(`d.config->>'internalRemarks'`);

const STEPS = {
  A: {
    label: 'Reference holds link text: cleared',
    where: `(${REF} ~ '${LINK}' OR ${DIREF} ~ '${LINK}')`,
    show: `left(COALESCE(${REF}, ${DIREF}), 45)`,
    set: `d.config
            || CASE WHEN ${REF} ~ '${LINK}' THEN jsonb_build_object('referenceNo', '') ELSE '{}'::jsonb END
            || CASE WHEN ${DIREF} ~ '${LINK}' THEN jsonb_build_object('documentInfo', (d.config->'documentInfo') || jsonb_build_object('referenceNo', '')) ELSE '{}'::jsonb END`,
  },
  B: {
    label: 'Remarks are only link text: cleared',
    where: `${REM} ~ '${LINK}'`,
    show: `left(${REM}, 45)`,
    set: `d.config || jsonb_build_object('remarks', '')`,
  },
  C: {
    label: 'Remarks start with link text, then own words: link text cut off',
    where: `${REM} !~ '${LINK}' AND ${REM} ~ '${LINK_PREFIX}[[:space:],;:-]+[^[:space:]]'`,
    show: `left(${REM}, 60)`,
    set: `d.config || jsonb_build_object('remarks', btrim(regexp_replace(${REM}, '${LINK_PREFIX}[[:space:],;:-]+', '')))`,
  },
  D: {
    label: 'Reference has real text the editor no longer shows: copied into Internal remarks',
    where: `${REF} IS NOT NULL AND ${REF} !~ '${LINK}' AND ${REF} IS DISTINCT FROM ${SUBJ} AND ${REF} IS DISTINCT FROM ${REM} AND ${INTERNAL} IS NULL`,
    show: `left(${REF}, 45)`,
    set: `d.config || jsonb_build_object('internalRemarks', ${REF})`,
  },
};

(async () => {
  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  await c.query(apply ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    const orgs = (await c.query(`SELECT id FROM "Organization" WHERE id = $1 OR "parentOrgId" = $1`, [PARENT])).rows.map((r) => r.id);
    const base = `FROM "Document" d JOIN "Organization" o ON o.id = d."organizationId" WHERE d."organizationId" = ANY($1::text[]) AND d.type = ANY($2::text[])`;
    console.log(`${apply ? 'APPLY' : 'DRY RUN'} (${env}): WCT group DOs and invoices`);
    for (const [k, s] of Object.entries(STEPS)) {
      const counts = (await c.query(`SELECT o.name AS org, d.type, (d.config ? 'erpImport') AS erp, count(*)::int AS n ${base} AND ${s.where} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [orgs, TYPES])).rows;
      const total = counts.reduce((t, r) => t + r.n, 0);
      console.log(`\n${k}. ${s.label}: ${total}${steps.includes(k) ? '' : ' (not applied unless --steps names it)'}`);
      if (counts.length) console.table(counts.map((r) => ({ org: r.org.slice(0, 22), type: r.type, source: r.erp ? 'ERP import' : 'AIMS', n: r.n })));
      const samples = (await c.query(`SELECT o.name AS org, d.name, d.status, ${s.show} AS now, left(${SUBJ}, 30) AS subject ${base} AND ${s.where} ORDER BY d."createdAt" DESC LIMIT 6`, [orgs, TYPES])).rows;
      if (samples.length) console.table(samples.map((r) => ({ org: r.org.slice(0, 14), doc: r.name, status: r.status, value: r.now, subject: r.subject })));
      if (apply && total && steps.includes(k)) {
        const u = await c.query(`UPDATE "Document" d SET config = ${s.set}, "updatedAt" = now() WHERE d."organizationId" = ANY($1::text[]) AND d.type = ANY($2::text[]) AND ${s.where}`, [orgs, TYPES]);
        console.log(`   applied: ${u.rowCount}`);
      }
    }
    await c.query(apply ? 'COMMIT' : 'ROLLBACK');
    if (!apply) console.log('\nNothing written. Run again with --apply after the APPLY.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
