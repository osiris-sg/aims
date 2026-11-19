/**
 * WCT old-ERP catch-up: the apply steps that are not covered by wct-erp-import.js,
 * wct-ng-quotes-to-bcair.ts and wct-imported-orders.ts. DRY RUN BY DEFAULT.
 *
 *   --step refresh       the plan's status / payment updates of imported documents (<pull>/plan.json):
 *                        erpImport.status, the ERP balance (erpImport.balanceAtImport / erpBalanceDue, the
 *                        first values kept as balanceAtFirstImport / statusAtFirstImport, refreshedAt) and the
 *                        money keys by the stampDocumentMoney rule (outstandingBalance / paidToDate + Xero twins),
 *                        Document.status paid / pending_payment. Content (lines, totals, customer) never changes.
 *                        Guarded: every row must still hold the planned "from" values (ERP status, owed, status),
 *                        else NOTHING is written. One transaction; one ActionLog row per document.
 *   --step ng-customers  after the "(NG)" move: removes the WCT (S) customers this batch created only for
 *                        "(NG)" quotations (<pull>/customers-to-create.csv ng_only=yes), when nothing references
 *                        them any more and BC Air has a customer with the same name.
 *   --step release-lock  ends the idle pooled connection that still holds the wct-erp-import advisory lock.
 *
 *   node scripts/wct-erp-catchup-apply.js --env prod --pull <dir> --step refresh                         dry run
 *   node scripts/wct-erp-catchup-apply.js --env prod --pull <dir> --step refresh --apply --confirm-prod   write
 * Options: --search-path <schemas> (dev per-org tenancy, e.g. org_wct,platform), --plan <file> (default <pull>/plan.json).
 * Every write is logged to <pull>/apply-logs/<step>.<env>.<time>.log.json.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BCAIR = '5c700000-0000-4000-8000-5c7000000004';
const argv = process.argv.slice(2);
const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev');
const STEP = one('--step');
const PULL = one('--pull');
const SEARCH_PATH = one('--search-path', null);
const APPLY = argv.includes('--apply');
const JOB = 'system:wct-erp-catchup';
const R2 = (n) => Math.round(Number(n) * 100) / 100;
const T = (t) => `"${t}"`; // resolved through search_path (prod: public)
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(pteltd|privatelimited|ltd|llp)$/, '');
const readCsv = (file) => {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [h, ...b] = rows.filter((r) => r.length > 1);
  return b.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
};
// The stored owed amount, read like owedOf/outstandingOf (src/common/document-money.ts): null = owed in full.
const owedOf = (config) => {
  const o = config?.outstandingBalance ?? config?.xeroBalance;
  if (o === undefined || o === null || o === '') return Number(config?.totalWithTax ?? config?.xeroGross ?? config?.nettTotal ?? 0);
  return Number(o);
};

(async () => {
  if (!['dev', 'prod'].includes(ENV)) throw new Error('--env dev|prod');
  if (!['refresh', 'ng-customers', 'release-lock'].includes(STEP)) throw new Error('--step refresh|ng-customers|release-lock');
  if (!PULL || !fs.existsSync(PULL)) throw new Error('--pull <catch-up pull folder>');
  if (SEARCH_PATH && !/^[a-z_][a-z0-9_,]*$/i.test(SEARCH_PATH)) throw new Error('bad --search-path');
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const c = new Client({ connectionString: url });
  await c.connect();
  if (SEARCH_PATH) await c.query(`SET search_path TO ${SEARCH_PATH.split(',').map((x) => `"${x}"`).join(', ')}`);
  if (!APPLY) await c.query('SET default_transaction_read_only = on');
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;
  const at = new Date().toISOString();
  const log = { step: STEP, env: ENV, searchPath: SEARCH_PATH, mode: APPLY ? 'APPLY' : 'DRY RUN', at, writes: [] };
  const saveLog = () => {
    if (!APPLY) return;
    const dir = path.join(PULL, 'apply-logs');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${STEP}.${ENV}.${at.replace(/[:.]/g, '-')}.log.json`);
    fs.writeFileSync(f, JSON.stringify(log, null, 1));
    console.log(`log: ${f}`);
  };
  const actionLog = (org, action, resource, resourceId, note) =>
    c.query(
      `insert into ${T('ActionLog')}(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
       values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', $3, $4, $5, $6, 'SUCCESS')`,
      [JOB, org, action, resource, resourceId, JSON.stringify({ note, batch: path.basename(PULL) })],
    );

  try {
    if (STEP === 'release-lock') {
      const rows = await q(
        `select l.pid, a.state, a.application_name, a.state_change from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where l.locktype = 'advisory' and l.objid = (hashtext('wct-erp-import')::bigint & 4294967295) and l.granted`,
      );
      console.log(`wct-erp-import lock holders: ${JSON.stringify(rows)}`);
      const me = (await q('select pg_backend_pid() pid'))[0].pid;
      for (const r of rows) {
        if (r.pid === me) {
          // Behind the pooler this run can land on the very server connection that holds the lock: release it here.
          if (APPLY) {
            const ok = (await q(`select pg_advisory_unlock(hashtext('wct-erp-import')) ok`))[0].ok;
            log.writes.push({ op: 'pg_advisory_unlock', pid: r.pid, ok });
            console.log(`pid ${r.pid} is this session: unlocked ${ok}`);
          } else console.log(`pid ${r.pid} is this session: would unlock`);
          continue;
        }
        if (r.state !== 'idle') { console.log(`pid ${r.pid} is ${r.state}: left alone`); continue; }
        if (APPLY) {
          const ok = (await q('select pg_terminate_backend($1) ok', [r.pid]))[0].ok;
          log.writes.push({ op: 'pg_terminate_backend', pid: r.pid, state: r.state, application: r.application_name, ok });
          console.log(`pid ${r.pid} ended: ${ok}`);
        } else console.log(`would end idle pid ${r.pid} (${r.application_name})`);
      }
      return;
    }

    if (STEP === 'refresh') {
      const plan = JSON.parse(fs.readFileSync(one('--plan', path.join(PULL, 'plan.json')), 'utf8'));
      const ups = plan.updates || [];
      console.log(`${ENV.toUpperCase()} refresh ${log.mode}: ${ups.length} planned update(s)`);
      if (APPLY) await c.query('BEGIN');
      const problems = [];
      const done = [];
      for (const u of ups) {
        const row = (await q(`select id::text id, "organizationId"::text org, type, name, status::text status, config from ${T('Document')} where id = $1 ${APPLY ? 'for update' : ''}`, [u.id]))[0];
        if (!row) { problems.push(`${u.name}: not found`); continue; }
        const e = row.config?.erpImport;
        if (!e || e.source !== 'wct-erp') { problems.push(`${u.name}: not an ERP-imported document`); continue; }
        if (row.name !== u.name || row.type !== u.type) { problems.push(`${u.name}: id points at ${row.type} ${row.name}`); continue; }
        if (e.status !== u.from.erpStatus) { problems.push(`${u.name}: ERP status is ${e.status}, plan expected ${u.from.erpStatus}`); continue; }
        let config = { ...row.config };
        const erp = { ...e, status: u.erpStatus, refreshedAt: at, refreshBatch: path.basename(PULL), statusAtFirstImport: e.statusAtFirstImport ?? e.status };
        let status = row.status;
        if (u.type === 'INVOICE') {
          const owedNow = R2(owedOf(row.config));
          if (Math.abs(owedNow - R2(u.from.owed)) > 0.005) { problems.push(`${u.name}: owes ${owedNow} in AIMS, plan expected ${u.from.owed}`); continue; }
          if (row.status !== u.from.docStatus) { problems.push(`${u.name}: status ${row.status}, plan expected ${u.from.docStatus}`); continue; }
          const gross = R2(row.config.totalWithTax ?? row.config.xeroGross ?? u.total);
          if (Math.abs(gross - R2(u.total)) > 0.005) { problems.push(`${u.name}: total ${gross}, plan expected ${u.total}`); continue; }
          erp.balanceAtFirstImport = e.balanceAtFirstImport ?? e.balanceAtImport;
          erp.balanceAtImport = R2(u.owed);
          erp.erpBalanceDue = R2(u.owed);
          if (u.creditNotes?.length) erp.creditNote = [...new Set([...(String(e.creditNote || '').split(/\s+/).filter(Boolean)), ...u.creditNotes])].join(' ');
          // stampDocumentMoney rule: canonical keys + Xero twins.
          config.outstandingBalance = R2(u.owed); config.xeroBalance = R2(u.owed);
          config.paidToDate = R2(gross - u.owed); config.xeroAmountPaid = R2(gross - u.owed);
          status = u.docStatus;
        }
        config.erpImport = erp;
        const change = `${u.type} ${u.name}: ERP ${e.status} -> ${u.erpStatus}${u.type === 'INVOICE' ? `${Math.abs(R2(owedOf(row.config)) - R2(u.owed)) > 0.005 ? `, owed ${R2(owedOf(row.config))} -> ${R2(u.owed)}` : ', owed unchanged'}${row.status !== status ? `, status ${row.status} -> ${status}` : ''}` : ''}`;
        done.push(change);
        if (APPLY) {
          await c.query(`update ${T('Document')} set config = $2::jsonb, status = $3, "updatedAt" = now() where id = $1`, [u.id, JSON.stringify(config), status]);
          await actionLog(row.org, 'UPDATE', 'documents', u.id, `ERP catch-up refresh: ${change}`);
          log.writes.push({ op: 'UPDATE Document', id: u.id, name: u.name, before: { status: row.status, erpStatus: e.status, outstandingBalance: row.config.outstandingBalance ?? null, paidToDate: row.config.paidToDate ?? null, balanceAtImport: e.balanceAtImport ?? null }, after: { status, erpStatus: u.erpStatus, outstandingBalance: config.outstandingBalance ?? null, paidToDate: config.paidToDate ?? null, balanceAtImport: erp.balanceAtImport ?? null } });
        }
      }
      if (problems.length) {
        if (APPLY) await c.query('ROLLBACK');
        console.log(`STOP: ${problems.length} row(s) no longer match the plan; nothing written.`);
        for (const p of problems) console.log(`  ${p}`);
        log.problems = problems; log.writes = [];
        process.exitCode = 2;
        return;
      }
      if (APPLY) await c.query('COMMIT');
      const kinds = done.reduce((m, d) => { const k = d.replace(/^\S+ \S+: /, '').replace(/owed [\d.]+ -> [\d.]+/, 'owed changed'); m[k] = (m[k] || 0) + 1; return m; }, {});
      console.log(`${APPLY ? 'updated' : 'would update'} ${done.length}: ${Object.entries(kinds).map(([k, v]) => `${k} x${v}`).join(' | ')}`);
      return;
    }

    if (STEP === 'ng-customers') {
      const want = readCsv(path.join(PULL, 'customers-to-create.csv')).filter((r) => r.ng_only === 'yes').map((r) => r.erp_customer);
      const batch = `wct-erp-catchup-${path.basename(PULL)}`;
      const wct = await q(`select id::text id, name, "customerCode", "externalRef" from ${T('Customer')} where "organizationId" = $1 and "externalRef" = $2`, [WCT, `erp-import:${batch}`]);
      const bc = await q(`select id::text id, name, "customerCode" from ${T('Customer')} where "organizationId" = $1`, [BCAIR]);
      const fks = await q(`select conrelid::regclass::text t, a.attname col from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                            where k.confrelid = to_regclass('"Customer"') and k.contype = 'f'`);
      console.log(`${ENV.toUpperCase()} ng-customers ${log.mode}: ${want.length} "(NG)"-only ERP customer(s); WCT (S) customers made by ${batch}: ${wct.length}`);
      if (APPLY) await c.query('BEGIN');
      let removed = 0;
      for (const name of want) {
        const w = wct.find((x) => x.name === name);
        if (!w) { console.log(`  "${name}": no WCT (S) row from this batch (nothing to remove)`); continue; }
        const b = bc.find((x) => normName(x.name) === normName(name));
        const refs = [];
        const docs = (await q(`select count(*)::int n from ${T('Document')} where config->>'customerId' = $1 or "listCustomerId"::text = $1`, [w.id]))[0].n;
        if (docs) refs.push(`${docs} document(s)`);
        for (const f of fks) {
          const n = (await q(`select count(*)::int n from ${f.t} where "${f.col}"::text = $1`, [w.id]))[0].n;
          if (n) refs.push(`${n} ${f.t}.${f.col}`);
        }
        if (!b || refs.length) { console.log(`  KEEP ${w.customerCode} "${name}": ${!b ? 'no BC Air customer with this name' : ''} ${refs.join(', ')}`); continue; }
        console.log(`  ${APPLY ? 'REMOVED' : 'would remove'} WCT (S) ${w.customerCode} "${name}" (BC Air has ${b.customerCode})`);
        if (APPLY) {
          const full = (await q(`select * from ${T('Customer')} where id = $1`, [w.id]))[0];
          await c.query(`delete from ${T('Customer')} where id = $1 and "organizationId" = $2 and "externalRef" = $3`, [w.id, WCT, `erp-import:${batch}`]);
          await actionLog(WCT, 'DELETE', 'customers', w.id, `ERP catch-up: temporary WCT (S) customer ${w.customerCode} "${name}" removed after its "(NG)" quotations moved to BC Air (${b.customerCode})`);
          log.writes.push({ op: 'DELETE Customer', id: w.id, code: w.customerCode, name, bcAir: b.customerCode, row: full });
        }
        removed++;
      }
      if (APPLY) await c.query('COMMIT');
      console.log(`${APPLY ? 'removed' : 'would remove'} ${removed}`);
    }
  } catch (e) {
    if (APPLY) await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    saveLog();
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
