/**
 * BC Air document numbers like WCT (S)'s, with a B (owner, Option A, 2026-11-25; WCT group only):
 *   Quotation       QOB202611-0001   (WCT (S): QO202611-0001)
 *   Delivery order  DOB202611001     (WCT (S): DO202611001)
 *   Invoice         INVB202611-0001  (WCT (S): INV202611-0001)
 *   Credit note     CNB202611-0001   (WCT (S): CN202611-0001)
 * Orders already read ORDB… (scripts/wct-order-prefix.ts). The ERP's own SIBA- / CNBA- series and every imported
 * number stay as they are: nothing is renamed. Each pattern is WCT (S)'s own pattern for that type (same date part,
 * padding and reset policy) with "<code>B" in place of {DOC}; the counter starts at 1 and the numbering service never
 * issues below one past the highest existing BC Air name in that series (maxExistingSerial).
 *
 * Writes only DocumentNumberFormat rows for BC Air (create, or set the pattern of an existing row for the type) and one
 * Activity Log SYSTEM row. Also lists (read only) every BC Air document made in AIMS (not ERP-imported), with its name.
 *
 *   npx ts-node --transpile-only scripts/bcair-number-formats.ts                                 dry run, dev (.env DATABASE_URL)
 *   npx ts-node --transpile-only scripts/bcair-number-formats.ts --prod                          dry run, prod (read-only)
 *   npx ts-node --transpile-only scripts/bcair-number-formats.ts --prod --apply --confirm-prod   write on prod (owner APPLY)
 * Writes are logged to scripts/bcair-number-formats.log.json. Never prints a URL.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { DOC_CODE, DocumentNumberingService } from '../src/document-numbering/document-numbering.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const TYPES = ['QUOTATION', 'DELIVERY_ORDER', 'INVOICE', 'CREDIT_NOTE'] as const;
const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const CONFIRM_PROD = args.includes('--confirm-prod');
const LOG = path.resolve(__dirname, 'bcair-number-formats.log.json');

/** WCT (S)'s pattern for a type with "<code>B" in place of {DOC}: {DOC}{YYYY}{MM}-{####} -> QOB{YYYY}{MM}-{####}. */
export function bcairPattern(wctPattern: string, documentType: string): string {
  const code = DOC_CODE[documentType];
  if (!code) throw new Error(`no document code for ${documentType}`);
  if (!wctPattern.includes('{DOC}')) throw new Error(`WCT (S) ${documentType} pattern has no {DOC}: ${wctPattern}`);
  return wctPattern.replace('{DOC}', `${code}B`);
}

