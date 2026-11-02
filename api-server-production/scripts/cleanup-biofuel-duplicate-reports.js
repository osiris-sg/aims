/**
 * Biofuel duplicate service reports (2026-11-02). While the field app's
 * Pending Sign list was empty (27 Oct - 2 Nov, fixed in 68002c52) the
 * technician re-wrote six unsigned drafts as new, signed reports. This removes
 * the six unsigned drafts; their signed twins stay.
 * DRY RUN by default (READ ONLY transaction):
 *   DBURL=<prod url, inline> NODE_PATH=$PWD/node_modules node scripts/cleanup-biofuel-duplicate-reports.js
 *   ... --apply --confirm-prod   (after the owner's go; one transaction + one ActionLog row)
 * Kept: ActionLog / AuditLog history, S3 photos, the report-number counter (gaps are fine).
 */
const { Client, types } = require('pg');
// Prisma stores UTC in "timestamp without time zone": read it as UTC.
types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));

const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const DELETE = [
  { no: 114, id: '1a173cef-8f9a-4247-be47-8b0849911748', twin: 119 },
  { no: 115, id: '6830e39d-1c7a-49f3-8c17-0d4d8f4e031e', twin: 119 },
  { no: 116, id: '1bc65893-2f28-4d5d-8e51-4d7554a36be6', twin: 119 },
  { no: 117, id: 'ec0ab2bb-737f-4bca-a074-5ad704d72b33', twin: 120 },
  { no: 118, id: '7bdb395d-d5ca-4988-8c99-84e145fd86b7', twin: 121 },
  { no: 122, id: '273bac88-3530-4611-b6a7-bab935c4707d', twin: 123 },
];
const KEEP = { 119: '089ae157', 120: '9ebf7bd5', 121: 'f07df60d', 123: 'f6ee6d22' };
const MODE = process.argv.includes('--apply') ? 'apply' : 'dry';
if (MODE === 'apply' && !process.argv.includes('--confirm-prod')) {
  console.error('--apply needs --confirm-prod');
  process.exit(1);
}

