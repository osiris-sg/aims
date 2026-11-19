/**
 * Company order numbers for the WCT group (round 36, 2026-11-19): sets the org setting
 * OrganizationUIConfig.features.orderNumberPrefix (document-numbering.service.ts ORDER_PREFIX_KEY) per org:
 *   WCT (S) Systems  ORDW   ->  new AIMS orders ORDW202611-001, ORDW202611-002, …
 *   WCT Racking      ORDR
 *   YMM Kitchen      ORDY   (stored now; YMM makes no AIMS orders until enableWctOrders is on)
 *   BC Air           ORDB
 * The prefix takes the place of ORD in the org's ORDER number format ({DOC}{YYYY}{MM}-{###}) as its own series on the
 * org's ORDER counter: the first new order is 001; old ORD… numbers and imported ORD-Q-… orders keep their numbers and
 * never count towards it. Every other org has no prefix and keeps ORD…. Nothing else is written: existing orders are
 * never renamed (the list of them is printed for that decision).
 *
 * DRY RUN by default (one read-only transaction): per org the current and new prefix, the ORDER format, the next new
 * order number, the existing AIMS orders.
 *   npx ts-node --transpile-only scripts/wct-order-prefix.ts                                 dry run, dev (.env DATABASE_URL)
 *   npx ts-node --transpile-only scripts/wct-order-prefix.ts --apply                         write on dev
 *   npx ts-node --transpile-only scripts/wct-order-prefix.ts --prod                          dry run, prod (read-only)
 *   npx ts-node --transpile-only scripts/wct-order-prefix.ts --prod --apply --confirm-prod   write on prod
 *   --default-pattern   also set an ORDER format whose pattern adds its own text around {DOC} (Racking's
 *                       WR-{DOC}{YYYY}{MM}-{###} reads WR-ORDR202611-001) to the default {DOC}{YYYY}{MM}-{###} (ORDR…)
 *   --rollback          remove the setting again (new orders go back to ORD…; numbers already given stay)
 * Writes are logged to scripts/wct-order-prefix.log.json. Never prints a URL.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_ORDER_PATTERN, DocumentNumberingService, ORDER_PREFIX_KEY, validOrderPrefix } from '../src/document-numbering/document-numbering.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const PLAN: Array<{ id: string; name: string; prefix: string }> = [
  { id: '5c700000-0000-4000-8000-5c7000000001', name: 'WCT (S) Systems', prefix: 'ORDW' },
  { id: '5c700000-0000-4000-8000-5c7000000002', name: 'WCT Racking', prefix: 'ORDR' },
  { id: '5c700000-0000-4000-8000-5c7000000003', name: 'YMM Kitchen', prefix: 'ORDY' },
  { id: '5c700000-0000-4000-8000-5c7000000004', name: 'BC Air', prefix: 'ORDB' },
];
const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const ROLLBACK = args.includes('--rollback');
const CONFIRM_PROD = args.includes('--confirm-prod');
const DEFAULT_PATTERN = args.includes('--default-pattern');
const LOG = path.resolve(__dirname, 'wct-order-prefix.log.json');

async function main() {
  const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} is not set in .env`);
  const isProd = PROD || (!!process.env.PROD_DATABASE_URL && url === process.env.PROD_DATABASE_URL);
  if (APPLY && isProd && !CONFIRM_PROD) throw new Error('refusing to write to PROD without --confirm-prod');
  for (const p of PLAN) if (validOrderPrefix(p.prefix) !== p.prefix) throw new Error(`bad prefix ${p.prefix}`);
  const u = new URL(url);
  for (const k of ['pool_timeout', 'connect_timeout', 'connection_limit', 'schema']) u.searchParams.delete(k);
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows as any[];
  // One transaction: read-only for a dry run (never a session SET through the pooler), all-or-nothing for a write.
  await c.query(APPLY ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    const one = async (table: string, prefer: string[]) =>
      (await q(`SELECT n.nspname::text s FROM pg_namespace n WHERE n.nspname::text = ANY($2::text[]) AND to_regclass(format('%I.%I', n.nspname, $1::text)) IS NOT NULL ORDER BY array_position($2::text[], n.nspname::text) LIMIT 1`, [table, prefer]))[0]?.s as string | undefined;
    const uiSchema = await one('OrganizationUIConfig', ['public', 'platform']);
    const orgSchema = await one('Organization', ['public', 'platform']);
    const dataSchemas = (await q(`SELECT n.nspname::text s FROM pg_namespace n WHERE (n.nspname = 'public' OR n.nspname LIKE 'org\\_%') AND to_regclass(format('%I.%I', n.nspname, 'Order')) IS NOT NULL ORDER BY 1`)).map((r) => r.s as string);
    if (!uiSchema || !orgSchema) throw new Error('no OrganizationUIConfig / Organization table found');
    console.log(`target: ${isProd ? 'PROD' : 'DEV'} · mode: ${ROLLBACK ? 'ROLLBACK ' : ''}${APPLY ? 'APPLY' : 'DRY RUN (read-only)'}${DEFAULT_PATTERN ? ' · --default-pattern' : ''}`);
    const now = new Date();
    const run: any = { at: now.toISOString(), target: isProd ? 'PROD' : 'DEV', mode: ROLLBACK ? 'ROLLBACK' : 'APPLY', writes: [] as any[] };

    for (const p of PLAN) {
      const org = (await q(`SELECT name FROM "${orgSchema}"."Organization" WHERE id = $1`, [p.id]))[0];
      if (!org) {
        console.log(`\n== ${p.name}: not in this database, skipped`);
        continue;
      }
      const ui = (await q(`SELECT id, features FROM "${uiSchema}"."OrganizationUIConfig" WHERE "organizationId" = $1`, [p.id]))[0];
      const features = (ui?.features as any) || {};
      const current = features[ORDER_PREFIX_KEY] ?? null;
      const target = ROLLBACK ? null : p.prefix;
      const formats: any[] = [];
      const orders: any[] = [];
      for (const s of dataSchemas) {
        formats.push(...(await q(`SELECT id, label, pattern, "nextSerial", "resetPolicy", "lastResetKey", "isActive", "sortOrder" FROM "${s}"."DocumentNumberFormat" WHERE "organizationId" = $1 AND "documentType" = 'ORDER' ORDER BY "sortOrder"`, [p.id])));
        orders.push(...(await q(`SELECT "orderNumber" n FROM "${s}"."Order" WHERE "organizationId" = $1 AND "orderNumber" NOT LIKE 'ORD-Q-%' ORDER BY "createdAt"`, [p.id])));
      }
      const active = formats.find((f) => f.isActive) ?? null;
      const pattern = active ? (DEFAULT_PATTERN && !ROLLBACK ? DEFAULT_ORDER_PATTERN : active.pattern) : DEFAULT_ORDER_PATTERN;
      const docCode = target ?? 'ORD';
      // The next new order number: a new series starts at 1, never below one past the highest number already given in it.
      const serialAt = pattern.search(/\{#+\}/);
      const lead = DocumentNumberingService.format(pattern.slice(0, serialAt), 0, now, docCode);
      const inSeries = orders.map((o) => String(o.n)).filter((n) => n.startsWith(lead)).map((n) => parseInt(n.slice(lead.length), 10)).filter((x) => Number.isFinite(x));
      const seriesStarted = active?.lastResetKey === `never#${target}`;
      const nextSerial = target ? Math.max(seriesStarted ? active.nextSerial : 1, (inSeries.length ? Math.max(...inSeries) : 0) + 1) : Math.max(active?.nextSerial ?? 1, (inSeries.length ? Math.max(...inSeries) : 0) + 1);
      const next = DocumentNumberingService.format(pattern, nextSerial, now, docCode);
      console.log(`\n== ${org.name}`);
      console.log(`   setting ${ORDER_PREFIX_KEY}: ${current ?? '(none)'} -> ${target ?? '(none)'}${!ui ? ' · NO OrganizationUIConfig row: skipped' : ''}`);
      console.log(`   AIMS orders: ${features.enableWctOrders === true ? 'on' : 'OFF (the prefix waits until enableWctOrders is on)'}`);
      console.log(`   ORDER format: ${active ? `${active.pattern} (counter ${active.nextSerial}, reset ${active.resetPolicy})` : `none yet (made at the first order with ${DEFAULT_ORDER_PATTERN})`}${DEFAULT_PATTERN && active && active.pattern !== DEFAULT_ORDER_PATTERN && !ROLLBACK ? ` -> ${DEFAULT_ORDER_PATTERN}` : ''}`);
      if (active && active.pattern !== DEFAULT_ORDER_PATTERN && !DEFAULT_PATTERN && !ROLLBACK) console.log(`   note: this pattern adds its own text around the prefix; --default-pattern makes it ${DocumentNumberingService.format(DEFAULT_ORDER_PATTERN, 1, now, docCode)}`);
      console.log(`   next new AIMS order: ${next}`);
      console.log(`   existing AIMS orders (kept as they are): ${orders.length ? orders.map((o) => o.n).join(', ') : 'none'}`);
      if (!APPLY || !ui) continue;
      const nextFeatures = { ...features };
      if (target) nextFeatures[ORDER_PREFIX_KEY] = target;
      else delete nextFeatures[ORDER_PREFIX_KEY];
      if ((current ?? null) !== (target ?? null)) {
        const r = await c.query(`UPDATE "${uiSchema}"."OrganizationUIConfig" SET features = $2::jsonb, "updatedAt" = now() WHERE id = $1`, [ui.id, JSON.stringify(nextFeatures)]);
        if (r.rowCount !== 1) throw new Error(`setting update touched ${r.rowCount} rows`);
        run.writes.push({ org: p.id, op: `features.${ORDER_PREFIX_KEY}`, from: current, to: target });
      }
      if (DEFAULT_PATTERN && !ROLLBACK && active && active.pattern !== DEFAULT_ORDER_PATTERN) {
        for (const s of dataSchemas) {
          const r = await c.query(`UPDATE "${s}"."DocumentNumberFormat" SET pattern = $3, "updatedAt" = now() WHERE id = $1 AND "organizationId" = $2`, [active.id, p.id, DEFAULT_ORDER_PATTERN]);
          if (r.rowCount) run.writes.push({ org: p.id, op: 'DocumentNumberFormat.pattern (ORDER)', from: active.pattern, to: DEFAULT_ORDER_PATTERN });
        }
      }
    }

    if (!APPLY) {
      console.log(`\nDRY RUN: nothing written. Apply: add --apply${isProd ? ' --confirm-prod' : ''}.`);
      await c.query('ROLLBACK');
      return;
    }
    await c.query('COMMIT');
    const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : { runs: [] };
    log.runs.push(run);
    fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
    console.log(`\nwritten: ${run.writes.length} change(s), logged to ${path.basename(LOG)}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error('ERROR', e?.message ?? e);
  process.exit(1);
});