/** Highest serial among names in this pattern's series for `when` (same rule as DocumentNumberingService.maxExistingSerial). */
function maxSerialIn(names: string[], pattern: string, when: Date): number {
  const tok = /\{(#+)\}/.exec(pattern);
  if (!tok) return 0;
  const prefix = DocumentNumberingService.format(pattern.slice(0, tok.index), 0, when);
  const suffix = DocumentNumberingService.format(pattern.slice(tok.index + tok[0].length), 0, when);
  let max = 0;
  for (const n of names) {
    if (!n.startsWith(prefix) || (suffix && !n.endsWith(suffix))) continue;
    const mid = n.slice(prefix.length, suffix ? n.length - suffix.length : undefined);
    if (/^\d+$/.test(mid)) max = Math.max(max, parseInt(mid, 10));
  }
  return max;
}

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
  await c.query(APPLY ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    // The schema that holds BC Air's documents + number formats (public, or a per-org schema where one exists).
    const schemas = (
      await q(`SELECT n.nspname::text s FROM pg_namespace n WHERE (n.nspname = 'public' OR n.nspname LIKE 'org\\_%') AND to_regclass(format('%I.%I', n.nspname, 'DocumentNumberFormat')) IS NOT NULL ORDER BY 1`)
    ).map((r) => r.s as string);
    const schemaOf = async (orgId: string) => {
      for (const s of schemas) if ((await q(`SELECT 1 FROM "${s}"."DocumentNumberFormat" WHERE "organizationId" = $1 LIMIT 1`, [orgId])).length) return s;
      for (const s of schemas) if ((await q(`SELECT 1 FROM "${s}"."Document" WHERE "organizationId" = $1 LIMIT 1`, [orgId])).length) return s;
      return 'public';
    };
    const ws = await schemaOf(WCT);
    const bs = await schemaOf(BC);
    const org = (await q(`SELECT name FROM "Organization" WHERE id = $1`, [BC]))[0];
    if (!org) throw new Error('BC Air is not in this database');
    const now = new Date();
    console.log(`target: ${isProd ? 'PROD' : 'DEV'} · mode: ${APPLY ? 'APPLY' : 'DRY RUN (read-only)'} · org: ${org.name}`);
    console.log(`today: ${now.toISOString().slice(0, 10)} (next numbers below are for this month)`);

    const wctFormats = await q(`SELECT "documentType", pattern, "resetPolicy", "nextSerial" FROM "${ws}"."DocumentNumberFormat" WHERE "organizationId" = $1 AND "isActive" ORDER BY "sortOrder"`, [WCT]);
    const bcFormats = await q(`SELECT id, "documentType", label, pattern, "resetPolicy", "nextSerial", "lastResetKey", "isActive", "sortOrder" FROM "${bs}"."DocumentNumberFormat" WHERE "organizationId" = $1 ORDER BY "documentType", "sortOrder"`, [BC]);
    const bcNames = (await q(`SELECT name FROM "${bs}"."Document" WHERE "organizationId" = $1 AND name IS NOT NULL`, [BC])).map((r) => String(r.name));
    const nameSet = new Set(bcNames);

    console.log(`\nBC Air number formats now: ${bcFormats.length ? bcFormats.map((f) => `${f.documentType} ${f.pattern}${f.isActive ? '' : ' (inactive)'}`).join(' · ') : 'none'}`);
    const plan: any[] = [];
    console.log('\n== Formats');
    for (const t of TYPES) {
      const w = wctFormats.find((f) => f.documentType === t);
      if (!w) throw new Error(`WCT (S) has no active ${t} format to copy`);
      const pattern = bcairPattern(w.pattern, t);
      const existing = bcFormats.filter((f) => f.documentType === t);
      const active = existing.find((f) => f.isActive) ?? null;
      const op = !active ? 'CREATE' : active.pattern === pattern && active.resetPolicy === w.resetPolicy ? 'KEEP' : 'UPDATE';
      const counter = op === 'CREATE' ? 1 : active.nextSerial;
      // Same rule as generateNumber with reset 'never': never below the counter, never below one past the highest name.
      const maxExisting = maxSerialIn(bcNames, pattern, now);
      let serial = Math.max(counter, maxExisting + 1);
      while (nameSet.has(DocumentNumberingService.format(pattern, serial, now))) serial++;
      const next = DocumentNumberingService.format(pattern, serial, now);
      const seriesPrefix = pattern.slice(0, pattern.indexOf('{'));
      const inSeries = bcNames.filter((n) => n.startsWith(seriesPrefix) && /^\d/.test(n.slice(seriesPrefix.length)));
      console.log(`\n   ${t}`);
      console.log(`     WCT (S) format: ${w.pattern} (reset ${w.resetPolicy}) -> e.g. ${DocumentNumberingService.format(w.pattern, 1, now, DOC_CODE[t])}`);
      console.log(`     BC Air row: ${op}${active ? ` (id ${active.id}: ${active.pattern}, counter ${active.nextSerial}, reset ${active.resetPolicy})` : ''}`);
      console.log(`       documentType=${t} label=Default pattern=${pattern} resetPolicy=${w.resetPolicy} nextSerial=${counter} isActive=true sortOrder=0`);
      console.log(`     existing BC Air names in the ${seriesPrefix}… series: ${inSeries.length ? inSeries.join(', ') : 'none'}`);
      console.log(`     next ${t} number: ${next}`);
      plan.push({ type: t, op, id: active?.id ?? null, from: active?.pattern ?? null, pattern, resetPolicy: w.resetPolicy, next });
    }

    // AIMS-made BC Air documents (not ERP-imported): what they are called today. Read only.
    const made = await q(
      `SELECT type, name, status, "createdAt" FROM "${bs}"."Document"
        WHERE "organizationId" = $1 AND NOT (config ? 'erpImport') AND NOT (config ? 'wctErp') AND NOT (config ? 'imported')
        ORDER BY "createdAt"`,
      [BC],
    );
    console.log(`\n== BC Air documents made in AIMS (not ERP-imported): ${made.length}`);
    for (const d of made) console.log(`   ${d.type.padEnd(16)} ${String(d.name ?? '(no number)').padEnd(22)} ${String(d.status ?? '').padEnd(14)} ${new Date(d.createdAt).toISOString().slice(0, 10)}`);
    const orders = await q(`SELECT "orderNumber" n, status, "createdAt" FROM "${bs}"."Order" WHERE "organizationId" = $1 AND "orderNumber" NOT LIKE 'ORD-Q-%' ORDER BY "createdAt"`, [BC]).catch(() => []);
    console.log(`   (orders, for reference: ${orders.length ? orders.map((o) => `${o.n} ${o.status}`).join(', ') : 'none'})`);
    console.log('   Nothing is renamed.');

    const changes = plan.filter((p) => p.op !== 'KEEP');
    if (!APPLY) {
      console.log(`\nDRY RUN: nothing written. ${changes.length} format row(s) would change. Apply: add --apply${isProd ? ' --confirm-prod' : ''}.`);
      await c.query('ROLLBACK');
      return;
    }
    for (const p of changes) {
      if (p.op === 'CREATE') {
        await c.query(
          `INSERT INTO "${bs}"."DocumentNumberFormat"(id, "organizationId", "documentType", label, pattern, "nextSerial", "resetPolicy", "isActive", "sortOrder", "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, 'Default', $3, 1, $4, true, 0, now(), now())`,
          [BC, p.type, p.pattern, p.resetPolicy],
        );
      } else {
        const r = await c.query(`UPDATE "${bs}"."DocumentNumberFormat" SET pattern = $3, "resetPolicy" = $4, "updatedAt" = now() WHERE id = $1 AND "organizationId" = $2`, [p.id, BC, p.pattern, p.resetPolicy]);
        if (r.rowCount !== 1) throw new Error(`format update touched ${r.rowCount} rows`);
      }
    }
    await c.query(
      `INSERT INTO "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, details, status)
       VALUES (gen_random_uuid(), 'SYSTEM', 'system:bcair-number-formats', 'System creation', $1, 'operator', 'UPDATE', 'document-number-format', $2, 'SUCCESS')`,
      [BC, JSON.stringify({ note: 'BC Air number formats like WCT (S) with a B', changes: changes.map(({ type, op, from, pattern, next }) => ({ type, op, from, pattern, next })) })],
    );
    await c.query('COMMIT');
    const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : { runs: [] };
    log.runs.push({ at: now.toISOString(), target: isProd ? 'PROD' : 'DEV', changes });
    fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
    console.log(`\nwritten: ${changes.length} format row(s) + 1 Activity Log row, logged to ${path.basename(LOG)}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

if (require.main === module)
  main().catch((e) => {
    console.error('ERROR', e?.message ?? e);
    process.exit(1);
  });