let problems = 0;
const out = (s = '') => console.log(s);
const stop = (why) => {
  problems++;
  out(`  !! STOP: ${why}`);
};
const day = (d) => (d ? new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' SGT' : '-');

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  await c.query(MODE === 'dry' ? 'BEGIN READ ONLY' : 'BEGIN');
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;
  const ids = DELETE.map((d) => d.id);
  out(`BIOFUEL DUPLICATE SERVICE REPORTS — ${MODE === 'dry' ? 'DRY RUN (read only; nothing is written)' : 'APPLY'}`);

  // ── 1. the six drafts ──
  out('\n== 1. Reports to delete');
  const cols = `id, "reportNumber", "organizationId", kind, status, "signedAt", "invoiceDocumentId", "deliveryId", "documentId", "inventoryId", "assetId", "technicianUserId", "technicianName", "createdAt", "serviceData"->>'serial' serial, "serviceData"->>'model' model, "serviceData"->>'serviceDate' "serviceDate", "serviceData"->>'nextServiceDate' "nextServiceDate", coalesce(array_length(photos, 1), 0) photos`;
  const rows = await q(`select ${cols} from "MaintenanceServiceReport" where id::text = any($1::text[])`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const twinNos = [...new Set(DELETE.map((d) => d.twin))];
  const twins = await q(`select ${cols} from "MaintenanceServiceReport" where "organizationId"=$1 and "reportNumber" = any($2::int[]) and kind='SERVICE'`, [BIOFUEL, twinNos]);
  const twinByNo = new Map(twins.map((t) => [t.reportNumber, t]));
  for (const d of DELETE) {
    const r = byId.get(d.id);
    if (!r) { stop(`#${d.no} ${d.id} not found`); continue; }
    out(`  #${r.reportNumber} ${r.id} ${r.kind} status=${r.status} signedAt=${r.signedAt ?? 'null'} invoice=${r.invoiceDocumentId ?? 'null'} delivery=${r.deliveryId ?? 'null'} document=${r.documentId ?? 'null'} org=${r.organizationId === BIOFUEL ? 'Biofuel' : r.organizationId}`);
    out(`      unit ${r.serial ?? '-'} (${r.model ?? '-'}) tech ${r.technicianName ?? '-'} written ${day(r.createdAt)} serviceDate ${r.serviceDate ?? '-'} next ${r.nextServiceDate ?? '-'} photos ${r.photos}`);
    if (r.reportNumber !== d.no) stop(`${d.id} is #${r.reportNumber}, not #${d.no}`);
    if (r.organizationId !== BIOFUEL) stop(`#${d.no} is not Biofuel's`);
    if (r.kind !== 'SERVICE') stop(`#${d.no} is ${r.kind}, not SERVICE`);
    if (r.status !== 'draft') stop(`#${d.no} status is ${r.status}, not draft`);
    if (r.signedAt) stop(`#${d.no} is signed`);
    if (r.invoiceDocumentId) stop(`#${d.no} has an invoice`);
    if (r.deliveryId) stop(`#${d.no} is on a delivery`);
    const t = twinByNo.get(d.twin);
    if (!t) { stop(`#${d.no}: twin #${d.twin} not found`); continue; }
    const sameUnit = (t.inventoryId && t.inventoryId === r.inventoryId) || (!t.inventoryId && t.serial && t.serial === r.serial);
    const sameTech = t.technicianUserId === r.technicianUserId;
    const sameDay = day(t.createdAt).slice(0, 10) === day(r.createdAt).slice(0, 10);
    const minutes = Math.round((t.createdAt - r.createdAt) / 60000);
    out(`      twin #${t.reportNumber}: same unit ${sameUnit}, same tech ${sameTech}, same day ${sameDay}, written ${minutes} min later`);
    if (!sameUnit || !sameTech || !sameDay || minutes < 0) stop(`#${d.no} and #${d.twin} are not same unit / tech / day, twin later`);
  }

  // ── 2. the four kept reports ──
  out('\n== 2. Reports kept (not touched)');
  for (const [no, prefix] of Object.entries(KEEP)) {
    const t = twinByNo.get(Number(no));
    out(`  #${no} ${t?.id ?? '(missing)'} status=${t?.status} signedAt=${t?.signedAt ? day(t.signedAt) : 'null'} unit ${t?.serial ?? '-'} next ${t?.nextServiceDate ?? '-'}`);
    if (!t || !t.id.startsWith(prefix)) stop(`#${no} is not ${prefix}…`);
    else if (t.status !== 'completed' || !t.signedAt) stop(`#${no} is not completed + signed`);
  }

  // ── 3. child rows ──
  out('\n== 3. Child rows');
  const pings = Number((await q(`select count(*)::int n from "DeliveryLocationPing" where "reportId"::text = any($1::text[])`, [ids]))[0].n);
  const signLinks = await q(`select id, "reportIds", "signedAt", "revokedAt" from "ServiceReportSignLink" where "organizationId"=$1 and "reportIds" && $2::text[]`, [BIOFUEL, ids]);
  const mixedLinks = signLinks.filter((l) => l.reportIds.some((x) => !ids.includes(x)));
  const shortLinks = await q(`select id, path from "ShortLink" where "organizationId"=$1 and (${ids.map((_, i) => `path like '%' || $${i + 2} || '%'`).join(' or ')})`, [BIOFUEL, ...ids]);
  const notes = Number((await q(`select count(*)::int n from "Notification" where "organizationId"=$1 and "entityId" = any($2::text[])`, [BIOFUEL, ids]))[0].n);
  out(`  DeliveryLocationPing: ${pings}`);
  out(`  ServiceReportSignLink (guest sign links): ${signLinks.length}${mixedLinks.length ? ` (${mixedLinks.length} also cover other reports)` : ''}`);
  out(`  ShortLink (WhatsApp /go/ links): ${shortLinks.length}`);
  out(`  Notification (bell): ${notes}`);
  if (mixedLinks.length) stop('a guest sign link also covers reports outside the six');
  // Every uuid / text column named *id / *Id in every table, for the six ids.
  const handled = /^(MaintenanceServiceReport\.id|DeliveryLocationPing\.reportId|Notification\.entityId|ActionLog\.resourceId|AuditLog\.resourceId)$/;
  const idCols = await q(`select table_name t, column_name col from information_schema.columns where table_schema='public' and data_type in ('uuid','text') and (column_name ilike '%id' or column_name ilike '%ids')`);
  const kept = [];
  for (const { t, col } of idCols) {
    let r = [];
    try {
      await c.query('SAVEPOINT s');
      r = await q(`select count(*)::int n from "${t}" where "${col}"::text = any($1::text[])`, [ids]);
      await c.query('RELEASE SAVEPOINT s');
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT s');
      continue;
    }
    if (!r[0].n) continue;
    const line = `${t}.${col}: ${r[0].n}`;
    if (/^(ActionLog|AuditLog)\./.test(`${t}.${col}`)) kept.push(line);
    else if (!handled.test(`${t}.${col}`)) { out(`  ${line}   <- NOT IN THE PLAN`); stop(`unexpected reference ${line}`); }
  }
  // JSON references (no FK): any document / report config naming one of the six.
  const jsonDocs = Number((await q(`select count(*)::int n from "Document" where "organizationId"=$1 and (${ids.map((_, i) => `config::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [BIOFUEL, ...ids]))[0].n);
  const jsonMsr = Number((await q(`select count(*)::int n from "MaintenanceServiceReport" where "organizationId"=$1 and not (id::text = any($2::text[])) and (${ids.map((_, i) => `"serviceData"::text like '%' || $${i + 3} || '%'`).join(' or ')})`, [BIOFUEL, ids, ...ids]))[0].n);
  out(`  Documents / other reports whose JSON names one of the six: ${jsonDocs} / ${jsonMsr}`);
  if (jsonDocs || jsonMsr) stop('a JSON field refers to one of the six');
  out(`  kept history: ${kept.join(', ') || 'none'}`);

  // ── 4. service history per unit ──
  out('\n== 4. Service history of the affected units (newest first; "next" = nextServiceDate)');
  const units = [...new Set(rows.map((r) => r.inventoryId || `serial:${r.serial}`))];
  for (const u of units) {
    const hist = await q(
      `select "reportNumber", status, "createdAt", "serviceData"->>'nextServiceDate' next, id from "MaintenanceServiceReport"
       where "organizationId"=$1 and kind='SERVICE' and ${u.startsWith('serial:') ? `"serviceData"->>'serial' = $2` : `"inventoryId"::text = $2`}
       order by "createdAt" desc limit 8`,
      [BIOFUEL, u.startsWith('serial:') ? u.slice(7) : u],
    );
    const serial = rows.find((r) => (r.inventoryId || `serial:${r.serial}`) === u)?.serial;
    out(`  unit ${serial ?? u}:`);
    for (const h of hist) out(`    #${h.reportNumber} ${h.status.padEnd(9)} ${day(h.createdAt)} next ${h.next ?? '-'}${ids.includes(h.id) ? '   <- deleted' : ''}`);
    const after = hist.filter((h) => !ids.includes(h.id));
    const latest = after[0];
    out(`    -> after the cleanup the latest is #${latest?.reportNumber} (${latest?.status}), next service ${latest?.next ?? '-'}`);
    if (!latest || latest.status !== 'completed') stop(`unit ${serial}: latest report after the cleanup is not a completed one`);
  }

  // ── 5. Pending Sign now / after ──
  const pending = await q(`select "reportNumber", id from "MaintenanceServiceReport" where "organizationId"=$1 and kind='SERVICE' and status='draft' and coalesce("serviceData"->>'scheduled','false') <> 'true' order by "reportNumber"`, [BIOFUEL]);
  out(`\n== 5. Biofuel Pending Sign: now ${pending.length} (${pending.map((p) => `#${p.reportNumber}`).join(' ')}); after: ${pending.filter((p) => !ids.includes(p.id)).length} (${pending.filter((p) => !ids.includes(p.id)).map((p) => `#${p.reportNumber}`).join(' ')})`);

  out('\n== PLAN (one transaction)');
  out(`  1. DELETE DeliveryLocationPing → ${pings}`);
  out(`  2. DELETE ServiceReportSignLink → ${signLinks.length}`);
  out(`  3. DELETE ShortLink → ${shortLinks.length}`);
  out(`  4. DELETE Notification → ${notes}`);
  out(`  5. DELETE MaintenanceServiceReport #${DELETE.map((d) => d.no).join(', #')} → 6`);
  out('  6. INSERT ActionLog "system:biofuel-duplicate-reports-cleanup"');
  out('  KEPT: Activity Log / audit history, S3 photos, the report-number counter (gaps fine), #119 #120 #121 #123.');

  if (MODE === 'dry' || problems) {
    out(`\n${problems ? `${problems} PROBLEM(S): nothing written` : 'No problems found.'}${MODE === 'dry' ? ' DRY RUN: nothing was written.' : ''}`);
    await c.query('ROLLBACK');
    await c.end();
    process.exit(problems ? 1 : 0);
  }
  try {
    const ops = [
      ['DeliveryLocationPing', `delete from "DeliveryLocationPing" where "reportId"::text = any($1::text[])`, [ids], pings],
      ['ServiceReportSignLink', `delete from "ServiceReportSignLink" where id = any($1::text[])`, [signLinks.map((l) => l.id)], signLinks.length],
      ['ShortLink', `delete from "ShortLink" where id = any($1::text[])`, [shortLinks.map((l) => l.id)], shortLinks.length],
      ['Notification', `delete from "Notification" where "organizationId"=$2 and "entityId" = any($1::text[])`, [ids, BIOFUEL], notes],
      ['MaintenanceServiceReport', `delete from "MaintenanceServiceReport" where "organizationId"=$2 and status='draft' and "signedAt" is null and "invoiceDocumentId" is null and "deliveryId" is null and id::text = any($1::text[])`, [ids, BIOFUEL], 6],
    ];
    out('\n== APPLY');
    for (const [label, sql, params, expected] of ops) {
      const r = await c.query(sql, params);
      out(`  ${label.padEnd(26)} deleted ${r.rowCount} (dry run: ${expected})`);
      if (r.rowCount !== expected) throw new Error(`${label}: deleted ${r.rowCount}, expected ${expected}`);
    }
    await c.query(
      `insert into "ActionLog" (id,"actorType","actorId","actorName","organizationId",channel,action,resource,details,status,"createdAt") values ($1,'SYSTEM','system:biofuel-duplicate-reports-cleanup','System creation',$2,'operator','DELETE','MaintenanceServiceReport',$3::jsonb,'SUCCESS',now())`,
      [require('crypto').randomUUID(), BIOFUEL, JSON.stringify({ deleted: DELETE.map((d) => ({ reportNumber: d.no, id: d.id, signedTwin: d.twin })), reason: 'unsigned drafts re-written as signed reports while Pending Sign was empty (27 Oct - 2 Nov)' })],
    );
    out('  ActionLog: 1 row (system:biofuel-duplicate-reports-cleanup)');
    await c.query('COMMIT');
    const after = await q(`select "reportNumber" from "MaintenanceServiceReport" where "organizationId"=$1 and kind='SERVICE' and status='draft' and coalesce("serviceData"->>'scheduled','false') <> 'true' order by "reportNumber"`, [BIOFUEL]);
    out(`\nAPPLIED: committed. Biofuel Pending Sign now ${after.length}: ${after.map((x) => `#${x.reportNumber}`).join(' ')}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    out(`\n!! ${e.message}. ROLLBACK: nothing written.`);
    process.exitCode = 1;
  }
  await c.end();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
