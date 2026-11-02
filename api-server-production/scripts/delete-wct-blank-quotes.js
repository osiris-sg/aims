/**
 * WCT: delete the two blank quotations QO202611-0018 / -0019 (made 2026-11-02
 * 09:26 UTC by the "Create Quotation" button and left empty). Nothing else.
 * Counters are NOT changed (the numbers stay used; gaps are fine).
 *
 * DRY RUN by default (READ ONLY):
 *   DBURL=<prod url, inline> NODE_PATH=$PWD/node_modules node scripts/delete-wct-blank-quotes.js [--apply --confirm-prod]
 *
 * Refuses unless each target is a WCT QUOTATION with that number and still
 * blank (no lines, no customer, never signed / shared / posted / paid), and
 * every reference to it (all id columns) is in the plan or kept history.
 * Every DELETE is limited to WCT; the counts are re-checked inside the
 * transaction. One ActionLog row on apply.
 */
const { Client, types } = require('pg');
types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const TARGETS = [
  ['8074053b-ea9f-48ef-8858-d464bae855ab', 'QO202611-0018'],
  ['6713728b-0e0b-42b6-9648-279c48a35bd1', 'QO202611-0019'],
];
const APPLY = process.argv.includes('--apply');
if (APPLY && !process.argv.includes('--confirm-prod')) {
  console.error('--apply needs --confirm-prod');
  process.exit(1);
}
let problems = 0;
const stop = (w) => {
  problems++;
  console.log(`  !! STOP: ${w}`);
};

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
  const q = async (s, p = []) => {
    await c.query('SAVEPOINT s');
    try {
      const r = (await c.query(s, p)).rows;
      await c.query('RELEASE SAVEPOINT s');
      return r;
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT s');
      return null;
    }
  };
  const ids = TARGETS.map((t) => t[0]);
  console.log(`DELETE WCT BLANK QUOTATIONS: ${APPLY ? 'APPLY' : 'DRY RUN (read only)'}  ${new Date().toISOString()}`);
  for (const [id, name] of TARGETS) {
    const d = (await q(
      `select d.id, d.name, d.type, d.status, d."organizationId", d."createdAt", d."updatedAt",
         coalesce(jsonb_array_length(case when jsonb_typeof(d.config->'items')='array' then d.config->'items' else '[]'::jsonb end),0) lines,
         (select count(*) from "DocumentItem" i where i."documentId"::text=d.id::text)::int items,
         coalesce(d.config->'customer'->>'name', d.config->>'customerName', d.config->>'customerId','') cust,
         (select count(*) from "DocumentSignLink" s where s."documentId"::text=d.id::text)::int sign,
         (select count(*) from "DocumentShareLink" s where s."documentId"::text=d.id::text)::int share,
         (select count(*) from "JournalEntry" j where j."sourceDocumentId"::text=d.id::text)::int je,
         (select count(*) from "Payment" p where p."documentId"::text=d.id::text)::int pay
       from "Document" d where d.id::text=$1`,
      [id],
    ))?.[0];
    console.log(`  ${name}: ${d ? `${d.type} ${d.status} org ${d.organizationId === WCT ? 'WCT' : d.organizationId} created ${d.createdAt.toISOString()} · lines ${d.lines}/${d.items} · customer "${d.cust}" · sign ${d.sign} share ${d.share} journals ${d.je} payments ${d.pay}` : 'MISSING'}`);
    if (!d || d.name !== name || d.type !== 'QUOTATION' || d.organizationId !== WCT) stop(`${name} is not WCT's quotation ${id}`);
    else if (d.lines || d.items || d.cust || d.sign || d.share || d.je || d.pay) stop(`${name} is not blank any more`);
  }
  // Every id-like column, for both ids.
  const cols = await q(`select table_name t, column_name col, data_type dt from information_schema.columns where table_schema='public' and data_type in ('uuid','text','ARRAY') and (column_name ilike '%id' or column_name ilike '%ids') and table_name not like '\\_%'`);
  const refs = {};
  for (const { t, col, dt } of cols) {
    const r = dt === 'ARRAY'
      ? await q(`select count(*)::int n from "${t}", unnest("${col}") x where x::text = any($1::text[])`, [ids])
      : await q(`select count(*)::int n from "${t}" where "${col}"::text = any($1::text[])`, [ids]);
    if (r && r[0].n) refs[`${t}.${col}`] = r[0].n;
  }
  const json = await q(`select name from "Document" where not (id::text = any($1::text[])) and (config::text like '%' || $2 || '%' or config::text like '%' || $3 || '%')`, [ids, ids[0], ids[1]]);
  console.log('  references:', JSON.stringify(refs), json?.length ? `config mentions in ${json.map((x) => x.name).join(', ')}` : '');
  const handled = /^(Document\.id|ActionLog\.resourceId|AuditLog\.resourceId|Notification\.entityId|DocumentItem\.documentId|DocumentEmbedding\.documentId|DocumentLock\.documentId)$/;
  const extra = Object.keys(refs).filter((k) => !handled.test(k));
  if (extra.length) stop(`references outside the plan: ${extra.join(', ')}`);
  if (json?.length) stop('another document mentions a target');
  const notifs = (await q(`select count(*)::int n from "Notification" where "organizationId"=$1 and "entityId" = any($2::text[])`, [WCT, ids]))[0].n;
  const locks = refs['DocumentLock.documentId'] ?? 0;
  const before = (await q(`select "nextSerial" from "DocumentNumberFormat" where "organizationId"=$1 and "documentType"='QUOTATION'`, [WCT]))?.[0]?.nextSerial;
  console.log(`\n  PLAN (one transaction): delete ${notifs} notification(s), ${locks} edit lock(s), 2 Document QUOTATION (WCT only). KEPT: ActionLog / AuditLog history, counters (QUOTATION nextSerial stays ${before}).`);
  if (!APPLY || problems) {
    await c.query('ROLLBACK');
    console.log(`\n${problems ? `${problems} PROBLEM(S)` : 'No problems found.'} ${APPLY ? 'ROLLBACK, nothing written.' : 'DRY RUN: nothing was written.'}`);
    await c.end();
    process.exit(problems ? 1 : 0);
  }
  try {
    const n = (await c.query(`delete from "Notification" where "organizationId"=$1 and "entityId" = any($2::text[])`, [WCT, ids])).rowCount;
    const l = locks ? (await c.query(`delete from "DocumentLock" where "documentId"::text = any($1::text[])`, [ids])).rowCount : 0;
    const d = (await c.query(`delete from "Document" where "organizationId"=$1 and type='QUOTATION' and id::text = any($2::text[])`, [WCT, ids])).rowCount;
    console.log(`  deleted: notifications ${n}, locks ${l}, documents ${d}`);
    if (n !== notifs || l !== locks || d !== 2) throw new Error('count mismatch');
    const after = (await c.query(`select "nextSerial" from "DocumentNumberFormat" where "organizationId"=$1 and "documentType"='QUOTATION'`, [WCT])).rows[0]?.nextSerial;
    if (after !== before) throw new Error('counter changed');
    await c.query(`insert into "ActionLog" (id,"actorType","actorId","actorName","organizationId",channel,action,resource,details,status,"createdAt") values ($1,'SYSTEM','system:wct-blank-quotes-cleanup','System creation',$2,'operator','DELETE','Document',$3::jsonb,'SUCCESS',now())`, [require('crypto').randomUUID(), WCT, JSON.stringify({ deleted: TARGETS.map((t) => t[1]), reason: 'blank quotations left by the Create button' })]);
    await c.query('COMMIT');
    console.log('\nAPPLIED: committed (+1 ActionLog row).');
  } catch (e) {
    await c.query('ROLLBACK');
    console.log(`\n!! ${e.message}: ROLLBACK, nothing written.`);
    process.exit(1);
  }
  await c.end();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
