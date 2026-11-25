/**
 * WCT (S): import the Google Calendars of service@wct.com.sg into the AIMS jobs calendar (owner 2026-11-25:
 * "assume it's all work, import the whole calendar"). Re-runnable. Dry run by default.
 *
 * Reads the ICS files named in scripts/gcal/wct-gcal-calendars.json (Google's Settings > Export zip, plus one ICS per
 * shared calendar made from the Schedule view by scripts/gcal/gcal-ui-to-ics.ts). Each event (recurring ones expanded
 * up to recurUntil) becomes:
 *   - a JOB (Delivery, status scheduled; ❌ = cancelled) when its title has "Name @ Address" (or "Name. Address (job)
 *     - team"): customer (exact, then close match on WCT (S) customers; else the name is kept as the Shop name),
 *     site address, job title, team / crew (Settings > Workers & Teams picks, the rest as typed), remarks (text
 *     between * *, then the description), PTW (🔴 Bala / 🟡 Joyna / 🟢 Kherry = PTW needed with that applicant;
 *     ✋ 👍 👎), ⭕ postponed, 📌 sticker, 🟫 COD, salesperson = the calendar (alias map), order = ORD-Q-<no.> when
 *     the description or title holds a quotation no.
 *   - a NOTE (CalendarNote): 📅 / the leave calendar = LEAVE, 🚫 = BLOCKAGE, anything else = OTHER (title as text).
 * ✅ (DO generated) is not imported: AIMS shows it from real DOs.
 *
 * Every imported job / note keeps { calendarId, eventId, lastUpdated, hash } in a storage-only custom field
 * (CustomField "gcal_import", inactive). Re-runs match on that key: new -> create, changed -> update, gone -> listed
 * (deleted only with --delete-missing). Jobs and notes NOT made by this import are never read or changed.
 * Writes go to WCT (S) only; one Activity Log row ("System creation") per record; no SiteClock sync.
 *
 *   npx ts-node --transpile-only scripts/wct-gcal-import.ts                                  # dry run (read only)
 *   npx ts-node --transpile-only scripts/wct-gcal-import.ts --apply --confirm-prod            # write
 *   ... --delete-missing      also delete imported records whose Google event is gone
 *   ... --config <file>       another calendar list
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from 'pg';
import { addDays, classify, customerIndex, expandRrule, leaveParts, matchCustomer, parseIcs, quotationNumbers, splitCrew, splitJob, stripDayCounter, takeMarks } from './gcal/gcal-title';

const SCRIPT = 'system:wct-gcal-import';
const FIELD = 'gcal_import';
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const confirmProd = argv.includes('--confirm-prod');
const deleteMissing = argv.includes('--delete-missing');
const configPath = argv.includes('--config') ? argv[argv.indexOf('--config') + 1] : path.join(__dirname, 'gcal', 'wct-gcal-calendars.json');
const home = (p: string) => p.replace(/^~(?=\/)/, os.homedir());

type Cal = { name: string; file: string; include: boolean; from?: string | null; why?: string; salespersonUserId?: string };
type Rec = {
  key: string; calendar: string; calendarId: string; eventId: string; lastUpdated: string | null; hash: string;
  kind: 'job' | 'leave' | 'blockage' | 'general'; title: string; startDate: string; endDate: string; allDay: boolean; startTime: string | null; endTime: string | null;
  description: string; marks: string[]; name: string; address: string; jobTitle: string; team: string; remarks: string[];
  customer: { id: string; name: string; kind: string } | null; crew: { teams: any[]; workers: any[]; typed: string[] } | null; quotes: string[];
  order: { id: string; orderNumber: string } | null; staff: { id: string | null; name: string } | null; pattern: string;
};

const sgToUtc = (date: string, time: string | null) => new Date(`${date}T${time ?? '00:00'}:00+08:00`);
const hashOf = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);

(async () => {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const ORG: string = cfg.organizationId;
  if (ORG !== '5c700000-0000-4000-8000-5c7000000001') throw new Error('Refusing: imports go into WCT (S) only');
  const dir = home(cfg.exportDir);
  const url = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('PROD_DATABASE_URL is not set in .env');
  if (apply && !confirmProd) throw new Error('Writing on prod needs --apply --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  let committed = false;
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');

    // ── AIMS lists (WCT (S)) ──
    const customers = await q(`select id::text id, name, "customerCode" from "Customer" where "organizationId" = $1`, [ORG]);
    const cIdx = customerIndex(customers);
    const workers = await q(`select id, name, "siteclockId" from "Worker" where "organizationId" = $1 and active`, [ORG]);
    const teams = await q(`select id, name from "WorkerTeam" where "organizationId" = $1 and active`, [ORG]);
    const orders = new Map((await q(`select o.id::text id, o."orderNumber", o."customerId"::text "customerId", cu.name "customerName" from "Order" o left join "Customer" cu on cu.id = o."customerId" where o."organizationId" = $1 and o."orderNumber" like 'ORD-Q-%'`, [ORG])).map((o) => [o.orderNumber, o]));
    const aliasRow = (await q(`select options from "CustomField" where "organizationId" = $1 and "entityType" = 'Quotation' and "fieldName" = 'salesperson_aliases'`, [ORG]))[0];
    const alias = new Map<string, string>();
    for (const o of (aliasRow?.options as any[]) ?? []) if (o?.text && o.userIds?.length === 1 && !alias.has(String(o.text).trim().toLowerCase())) alias.set(String(o.text).trim().toLowerCase(), o.userIds[0]);
    const ptwRow = (await q(`select options from "CustomField" where "organizationId" = $1 and "entityType" = 'Delivery' and "fieldName" = 'ptw_applicants'`, [ORG]))[0];
    const applicants = new Map<string, { id: string; name: string }>(((ptwRow?.options as any[]) ?? []).map((e) => [String(e.name).toLowerCase(), { id: e.id, name: e.name }]));

    // ── read the calendars ──
    const recs: Rec[] = [];
    const perCal: Array<{ name: string; include: boolean; why?: string; file: string; events: number; inRange: number; older: number; missingFile?: boolean; calId: string }> = [];
    for (const cal of cfg.calendars as Cal[]) {
      const file = path.join(dir, cal.file);
      if (!cal.include) { perCal.push({ name: cal.name, include: false, why: cal.why, file: cal.file, events: 0, inRange: 0, older: 0, calId: '' }); continue; }
      if (!fs.existsSync(file)) { perCal.push({ name: cal.name, include: true, file: cal.file, events: 0, inRange: 0, older: 0, missingFile: true, calId: '' }); continue; }
      const text = fs.readFileSync(file, 'utf8');
      const calId = (text.match(/^X-GCAL-CALENDAR-ID:(.*)$/m) || [])[1]?.trim() || (text.match(/^X-WR-CALNAME:(.*)$/m) || [])[1]?.trim() || cal.name;
      const evs = parseIcs(text);
      const from: string | null = cal.from === undefined ? cfg.from : cal.from;
      let inRange = 0, older = 0;
      // Overridden instances of a recurring series (RECURRENCE-ID) replace the generated ones.
      const overrides = new Set(evs.filter((e) => e.recurrenceId).map((e) => `${e.uid}_${e.recurrenceId}`));
      for (const e of evs) {
        const dates = e.rrule ? expandRrule(e.startDate, e.rrule, cfg.recurUntil).filter((d) => !e.exdates.includes(d.replace(/-/g, '')) && !overrides.has(`${e.uid}_${d.replace(/-/g, '')}`)) : [e.startDate];
        const span = Math.round((Date.parse(e.endDate) - Date.parse(e.startDate)) / 86400000);
        for (const d of dates) {
          const end = addDays(d, span);
          if (from && end < from) continue;
          if (cfg.from && end < cfg.from) older++;
          else inRange++;
          const eventId = e.rrule ? `${e.uid}_${d.replace(/-/g, '')}` : e.recurrenceId ? `${e.uid}_${e.recurrenceId}` : e.uid;
          const title = stripDayCounter(e.summary);
          const { marks, rest } = takeMarks(title.replace(/^\(From [^)]*\)\s*/, ''));
          const parts = splitJob(rest);
          const kind = classify(title, cal.name, parts);
          const quotes = quotationNumbers(`${e.description}\n${title}`);
          const order = quotes.map((x) => orders.get(`ORD-${x}`)).find(Boolean) ?? null;
          let cm: { kind: string; customer: { id: string; name: string } | null } | null = kind === 'job' && parts.name ? matchCustomer(cIdx, parts.name) : null;
          // The linked order's customer wins over a close / missing name match.
          if (kind === 'job' && order?.customerId && cm?.kind !== 'exact') cm = { kind: 'order', customer: { id: order.customerId, name: order.customerName } };
          let staff: Rec['staff'] = null;
          if (kind === 'leave') {
            const lp = leaveParts(title);
            const w = workers.find((x) => x.name.toLowerCase() === lp.staff.toLowerCase()) ?? workers.find((x) => x.name.toLowerCase().split(' ')[0] === lp.staff.toLowerCase());
            staff = { id: w?.siteclockId ?? null, name: w?.name ?? lp.staff };
          }
          const r: Rec = {
            key: `${calId}|${eventId}`, calendar: cal.name, calendarId: calId, eventId, lastUpdated: e.lastModified, hash: '',
            kind, title, startDate: d, endDate: end, allDay: e.allDay, startTime: e.startTime, endTime: e.endTime, description: e.description,
            marks, name: parts.name, address: parts.address || e.location, jobTitle: parts.jobTitle, team: parts.team, remarks: parts.remarks,
            customer: cm?.customer ? { id: cm.customer.id, name: cm.customer.name, kind: cm.kind } : null,
            crew: kind === 'job' ? splitCrew(parts.team, workers, teams) : null, quotes, order: order ?? null, staff, pattern: parts.pattern,
          };
          r.hash = hashOf([r.kind, r.title, r.startDate, r.endDate, r.startTime, r.endTime, r.allDay, r.description, r.customer?.id, r.order?.id, r.crew, r.staff, e.props['X-AIMS-HASH'] ?? e.lastModified]);
          recs.push(r);
        }
      }
      perCal.push({ name: cal.name, include: true, file: cal.file, events: evs.length, inRange, older, calId });
    }
    const dupKeys = recs.length - new Set(recs.map((r) => r.key)).size;
    if (dupKeys) throw new Error(`Refusing: ${dupKeys} events share a key`);

    // ── what was imported before (only rows carrying the gcal_import value) ──
    const fieldIds: Record<string, string | null> = {};
    for (const ent of ['Delivery', 'CalendarNote']) fieldIds[ent] = (await q(`select id from "CustomField" where "organizationId" = $1 and "entityType" = $2 and "fieldName" = $3`, [ORG, ent, FIELD]))[0]?.id ?? null;
    const existing = new Map<string, { entity: string; entityId: string; hash: string; cfvId: string }>();
    for (const ent of ['Delivery', 'CalendarNote']) {
      if (!fieldIds[ent]) continue;
      for (const v of await q(`select id, "entityId", value from "CustomFieldValue" where "customFieldId" = $1`, [fieldIds[ent]])) existing.set(v.value.key, { entity: ent, entityId: v.entityId, hash: v.value.hash, cfvId: v.id });
    }
    const isJob = (r: Rec) => r.kind === 'job';
    const plan = { create: [] as Rec[], update: [] as Rec[], same: [] as Rec[], gone: [] as Array<{ key: string; entity: string; entityId: string }> };
    const seen = new Set<string>();
    for (const r of recs) {
      seen.add(r.key);
      const ex = existing.get(r.key);
      if (!ex) plan.create.push(r);
      else if (ex.hash !== r.hash || (ex.entity === 'Delivery') !== isJob(r)) plan.update.push(r);
      else plan.same.push(r);
    }
    for (const [key, ex] of existing) if (!seen.has(key)) plan.gone.push({ key, ...ex });

    // ── print ──
    const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
    console.log(`WCT (S) Google Calendar import: ${apply ? 'APPLY' : 'DRY RUN'}${deleteMissing ? ' (--delete-missing)' : ''}  (${new Date().toISOString()})`);
    console.log(`Range: from ${cfg.from} (per-calendar overrides below), recurring events expanded up to ${cfg.recurUntil}`);
    console.log('Calendars:');
    for (const p of perCal) {
      const rs = recs.filter((r) => r.calendar === p.name);
      const k = (x: string) => rs.filter((r) => r.kind === x).length;
      console.log(`  ${p.name.padEnd(30)} ${!p.include ? `LEFT OUT: ${p.why}` : p.missingFile ? `NO FILE ${p.file}` : `${String(rs.length).padStart(4)} records (jobs ${k('job')}, leave ${k('leave')}, blockage ${k('blockage')}, general ${k('general')})${p.older ? `, of which before ${cfg.from}: ${p.older}` : ''}`}`);
    }
    const jobs = recs.filter(isJob);
    const named = jobs.filter((r) => r.name);
    console.log(`Totals: ${recs.length} records: jobs ${jobs.length}, leave ${recs.filter((r) => r.kind === 'leave').length}, blockage ${recs.filter((r) => r.kind === 'blockage').length}, general ${recs.filter((r) => r.kind === 'general').length}`);
    console.log(`Customers (jobs with a name ${named.length}): from the linked order ${named.filter((r) => r.customer?.kind === 'order').length} (${pct(named.filter((r) => r.customer?.kind === 'order').length, named.length)}), exact ${named.filter((r) => r.customer?.kind === 'exact').length} (${pct(named.filter((r) => r.customer?.kind === 'exact').length, named.length)}), close ${named.filter((r) => r.customer?.kind === 'close').length} (${pct(named.filter((r) => r.customer?.kind === 'close').length, named.length)}), shop name only ${named.filter((r) => !r.customer).length}`);
    console.log(`Orders: jobs with a quotation no. ${jobs.filter((r) => r.quotes.length).length}, linked to an ORD-Q order ${jobs.filter((r) => r.order).length} (${pct(jobs.filter((r) => r.order).length, jobs.length)} of jobs); quotation no. with no order: ${[...new Set(jobs.filter((r) => r.quotes.length && !r.order).flatMap((r) => r.quotes))].slice(0, 15).join(', ')}`);
    const typed: Record<string, number> = {};
    jobs.forEach((r) => r.crew?.typed.forEach((t) => (typed[t] = (typed[t] || 0) + 1)));
    console.log(`Crew: jobs with a team / worker matched ${jobs.filter((r) => r.crew && (r.crew.teams.length || r.crew.workers.length)).length}; kept as typed: ${Object.entries(typed).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const spNames = [...new Set(recs.map((r) => r.calendar))];
    const sp = (name: string) => (cfg.calendars as Cal[]).find((x) => x.name === name)?.salespersonUserId ?? alias.get(name.toLowerCase()) ?? null;
    console.log(`Salesperson (calendar -> AIMS user): ${spNames.map((n) => `${n} ${sp(n) ? 'yes' : 'NO (name kept in the import data only)'}`).join('; ')}`);
    console.log(`Plan: create ${plan.create.length}, update ${plan.update.length}, unchanged ${plan.same.length}, gone from Google ${plan.gone.length}${plan.gone.length ? (deleteMissing ? ' (deleted)' : ' (listed only; --delete-missing deletes)') : ''}`);
    console.log('Samples (Google title > parsed):');
    const pick = [...jobs.filter((r) => r.order).slice(0, 3), ...jobs.filter((r) => r.customer?.kind === 'close').slice(0, 2), ...jobs.filter((r) => !r.customer).slice(0, 2), ...jobs.filter((r) => r.marks.length > 1).slice(0, 1), ...recs.filter((r) => r.kind === 'leave').slice(0, 1), ...recs.filter((r) => r.kind === 'general').slice(0, 1)];
    for (const r of pick.filter((x, i) => pick.findIndex((y) => y.key === x.key) === i))
      console.log(`  [${r.calendar}] ${r.startDate} "${r.title.slice(0, 110)}"\n     > ${r.kind}${r.kind === 'job' ? `: customer ${r.customer ? `${r.customer.name} (${r.customer.kind})` : `none, shop "${r.name}"`} | address ${r.address || '-'} | job ${r.jobTitle || '-'} | teams ${r.crew?.teams.map((t) => t.name).join(', ') || '-'} | workers ${r.crew?.workers.map((w) => w.name).join(', ') || '-'} | typed ${r.crew?.typed.join(', ') || '-'} | remarks ${r.remarks.join(' / ') || '-'} | marks ${r.marks.join(' ') || '-'} | order ${r.order?.orderNumber ?? '-'}` : r.staff ? `: staff ${r.staff.name}${r.staff.id ? '' : ' (not an AIMS worker)'}` : ''} | salesperson ${r.calendar}`);
    for (const g of plan.gone.slice(0, 20)) console.log(`  gone: ${g.entity} ${g.entityId} (${g.key})`);

    if (!apply) {
      await c.query('ROLLBACK');
      console.log('Dry run: nothing written. --apply --confirm-prod to write.');
      return;
    }

    // ── apply ──
    const now = new Date();
    const ensureField = async (ent: string) => {
      if (fieldIds[ent]) return fieldIds[ent]!;
      const id = randomUUID();
      await c.query(
        `insert into "CustomField" (id, "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", required, "isActive", "showInList", "showInForm", "sortOrder", "createdAt", "updatedAt")
         values ($1, $2, $3, $4, 'Google Calendar import', 'json', false, false, false, false, 0, $5, $5)`,
        [id, ORG, ent, FIELD, now],
      );
      return (fieldIds[ent] = id);
    };
    const styleField = async () => {
      const r = (await q(`select id from "CustomField" where "organizationId" = $1 and "entityType" = 'Delivery' and "fieldName" = 'job_calendar_style'`, [ORG]))[0];
      if (r) return r.id as string;
      const id = randomUUID();
      await c.query(
        `insert into "CustomField" (id, "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", required, "isActive", "showInList", "showInForm", "sortOrder", "createdAt", "updatedAt")
         values ($1, $2, 'Delivery', 'job_calendar_style', 'Calendar style', 'json', false, false, false, false, 0, $3, $3)`,
        [id, ORG, now],
      );
      return id;
    };
    const gField = { Delivery: await ensureField('Delivery'), CalendarNote: await ensureField('CalendarNote') };
    const sField = await styleField();
    let nextNo = Number((await q(`select coalesce(max("deliveryNumber"), 0) n from "Delivery" where "organizationId" = $1`, [ORG]))[0].n) + 1;
    const log: any[] = [];
    const actionLog = (resource: string, id: string, action: string, r: Rec | null, note: string) =>
      c.query(
        `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
         values ($1, 'SYSTEM', $2, 'System creation', $3, 'script', $4, $5, $6, $7, 'SUCCESS', $8)`,
        [randomUUID(), SCRIPT, ORG, action, resource, id, JSON.stringify({ note, google: r ? { calendar: r.calendar, eventId: r.eventId, title: r.title } : undefined }), now],
      );
    const gValue = (r: Rec) => ({ key: r.key, calendarId: r.calendarId, calendarName: r.calendar, eventId: r.eventId, lastUpdated: r.lastUpdated, hash: r.hash, title: r.title, marks: r.marks, importedAt: now.toISOString() });
    const upsertCfv = (fieldId: string, ent: string, entityId: string, value: unknown) =>
      c.query(
        `insert into "CustomFieldValue" (id, "customFieldId", "entityId", "entityType", value, "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, $6, $6)
         on conflict ("customFieldId", "entityId") do update set value = excluded.value, "updatedAt" = excluded."updatedAt"`,
        [randomUUID(), fieldId, entityId, ent, JSON.stringify(value), now],
      );
    const notesText = (r: Rec) => [...r.remarks, r.description].map((x) => x.trim()).filter(Boolean).join('\n').slice(0, 2000) || null;
    const ptwOf = (r: Rec) => {
      if (r.marks.includes('ptwApproved')) return 'APPROVED';
      if (r.marks.includes('ptwRejected')) return 'REJECTED';
      if (r.marks.includes('ptwPending') || r.marks.some((m) => m.startsWith('ptw:'))) return 'REQUIRED';
      return null;
    };
    const styleOf = (r: Rec) => {
      const spId = sp(r.calendar);
      const app = r.marks.find((m) => m.startsWith('ptw:'));
      const a = app ? applicants.get(app.slice(4).toLowerCase()) : null;
      const crew = [...(r.crew?.teams ?? []).map((t) => ({ kind: 'team', id: t.id, name: t.name })), ...(r.crew?.workers ?? []).map((w) => ({ kind: 'worker', id: w.id, name: w.name }))].slice(0, 12);
      return {
        salespersonId: spId, salespersonName: spId ? r.calendar : null, ptwApplicantId: a?.id ?? null, ptwApplicantName: a?.name ?? null,
        cod: r.marks.includes('cod'), postponed: r.marks.includes('postponed'), sticker: r.marks.includes('sticker'), createdById: null,
        team: r.crew?.typed.length ? r.crew.typed.join(' + ').slice(0, 120) : null, crew,
        calendarCancel: r.marks.includes('cancelled') ? { from: 'scheduled', at: now.toISOString(), byId: null } : null,
        shopName: r.name && r.customer?.kind !== 'exact' ? r.name.slice(0, 120) : null, jobTitle: r.jobTitle ? r.jobTitle.slice(0, 200) : null,
        postponedTo: null, postponedFrom: null, recordOnly: false,
      };
    };
    const noteType = (r: Rec) => (r.kind === 'leave' ? 'LEAVE' : r.kind === 'blockage' ? 'BLOCKAGE' : 'OTHER');
    const hhmm = (t: string | null) => t;

    const writeJob = async (r: Rec, id: string | null) => {
      const fields = [r.marks.includes('cancelled') ? 'cancelled' : 'scheduled', sgToUtc(r.startDate, r.allDay ? null : r.startTime), r.allDay, r.customer?.id ?? null, (r.address || '').slice(0, 500) || null, notesText(r), ptwOf(r), r.order?.id ?? null];
      if (!id) {
        id = randomUUID();
        await c.query(
          `insert into "Delivery" (id, "organizationId", "deliveryNumber", status, "isDraft", "scheduledFor", "scheduledAllDay", "customerId", "siteAddress", notes, "ptwStatus", "orderId", "startedAt", "createdAt", "updatedAt")
           values ($1, $2, $3, $4::"DeliveryRunStatus", false, $5, $6, $7::uuid, $8, $9, $10, $11::uuid, $12, $12, $12)`,
          [id, ORG, nextNo++, ...fields, now],
        );
      } else {
        await c.query(
          `update "Delivery" set status = $3::"DeliveryRunStatus", "scheduledFor" = $4, "scheduledAllDay" = $5, "customerId" = $6::uuid, "siteAddress" = $7, notes = $8, "ptwStatus" = $9, "orderId" = $10::uuid, "updatedAt" = $11 where id = $1::uuid and "organizationId" = $2`,
          [id, ORG, ...fields, now],
        );
      }
      await upsertCfv(sField, 'Delivery', id, styleOf(r));
      await upsertCfv(gField.Delivery, 'Delivery', id, gValue(r));
      return id;
    };
    const writeNote = async (r: Rec, id: string | null) => {
      const fields = [stripDayCounter(r.title).slice(0, 300), noteType(r), r.staff?.id ?? null, r.staff?.name ?? null, r.startDate, r.endDate, r.allDay, r.allDay ? null : hhmm(r.startTime), r.allDay ? null : hhmm(r.endTime), [...r.remarks, r.description].filter(Boolean).join('\n').slice(0, 2000) || null];
      if (!id) {
        id = randomUUID();
        await c.query(
          `insert into "CalendarNote" (id, "organizationId", title, type, "staffId", "staffName", "startDate", "endDate", "allDay", "startTime", "endTime", remark, "createdByName", "createdAt", "updatedAt")
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Google Calendar import', $13, $13)`,
          [id, ORG, ...fields, now],
        );
      } else {
        await c.query(
          `update "CalendarNote" set title = $3, type = $4, "staffId" = $5, "staffName" = $6, "startDate" = $7, "endDate" = $8, "allDay" = $9, "startTime" = $10, "endTime" = $11, remark = $12, "updatedAt" = $13 where id = $1 and "organizationId" = $2`,
          [id, ORG, ...fields, now],
        );
      }
      await upsertCfv(gField.CalendarNote, 'CalendarNote', id, gValue(r));
      return id;
    };
    const removeImported = async (entity: string, entityId: string) => {
      if (entity === 'Delivery') {
        // Only a job this import made and that nothing was added to (no lines, DOs, reports, invoice).
        const busy = await q(
          `select (select count(*) from "DeliveryItem" where "deliveryId" = $1::uuid)::int + (select count(*) from "MaintenanceServiceReport" where "deliveryId" = $1::uuid)::int + (select count(*) from "Delivery" where id = $1::uuid and "orderInvoiceId" is not null)::int n`,
          [entityId],
        );
        if (busy[0].n > 0) return false;
        await c.query(`delete from "CustomFieldValue" where "entityId" = $1`, [entityId]);
        await c.query(`delete from "Delivery" where id = $1::uuid and "organizationId" = $2`, [entityId, ORG]);
      } else {
        await c.query(`delete from "CustomFieldValue" where "entityId" = $1`, [entityId]);
        await c.query(`delete from "CalendarNote" where id = $1 and "organizationId" = $2`, [entityId, ORG]);
      }
      return true;
    };

    for (const r of plan.create) {
      const id = isJob(r) ? await writeJob(r, null) : await writeNote(r, null);
      await actionLog(isJob(r) ? 'deliveries' : 'calendar-notes', id, 'CREATE', r, 'Imported from Google Calendar');
      log.push({ op: 'create', id, key: r.key, kind: r.kind });
    }
    for (const r of plan.update) {
      const ex = existing.get(r.key)!;
      let id: string;
      if ((ex.entity === 'Delivery') !== isJob(r)) {
        // Job <-> note: the old record goes, a new one is made.
        if (!(await removeImported(ex.entity, ex.entityId))) { log.push({ op: 'kept-kind-change', id: ex.entityId, key: r.key }); continue; }
        id = isJob(r) ? await writeJob(r, null) : await writeNote(r, null);
      } else id = isJob(r) ? await writeJob(r, ex.entityId) : await writeNote(r, ex.entityId);
      await actionLog(isJob(r) ? 'deliveries' : 'calendar-notes', id, 'UPDATE', r, 'Updated from Google Calendar');
      log.push({ op: 'update', id, key: r.key, kind: r.kind });
    }
    if (deleteMissing)
      for (const g of plan.gone) {
        const ok = await removeImported(g.entity, g.entityId);
        if (ok) await actionLog(g.entity === 'Delivery' ? 'deliveries' : 'calendar-notes', g.entityId, 'DELETE', null, `Google event gone (${g.key})`);
        log.push({ op: ok ? 'delete' : 'kept-busy', id: g.entityId, key: g.key });
      }
    await c.query('COMMIT');
    committed = true;
    const logDir = path.join(os.homedir(), 'Desktop', 'aims-agents', 'logs', 'wct');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `wct-gcal-import-APPLY-${now.toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(logFile, JSON.stringify(log, null, 1));
    console.log(`Database: committed. ${log.length} writes, log ${logFile}`);
  } catch (e) {
    if (!committed) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
