/**
 * aims_inv_number_guard installer (round 36, WCT group, 2026-11-19): one invoice number per organisation, enforced in
 * the database for the orgs with order invoicing on (enableWctOrderInvoice / enableImportedOrders). The SQL lives in
 * src/document-numbering/invoice-number-guard.ts (shared with the specs); see there for what it does and why it is a
 * trigger (not a @@unique: prisma db push would stop Render's build on any org holding a duplicate, and it would apply
 * to every org). Plain SQL like aims_je_guard / aims_doc_list_keys, so `prisma db push` leaves it alone.
 *
 * DRY RUN by default (read-only: a read-only session, no locks): the target and layout, the trigger's current state,
 * the orgs it would check, every org's duplicate INVOICE numbers (counts; a few numbers for the checked orgs) and the
 * SQL it would run. Existing duplicates are never touched (the guard only refuses NEW ones).
 *
 *   npx ts-node --transpile-only scripts/invoice-number-guard.ts                                dry run, dev (.env DATABASE_URL)
 *   npx ts-node --transpile-only scripts/invoice-number-guard.ts --apply                        install on dev
 *   npx ts-node --transpile-only scripts/invoice-number-guard.ts --prod                         dry run, prod (PROD_DATABASE_URL)
 *   npx ts-node --transpile-only scripts/invoice-number-guard.ts --prod --apply --confirm-prod  install on prod
 *   … --rollback [--apply] [--prod --confirm-prod]                                              drop the trigger + function
 * Layout aware: the shared `public` schema (prod / staging), or the per-org org_* schemas with the flags in
 * `platform` (dev). Writes (apply / rollback) are logged to scripts/invoice-number-guard.log.json. Never prints a URL.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { INVOICE_NUMBER_GUARD_FLAGS, INVOICE_NUMBER_GUARD_NAME, dropInvoiceNumberGuardSql, invoiceNumberGuardSql } from '../src/document-numbering/invoice-number-guard';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const CONFIRM_PROD = args.includes('--confirm-prod');
const LOG = path.resolve(__dirname, 'invoice-number-guard.log.json');

async function main() {
  const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} is not set in .env`);
  const isProd = PROD || (!!process.env.PROD_DATABASE_URL && url === process.env.PROD_DATABASE_URL);
  if (APPLY && isProd && !CONFIRM_PROD) throw new Error('refusing to write to PROD without --confirm-prod');
  const u = new URL(url);
  for (const k of ['pool_timeout', 'connect_timeout', 'connection_limit', 'schema']) u.searchParams.delete(k);
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows as any[];
  try {
    // Dry run: every read inside ONE read-only transaction (never a session SET: through the Neon pooler a session
    // setting stays on the pooled server connection after this script ends).
    if (!APPLY) await c.query('BEGIN TRANSACTION READ ONLY');
    const docSchemas = (
      await q(`SELECT n.nspname::text s FROM pg_namespace n WHERE (n.nspname = 'public' OR n.nspname LIKE 'org\\_%') AND to_regclass(format('%I.%I', n.nspname, 'Document')) IS NOT NULL ORDER BY 1`)
    ).map((r) => r.s as string);
    const uiSchema = (await q(`SELECT n.nspname::text s FROM pg_namespace n WHERE n.nspname IN ('public','platform') AND to_regclass(format('%I.%I', n.nspname, 'OrganizationUIConfig')) IS NOT NULL ORDER BY (n.nspname = 'public') DESC LIMIT 1`))[0]?.s;
    const orgSchema = (await q(`SELECT n.nspname::text s FROM pg_namespace n WHERE n.nspname IN ('public','platform') AND to_regclass(format('%I.%I', n.nspname, 'Organization')) IS NOT NULL ORDER BY (n.nspname = 'public') DESC LIMIT 1`))[0]?.s;
    if (!docSchemas.length || !uiSchema) throw new Error('no Document / OrganizationUIConfig table found');
    console.log(`target: ${isProd ? 'PROD' : 'DEV'} · layout: ${docSchemas.includes('public') ? 'shared public schema' : `per-org (${docSchemas.length} org schemas)`} · flags read from "${uiSchema}"."OrganizationUIConfig"`);
    console.log(`mode: ${ROLLBACK ? 'ROLLBACK ' : ''}${APPLY ? 'APPLY' : 'DRY RUN (read-only)'}`);

    const flagSql = INVOICE_NUMBER_GUARD_FLAGS.map((f) => `COALESCE(c.features ->> '${f}', '') = 'true'`).join(' OR ');
    const names = new Map<string, string>(orgSchema ? (await q(`SELECT id::text id, name FROM "${orgSchema}"."Organization"`)).map((r) => [r.id, r.name]) : []);
    const guarded = (await q(`SELECT c."organizationId"::text id FROM "${uiSchema}"."OrganizationUIConfig" c WHERE ${flagSql} ORDER BY 1`)).map((r) => r.id as string);
    console.log(`\norgs the guard checks (${INVOICE_NUMBER_GUARD_FLAGS.join(' or ')} on): ${guarded.length ? guarded.map((id) => names.get(id) ?? id).join(', ') : 'none'}`);
    console.log('every other org: not checked (its inserts return at once, unchanged)');

    const plan: Array<{ schema: string; sql: string[] }> = [];
    for (const s of docSchemas) {
      const trig = await q(`SELECT pg_get_triggerdef(t.oid) def FROM pg_trigger t WHERE t.tgrelid = to_regclass(format('%I.%I', $1::text, 'Document')) AND t.tgname = $2`, [s, INVOICE_NUMBER_GUARD_NAME]);
      const dups = await q(
        `SELECT g."organizationId"::text id, count(*)::int groups, sum(g.n)::int rows, (array_agg(g.name ORDER BY g.name))[1:5] sample
           FROM (SELECT "organizationId", name, count(*) n FROM "${s}"."Document" WHERE type = 'INVOICE' AND name IS NOT NULL AND name <> '' GROUP BY 1, 2 HAVING count(*) > 1) g
          GROUP BY 1 ORDER BY 2 DESC`,
      );
      const inv = (await q(`SELECT count(*)::int n FROM "${s}"."Document" WHERE type = 'INVOICE'`))[0].n;
      console.log(`\n[${s}] invoices: ${inv} · trigger: ${trig[0] ? 'INSTALLED' : 'not installed'}`);
      if (!dups.length) console.log('  duplicate INVOICE numbers: none');
      for (const d of dups) {
        const checked = guarded.includes(d.id);
        console.log(`  duplicate INVOICE numbers, ${names.get(d.id) ?? d.id}${checked ? ' (checked org)' : ''}: ${d.groups} numbers, ${d.rows} rows${checked ? ` e.g. ${d.sample.join(', ')}` : ''}`);
      }
      plan.push({ schema: s, sql: ROLLBACK ? dropInvoiceNumberGuardSql(s) : invoiceNumberGuardSql(s, uiSchema) });
    }

    if (!APPLY) {
      console.log(`\nwould ${ROLLBACK ? 'drop' : 'install'} ${INVOICE_NUMBER_GUARD_NAME} on ${plan.length} schema(s): ${plan.map((p) => p.schema).join(', ')}`);
      console.log(`SQL for [${plan[0].schema}]:\n${plan[0].sql.join('\n')}`);
      console.log(`\nDRY RUN: nothing written. Apply: add --apply${isProd ? ' --confirm-prod' : ''}.`);
      return;
    }

    const run = { at: new Date().toISOString(), target: isProd ? 'PROD' : 'DEV', mode: ROLLBACK ? 'ROLLBACK' : 'APPLY', schemas: [] as string[] };
    for (const p of plan) {
      await c.query('BEGIN');
      try {
        for (const sql of p.sql) await c.query(sql);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
      run.schemas.push(p.schema);
      const now = await q(`SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass(format('%I.%I', $1::text, 'Document')) AND t.tgname = $2`, [p.schema, INVOICE_NUMBER_GUARD_NAME]);
      console.log(`✓ [${p.schema}] ${INVOICE_NUMBER_GUARD_NAME} ${ROLLBACK ? (now.length ? 'STILL THERE' : 'dropped') : now.length ? 'installed' : 'MISSING after install'}`);
    }
    const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : { runs: [] };
    log.runs.push(run);
    fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
  } finally {
    if (!APPLY) await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

main().catch((e) => {
  console.error('ERROR', e?.message ?? e);
  process.exit(1);
});
