/**
 * Delete blank documents that were created by mistake (2026-11-02), per org:
 *   - the empty-list AUTO-CREATE (GoToLatestDocument, fixed in 88d5aecc), and
 *   - the "Create" button, then left without anything entered.
 * Only documents whose creation is in the Activity Log are considered (the
 * blank ones with no log are left alone). Counters are never touched.
 *
 * A document qualifies only if it is still blank: no lines, no customer /
 * supplier, never signed / shared / posted / paid / synced, and nothing else
 * refers to it (every id column checked; ActionLog / AuditLog history kept).
 * A blank document another document's config points at (e.g. a sale order
 * real DOs carry as saleOrderId) is in use and is kept.
 *
 *   DBURL=<prod url, inline> NODE_PATH=$PWD/node_modules node scripts/delete-abandoned-blank-docs.js [--apply --confirm-prod]
 *
 * Every DELETE is limited to the document's own org; counts are re-checked
 * inside the one transaction. One ActionLog row per org on apply.
 */
const { Client, types } = require('pg');
types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));
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
const utc = (d) => d.toISOString().replace('T', ' ').replace('Z', '');

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
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT s');
      return null;
    }
  };
  console.log(`DELETE ABANDONED BLANK DOCUMENTS: ${APPLY ? 'APPLY' : 'DRY RUN (read only)'}  ${new Date().toISOString()}`);
  const blanks = await q(`
    select d.id::text id, d.name, d.type, d.status, d."createdAt", d."organizationId"::text org, o.name "orgName"
      from "Document" d join "Organization" o on o.id::text=d."organizationId"::text
     where coalesce(jsonb_array_length(case when jsonb_typeof(d.config->'items')='array' then d.config->'items' else '[]'::jsonb end),0)=0
       and not exists (select 1 from "DocumentItem" i where i."documentId"::text=d.id::text)
       and coalesce(d.config->'customer'->>'name', d.config->>'customerName', d.config->>'customerId', d.config->'supplier'->>'name', d.config->>'supplierName', d.config->>'supplierId', '') = ''
       and not exists (select 1 from "DocumentSignLink" s where s."documentId"::text=d.id::text)
       and not exists (select 1 from "DocumentShareLink" s where s."documentId"::text=d.id::text)
       and not exists (select 1 from "JournalEntry" j where j."sourceDocumentId"::text=d.id::text)
       and not exists (select 1 from "Payment" p where p."documentId"::text=d.id::text)
       and coalesce(d.config->>'xeroId', d.config->>'xeroInvoiceId', '') = ''
     order by o.name, d."createdAt"`);
  const targets = [];
  for (const b of blanks) {
    const log = await q(
      `select "createdAt", path, "actorId", "actorName" from "ActionLog" where "createdAt" between $1 and $2 and ("organizationId"=$3 or details->>'viewingAs'=$3)
         and (path like '/documents/basic%' or path like '/document-numbering%' or path like '/documents/paginated%') order by "createdAt"`,
      [utc(new Date(b.createdAt.getTime() - 20000)), utc(new Date(b.createdAt.getTime() + 3000)), b.org],
    );
    const create = (log || []).filter((l) => l.path.startsWith('/documents/basic') && Math.abs(l.createdAt - b.createdAt) < 3000).pop();
    if (!create) continue;
    const prior = log.filter((l) => l.actorId === create.actorId && l.createdAt <= create.createdAt);
    const how = prior.some((l) => l.path.startsWith('/document-numbering')) ? 'Create button, left empty' : prior.some((l) => l.path.startsWith('/documents/paginated')) ? 'empty-list auto-create' : null;
    if (how) targets.push({ ...b, how, who: create.actorName || create.actorId?.slice(0, 12) });
  }
  // Kept: a blank document another document points at (e.g. a sale order that
  // real DOs / invoices carry as saleOrderId) is in use, not abandoned.
  const keptInUse = [];
  for (const t of [...targets]) {
    const users = await q(`select name from "Document" where id::text<>$1 and config::text like '%' || $1 || '%'`, [t.id]);
    if (users?.length) {
      keptInUse.push({ ...t, users: users.map((u) => u.name) });
      targets.splice(targets.indexOf(t), 1);
    }
  }
  const ids = targets.map((t) => t.id);
  // References to the targets anywhere (all id columns).
  const cols = await q(`select table_name t, column_name col, data_type dt from information_schema.columns where table_schema='public' and data_type in ('uuid','text','ARRAY') and (column_name ilike '%id' or column_name ilike '%ids') and table_name not like '\\_%'`);
  const refs = {};
  for (const { t, col, dt } of cols) {
    const r = dt === 'ARRAY'
      ? await q(`select x::text v, count(*)::int n from "${t}", unnest("${col}") x where x::text = any($1::text[]) group by 1`, [ids])
      : await q(`select "${col}"::text v, count(*)::int n from "${t}" where "${col}"::text = any($1::text[]) group by 1`, [ids]);
    for (const x of r || []) (refs[x.v] ||= {})[`${t}.${col}`] = x.n;
  }
  const kept = /^(Document\.id|ActionLog\.resourceId|AuditLog\.resourceId)$/;
  const planned = /^(Notification\.entityId|DocumentLock\.documentId|DocumentItem\.documentId|DocumentEmbedding\.documentId)$/;
  const byOrg = {};
  for (const t of targets) (byOrg[t.orgName] ||= []).push(t);
  for (const [org, list] of Object.entries(byOrg)) {
    console.log(`\n== ${org}: ${list.length}`);
    for (const t of list) {
      const r = refs[t.id] || {};
      const other = Object.keys(r).filter((k) => !kept.test(k) && !planned.test(k));
      console.log(`  ${(t.name ?? '(no number)').padEnd(16)} ${t.type.padEnd(16)} ${t.status.padEnd(12)} ${t.createdAt.toISOString().slice(0, 16)}  ${t.how.padEnd(26)} by ${t.who}${other.length ? `   <- ALSO REFERENCED BY ${other.join(', ')}` : ''}`);
      if (other.length) stop(`${t.name ?? t.id} is referenced outside the plan`);
    }
  }
  if (keptInUse.length) {
    console.log('\n== KEPT (blank, but other documents point at them)');
    for (const t of keptInUse) console.log(`  ${t.orgName}: ${t.type} ${t.name} is referenced by ${t.users.length} document(s): ${t.users.join(', ')}`);
  }
  const json = ids.length ? await q(`select name from "Document" where not (id::text = any($1::text[])) and exists (select 1 from unnest($1::text[]) x where "Document".config::text like '%' || x || '%')`, [ids]) : [];
  if (json?.length) stop(`another document's config mentions a target: ${json.map((x) => x.name).join(', ')}`);
  const notifs = ids.length ? (await q(`select count(*)::int n from "Notification" where "entityId" = any($1::text[])`, [ids]))[0].n : 0;
  const counters0 = await q(`select "organizationId"::text org, "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId"::text = any($1::text[]) order by 1,2`, [[...new Set(targets.map((t) => t.org))]]);
  console.log(`\n  PLAN (one transaction): delete ${targets.length} documents (each only in its own org), ${notifs} notification(s). KEPT: ActionLog / AuditLog history, every number counter.`);
  console.log(`  Left alone: ${blanks.length - targets.length} other blank documents (no log of how they were made, or made another way).`);
  if (!APPLY || problems) {
    await c.query('ROLLBACK');
    console.log(`\n${problems ? `${problems} PROBLEM(S)` : 'No problems found.'} ${APPLY ? 'ROLLBACK, nothing written.' : 'DRY RUN: nothing was written.'}`);
    await c.end();
    process.exit(problems ? 1 : 0);
  }
  try {
    const n = notifs ? (await c.query(`delete from "Notification" where "entityId" = any($1::text[])`, [ids])).rowCount : 0;
    let d = 0;
    for (const t of targets) d += (await c.query(`delete from "Document" where id::text=$1 and "organizationId"::text=$2 and type=$3`, [t.id, t.org, t.type])).rowCount;
    console.log(`  deleted: documents ${d}, notifications ${n}`);
    if (d !== targets.length || n !== notifs) throw new Error('count mismatch');
    const counters1 = await q(`select "organizationId"::text org, "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId"::text = any($1::text[]) order by 1,2`, [[...new Set(targets.map((t) => t.org))]]);
    if (JSON.stringify(counters0) !== JSON.stringify(counters1)) throw new Error('a counter changed');
    for (const [org, list] of Object.entries(byOrg)) {
      await c.query(`insert into "ActionLog" (id,"actorType","actorId","actorName","organizationId",channel,action,resource,details,status,"createdAt") values ($1,'SYSTEM','system:abandoned-blank-docs-cleanup','System creation',$2,'operator','DELETE','Document',$3::jsonb,'SUCCESS',now())`, [require('crypto').randomUUID(), list[0].org, JSON.stringify({ deleted: list.map((t) => `${t.type} ${t.name ?? t.id}`), reason: 'blank documents created by the empty-list auto-create or an abandoned Create' })]);
    }
    await c.query('COMMIT');
    console.log(`\nAPPLIED: committed (+${Object.keys(byOrg).length} ActionLog rows).`);
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
