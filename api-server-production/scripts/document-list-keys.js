/**
 * Document list keys, WCT ONLY (2026-11-05). The aims_doc_list_keys trigger keeps three plain
 * columns on WCT's "Document" rows in step with their config, so WCT's document lists sort by
 * issue date and search in the database instead of loading every config (24k documents: 8-15 s
 * per page / search). Every other org's rows are skipped by the trigger's WHEN condition and never
 * written; their lists keep the existing code (the fast path needs the org setting
 * useDocumentListKeys, which only WCT gets).
 *   listIssueDate  = documentIssueDate(config, createdAt)   (documents.service.ts, yyyy-MM-dd)
 *   listSearch     = the searched config fields, lower-case, chr(1)-separated
 *   listCustomerId = config.customer.id, else config.customerId (the list's customer column)
 * The trigger can never fail a save: any error inside it leaves the three keys empty (which
 * sends WCT's lists back to the old path until --apply fills them again) and the save goes on.
 * Plain SQL like the journal guards (scripts/journal-guards.ts), so `prisma db push` leaves it
 * alone; the columns + index come from schema.prisma.
 *
 *   DBURL=… node scripts/document-list-keys.js                     dry run (read-only)
 *   DBURL=… node scripts/document-list-keys.js --apply             trigger + fill WCT's keys + verify + setting ON
 *   DBURL=… node scripts/document-list-keys.js --verify            read-only: WCT keys == the app's rules, other orgs untouched
 *   DBURL=… node scripts/document-list-keys.js --rollback          dry run of the rollback
 *   DBURL=… node scripts/document-list-keys.js --rollback --apply  setting OFF, drop trigger + function
 * --search-path <schemas> for the dev DB's per-org schemas. Writes are logged to
 * scripts/document-list-keys.log.json (updatedAt is never touched).
 */
const { Client, types } = require('pg');
const fs = require('fs');
const path = require('path');

// "timestamp without time zone" holds UTC (Prisma); read it as UTC, not as this machine's local time.
types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const FLAG = 'useDocumentListKeys';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY = args.includes('--verify');
const ROLLBACK = args.includes('--rollback');
const SEARCH_PATH = args.includes('--search-path') ? args[args.indexOf('--search-path') + 1] : null;
const CHUNK = 2000;
const LOG = path.resolve(__dirname, 'document-list-keys.log.json');

const FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION aims_doc_list_keys() RETURNS trigger AS $$
DECLARE
  c jsonb;
  raw text;
