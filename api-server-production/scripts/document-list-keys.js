/**
 * Document list keys (2026-11-05): the aims_doc_list_keys trigger keeps three plain columns on
 * "Document" in step with its config, so the document lists sort by issue date and search in the
 * database instead of loading every config (WCT's 24k documents: 8-15 s per page / search).
 *   listIssueDate  = documentIssueDate(config, createdAt)   (documents.service.ts, yyyy-MM-dd)
 *   listSearch     = the searched config fields, lower-case, chr(1)-separated
 *   listCustomerId = config.customer.id, else config.customerId (the list's customer column)
 * Like the journal guards (scripts/journal-guards.ts) it is plain SQL, so `prisma db push`
 * leaves it alone. The columns + index come from schema.prisma.
 *
 *   DBURL=… node scripts/document-list-keys.js            dry run: what is missing, per org
 *   DBURL=… node scripts/document-list-keys.js --apply    install the trigger, fill missing keys (2,000 per transaction)
 *   DBURL=… node scripts/document-list-keys.js --verify   read-only: keys == the app's own rules, per org
 * --search-path <schemas> for the dev DB's per-org schemas (run once per schema).
 * Writes only the three key columns (updatedAt untouched); logs to scripts/document-list-keys.log.json.
 */
const { Client, types } = require('pg');
// "timestamp without time zone" holds UTC (Prisma); read it as UTC, not as this machine's local time.
types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY = args.includes('--verify');
const SEARCH_PATH = args.includes('--search-path') ? args[args.indexOf('--search-path') + 1] : null;
const CHUNK = 2000;

const FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION aims_doc_list_keys() RETURNS trigger AS $$
DECLARE
  c jsonb := NEW.config;
  raw text;
BEGIN
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
  RETURN NEW;
END $$ LANGUAGE plpgsql;`;
const TRIGGER_SQL = `
DROP TRIGGER IF EXISTS aims_doc_list_keys ON "Document";
CREATE TRIGGER aims_doc_list_keys BEFORE INSERT OR UPDATE OF config, "createdAt" ON "Document"
  FOR EACH ROW EXECUTE FUNCTION aims_doc_list_keys();`;

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
  const log = { at: new Date().toISOString(), mode: APPLY ? 'APPLY' : VERIFY ? 'VERIFY' : 'DRY-RUN', writes: [] };

  if (!APPLY) await c.query('BEGIN READ ONLY');
  const cols = await q(`select column_name from information_schema.columns where table_name = 'Document' and table_schema = current_schema() and column_name in ('listIssueDate','listSearch','listCustomerId')`);
  if (cols.length !== 3) throw new Error(`the list-key columns are not there yet (found ${cols.length}/3): deploy the schema first`);
  const trig = await q(`select 1 from pg_trigger where tgrelid = '"Document"'::regclass and tgname = 'aims_doc_list_keys'`);
  const missing = await q(`select "organizationId" org, count(*)::int n from "Document" where "listIssueDate" is null group by 1 order by 2 desc`);
  const total = (await q(`select count(*)::int n from "Document"`))[0].n;
  console.log(`trigger installed: ${trig.length > 0} · documents ${total} · missing keys ${missing.reduce((s, r) => s + r.n, 0)}`);
  for (const r of missing) console.log(`  ${r.org}: ${r.n}`);

  if (VERIFY) {
    const orgs = (await q(`select distinct "organizationId" org from "Document"`)).map((r) => r.org);
    let bad = 0, checked = 0, searchDiffs = 0;
    for (const org of orgs) {
      const docs = await q(`select id, config, "createdAt", "listIssueDate" from "Document" where "organizationId" = $1`, [org]);
      for (const d of docs) {
        checked++;
        if (documentIssueDate(d.config, d.createdAt) !== d.listIssueDate) {
          if (bad++ < 10) console.log(`  issue date differs: ${org} ${d.id} app=${documentIssueDate(d.config, d.createdAt)} key=${d.listIssueDate}`);
        }
      }
      for (const term of ['a', 'pte', 'ltd', 'inv', 'yoshi', '-0', 'bi2026', 'kopitiam', 'zzzz']) {
        const like = `%${term}%`;
        const a = new Set((await q(OLD_SEARCH, [org, like])).map((r) => r.id));
        const b = new Set((await q(NEW_SEARCH, [org, like])).map((r) => r.id));
        const diff = [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
        if (diff) { searchDiffs += diff; console.log(`  search "${term}" ${org}: old ${a.size} new ${b.size}`); }
      }
    }
    console.log(`verify: ${checked} documents · issue-date keys differing from the app's rule: ${bad} · search result differences: ${searchDiffs}`);
    await c.query('ROLLBACK');
    await c.end();
    return;
  }
  if (!APPLY) { await c.query('ROLLBACK'); await c.end(); return; }

  await c.query('BEGIN');
  await c.query(FUNCTION_SQL);
  await c.query(TRIGGER_SQL);
  await c.query('COMMIT');
  log.writes.push({ op: 'CREATE FUNCTION + TRIGGER aims_doc_list_keys' });
  console.log('trigger installed');
  let filled = 0;
  for (;;) {
    await c.query('BEGIN');
    // A no-op config write fires the trigger; updatedAt is Prisma-side and stays as it was.
    const res = await c.query(`update "Document" set config = config where id in (select id from "Document" where "listIssueDate" is null limit ${CHUNK}) returning id`);
    await c.query('COMMIT');
    if (!res.rowCount) break;
    filled += res.rowCount;
    log.writes.push({ op: 'UPDATE Document list keys', count: res.rowCount });
    process.stdout.write(`\r  filled ${filled}`);
  }
  console.log(`\nfilled ${filled} · still missing ${(await q(`select count(*)::int n from "Document" where "listIssueDate" is null`))[0].n}`);
  log.filled = filled;
  fs.writeFileSync(path.resolve(__dirname, 'document-list-keys.log.json'), JSON.stringify(log, null, 1));
  await c.end();
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});