BEGIN
  BEGIN
    c := NEW.config;
    -- documentIssueDate: the first non-blank STRING of documentInfo.date / date / issueDate / invoiceDate.
    raw := COALESCE(
      CASE WHEN jsonb_typeof(c #> '{documentInfo,date}') = 'string' THEN NULLIF(btrim(c #>> '{documentInfo,date}'), '') END,
      CASE WHEN jsonb_typeof(c -> 'date') = 'string' THEN NULLIF(btrim(c ->> 'date'), '') END,
      CASE WHEN jsonb_typeof(c -> 'issueDate') = 'string' THEN NULLIF(btrim(c ->> 'issueDate'), '') END,
      CASE WHEN jsonb_typeof(c -> 'invoiceDate') = 'string' THEN NULLIF(btrim(c ->> 'invoiceDate'), '') END
    );
    NEW."listIssueDate" := CASE
      WHEN raw ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substr(raw, 1, 10)
      WHEN raw ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$' THEN split_part(raw, '/', 3) || '-' || lpad(split_part(raw, '/', 2), 2, '0') || '-' || lpad(split_part(raw, '/', 1), 2, '0')
      ELSE to_char(NEW."createdAt", 'YYYY-MM-DD')
    END;
    NEW."listSearch" := lower(concat_ws(chr(1),
      c #>> '{customer,name}', c ->> 'customerName', c ->> 'reference', c ->> 'referenceNo', c ->> 'xeroReference',
      c #>> '{documentInfo,referenceNo}', c #>> '{documentInfo,reference}', c #>> '{supplier,name}', c ->> 'supplierName'));
    NEW."listCustomerId" := COALESCE(NULLIF(c #>> '{customer,id}', ''), NULLIF(c ->> 'customerId', ''));
  EXCEPTION WHEN OTHERS THEN
    -- Never fail a save: leave the keys empty (the lists fall back to the old path).
    NEW."listIssueDate" := NULL;
    NEW."listSearch" := NULL;
    NEW."listCustomerId" := NULL;
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;`;
const TRIGGER_SQL = `
DROP TRIGGER IF EXISTS aims_doc_list_keys ON "Document";
CREATE TRIGGER aims_doc_list_keys BEFORE INSERT OR UPDATE OF config, "createdAt" ON "Document"
  FOR EACH ROW WHEN (NEW."organizationId" = '${WCT}')
  EXECUTE FUNCTION aims_doc_list_keys();`;
const DROP_SQL = `DROP TRIGGER IF EXISTS aims_doc_list_keys ON "Document"; DROP FUNCTION IF EXISTS aims_doc_list_keys();`;

// documents.service.ts documentIssueDate, copied for --verify.
function documentIssueDate(config, createdAt) {
  const raw = [config?.documentInfo?.date, config?.date, config?.issueDate, config?.invoiceDate].find((v) => typeof v === 'string' && v.trim());
  if (raw) {
    const v = String(raw).trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return createdAt.toISOString().slice(0, 10);
}
const OLD_SEARCH = `
  SELECT d.id FROM "Document" d WHERE d."organizationId" = $1 AND (
    d.config #>> '{customer,name}' ILIKE $2 OR d.config ->> 'customerName' ILIKE $2 OR d.config ->> 'reference' ILIKE $2
    OR d.config ->> 'referenceNo' ILIKE $2 OR d.config ->> 'xeroReference' ILIKE $2 OR d.config #>> '{documentInfo,referenceNo}' ILIKE $2
    OR d.config #>> '{documentInfo,reference}' ILIKE $2 OR d.config #>> '{supplier,name}' ILIKE $2 OR d.config ->> 'supplierName' ILIKE $2
    OR EXISTS (SELECT 1 FROM "Customer" c WHERE c."organizationId" = $1 AND c.name ILIKE $2 AND c.id::text IN (d.config #>> '{customer,id}', d.config ->> 'customerId')))`;
const NEW_SEARCH = `
  SELECT d.id FROM "Document" d WHERE d."organizationId" = $1 AND (
    d."listSearch" ILIKE $2
    OR d."listCustomerId" IN (SELECT c.id::text FROM "Customer" c WHERE c."organizationId" = $1 AND c.name ILIKE $2))`;

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  if (SEARCH_PATH) await c.query(`SET search_path TO ${SEARCH_PATH.split(',').map((x) => `"${x.replace(/"/g, '')}"`).join(', ')}`);
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : { runs: [] };
  const run = { at: new Date().toISOString(), mode: `${ROLLBACK ? 'ROLLBACK ' : ''}${APPLY ? 'APPLY' : VERIFY ? 'VERIFY' : 'DRY-RUN'}`, searchPath: SEARCH_PATH, writes: [] };
  const save = () => { if (APPLY) { log.runs.push(run); fs.writeFileSync(LOG, JSON.stringify(log, null, 1)); } };

  const state = async () => {
    const trig = await q(`select pg_get_triggerdef(t.oid) def from pg_trigger t where t.tgrelid = '"Document"'::regclass and t.tgname = 'aims_doc_list_keys'`);
    const fn = await q(`select 1 from pg_proc where proname = 'aims_doc_list_keys'`);
    const wct = (await q(`select count(*)::int n, count(*) filter (where "listIssueDate" is null)::int missing from "Document" where "organizationId" = $1`, [WCT]))[0];
    const others = (await q(`select count(*)::int n, count(*) filter (where "listIssueDate" is not null or "listSearch" is not null or "listCustomerId" is not null)::int keyed from "Document" where "organizationId" <> $1`, [WCT]))[0];
    const ui = await q(`select id, features from "OrganizationUIConfig" where "organizationId" = $1`, [WCT]);
    return { trigger: trig[0]?.def || null, fn: fn.length > 0, wct, others, uiId: ui[0]?.id || null, flag: (ui[0]?.features || {})[FLAG] ?? null };
  };
  const setFlag = async (on, uiId) => {
    if (!uiId) throw new Error('WCT has no OrganizationUIConfig row');
    const u = await c.query(`update "OrganizationUIConfig" set features = coalesce(features, '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean) where id = $1`, [uiId, FLAG, on]);
    if (u.rowCount !== 1) throw new Error(`setting update touched ${u.rowCount} rows`);
    run.writes.push({ op: `UPDATE OrganizationUIConfig.features.${FLAG}`, org: WCT, value: on });
  };

  const cols = await q(`select column_name from information_schema.columns where table_name = 'Document' and table_schema = current_schema() and column_name in ('listIssueDate','listSearch','listCustomerId')`);
  if (cols.length !== 3) throw new Error(`the list-key columns are not there yet (found ${cols.length}/3): deploy the schema first`);
  const before = await state();
  console.log(`trigger: ${before.trigger || 'none'}`);
  console.log(`WCT documents ${before.wct.n} (keys missing ${before.wct.missing}) · other orgs' documents ${before.others.n} (with keys ${before.others.keyed}) · WCT ${FLAG} = ${before.flag}`);

  if (ROLLBACK) {
    console.log(`rollback would: set ${FLAG} OFF for WCT, drop the trigger and function. The columns stay (nullable, unused once the setting is off).`);
    if (!APPLY) return c.end();
    await c.query('BEGIN');
    if (before.uiId) await setFlag(false, before.uiId);
    await c.query(DROP_SQL);
    run.writes.push({ op: 'DROP TRIGGER + FUNCTION aims_doc_list_keys' });
    await c.query('COMMIT');
    const after = await state();
    console.log(`rolled back: trigger ${after.trigger ? 'STILL THERE' : 'gone'} · function ${after.fn ? 'STILL THERE' : 'gone'} · WCT ${FLAG} = ${after.flag}`);
    save();
    return c.end();
  }

  if (VERIFY) return verify(q, before).then(() => c.end());
  if (!APPLY) return c.end();

  await c.query('BEGIN');
  await c.query(FUNCTION_SQL);
  await c.query(TRIGGER_SQL);
  await c.query('COMMIT');
  run.writes.push({ op: 'CREATE FUNCTION + TRIGGER aims_doc_list_keys (WHEN organizationId = WCT)' });
  console.log('trigger installed (WCT only)');
  let filled = 0;
  for (;;) {
    await c.query('BEGIN');
    // A no-op config write fires the trigger; updatedAt is Prisma-side and stays as it was.
    const res = await c.query(`update "Document" set config = config where id in (select id from "Document" where "organizationId" = $1 and "listIssueDate" is null limit ${CHUNK})`, [WCT]);
    await c.query('COMMIT');
    if (!res.rowCount) break;
    filled += res.rowCount;
    run.writes.push({ op: 'UPDATE Document list keys (WCT)', count: res.rowCount });
    process.stdout.write(`\r  filled ${filled}`);
  }
  console.log(`\nfilled ${filled} WCT documents`);
  const ok = await verify(q, await state());
  if (!ok) { console.log(`verify failed: ${FLAG} left as it was (${before.flag})`); save(); return c.end(); }
  await setFlag(true, before.uiId);
  const after = await state();
  console.log(`WCT ${FLAG} = ${after.flag} · other orgs' documents with keys: ${after.others.keyed}`);
  save();
  return c.end();
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});

async function verify(q, st) {
  const docs = await q(`select id, config, "createdAt", "listIssueDate" from "Document" where "organizationId" = $1`, [WCT]);
  let bad = 0;
  for (const d of docs) {
    if (documentIssueDate(d.config, d.createdAt) !== d.listIssueDate && bad++ < 10) console.log(`  issue date differs: ${d.id} app=${documentIssueDate(d.config, d.createdAt)} key=${d.listIssueDate}`);
  }
  let searchDiffs = 0;
  for (const term of ['a', 'pte', 'ltd', 'inv', 'yoshi', '-0', 'kopitiam', 'i-0150', 'zzzz']) {
    const like = `%${term}%`;
    const a = new Set((await q(OLD_SEARCH, [WCT, like])).map((r) => r.id));
    const b = new Set((await q(NEW_SEARCH, [WCT, like])).map((r) => r.id));
    const diff = [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
    if (diff) { searchDiffs += diff; console.log(`  search "${term}": old ${a.size} new ${b.size}`); }
  }
  console.log(`verify: WCT ${docs.length} documents · issue-date keys differing from the app's rule: ${bad} · search differences: ${searchDiffs} · other orgs' documents with keys: ${st.others.keyed}`);
  return bad === 0 && searchDiffs === 0 && st.others.keyed === 0;
}
