/**
 * WCT (S): import the Google Calendars of service@wct.com.sg into the AIMS jobs calendar. Re-runnable, dry run by
 * default. Owner decisions 2026-11-25: personal calendars and personal events are never imported; one-off events from
 * 1 Oct 2026; repeating events come in as repeating jobs / notes (CalendarSeries) with Google's exact rule, EXDATEs
 * and changed / moved occurrences (RECURRENCE-ID -> their own job / note, linked to the series), never capped.
 *
 * Reads the ICS files in scripts/gcal/wct-gcal-calendars.json (Google's Settings > Export zip; the calendars shared
 * with the account are read from the Schedule view into ICS by scripts/gcal/gcal-ui-to-ics.ts). An event becomes:
 *   - a JOB (Delivery; ❌ = cancelled) when its title has "Name @ Address" (or "Name. Address (job) - team"): customer
 *     (exact, then close match; a linked order's customer wins over a close match; else the Shop name only), site,
 *     job title, team / crew (Workers & Teams picks, the rest as typed), remarks (* * text, then the description),
 *     PTW (🔴 Bala / 🟡 Joyna / 🟢 Kherry = PTW needed with that applicant; ✋ 👍 👎), ⭕ postponed, 📌 sticker, 🟫 COD,
 *     salesperson = the calendar's AIMS user (config), order = ORD-Q-<no.> from a quotation no.;
 *   - a NOTE (CalendarNote): 📅 / the leave calendar = LEAVE, 🚫 = BLOCKAGE, anything else = OTHER (title as text).
 * ✅ (DO generated) is not imported: AIMS shows it from real DOs.
 *
 * Re-runs match by Google ids (one-offs and changed occurrences: the "gcal_import" custom field value on the job /
 * note; series: CalendarSeries.source.key): new -> create, changed -> update (rule and exceptions too), gone ->
 * listed (deleted only with --delete-missing). Jobs and notes NOT made by this import are never read or changed.
 * Writes go to WCT (S) only; one Activity Log row ("System creation") per record; nothing is sent to SiteClock.
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
import { IcsEvent, addDays, classify, customerIndex, leaveParts, matchCustomer, parseIcs, quotationNumbers, splitCrew, splitJob, stripDayCounter, takeMarks } from './gcal/gcal-title';
import { occurrences, parseRule, ruleText } from '../src/dashboard/recurrence';

const SCRIPT = 'system:wct-gcal-import';
const FIELD = 'gcal_import';
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const confirmProd = argv.includes('--confirm-prod');
const deleteMissing = argv.includes('--delete-missing');
const configPath = argv.includes('--config') ? argv[argv.indexOf('--config') + 1] : path.join(__dirname, 'gcal', 'wct-gcal-calendars.json');
const home = (p: string) => p.replace(/^~(?=\/)/, os.homedir());
const FAR = '2100-12-31';
/** Owner's per-event personal rule: no "Name @ Address" and a tuition / revision / birthday / family word. */
const PERSONAL = /\b(tuition|revision|revise|birthday|bday|family)\b|🎂/i;

type Cal = { name: string; file: string; include: boolean; personal?: boolean; why?: string; salesperson?: string | null; ptwApplicant?: string | null };
type Kind = 'job' | 'leave' | 'blockage' | 'general';
interface Rec {
  key: string; calendar: string; calendarId: string; eventId: string; lastUpdated: string | null; hash: string;
  kind: Kind; title: string; startDate: string; endDate: string; allDay: boolean; startTime: string | null; endTime: string | null;
  description: string; marks: string[]; name: string; address: string; jobTitle: string; team: string; remarks: string[];
  customer: { id: string; name: string; kind: string } | null; crew: { teams: any[]; workers: any[]; typed: string[] } | null; quotes: string[];
  order: { id: string; orderNumber: string } | null; staff: { id: string | null; name: string } | null; pattern: string;
  /** Series only. */
  series?: { rrule: string; exdates: string[]; exact: boolean; ruleType: string; durationMin: number | null };
  /** An occurrence of a series made its own record (RECURRENCE-ID): its series key and original day. */
  exceptionOf?: { seriesKey: string; originalDate: string };
  /** A repeating event's instance read from the Schedule view (no rule there): imported as a one-off. */
  uiRecurring?: boolean;
}

const sgToUtc = (date: string, time: string | null) => new Date(`${date}T${time ?? '00:00'}:00+08:00`);
const hashOf = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const minutes = (a: string | null, b: string | null, span: number) => {
  if (!a || !b) return null;
  const [h1, m1] = a.split(':').map(Number);
  const [h2, m2] = b.split(':').map(Number);
  const v = span * 1440 + h2 * 60 + m2 - (h1 * 60 + m1);
  return v > 0 ? v : null;
};
const ruleTypeOf = (rrule: string) => {
  const p = parseRule(rrule);
  const by = [p.byDay.length ? (p.byDay.some((b) => b.n !== null) || p.bySetPos.length ? 'BYDAY(nth)' : 'BYDAY') : '', p.byMonthDay.length ? 'BYMONTHDAY' : '', p.byMonth.length ? 'BYMONTH' : ''].filter(Boolean).join('+');
  return `${p.freq}${p.interval > 1 ? `/${p.interval}` : ''}${by ? ` ${by}` : ''}${p.count ? ' COUNT' : p.until ? ' UNTIL' : ' never'}`;
};

/**
 * The org's people by name (read only, no Clerk call: the local key is not prod's): the display names the Activity Log
 * recorded for the org's members, then the salesperson alias map ("Nee Meng" -> one user). name -> { id, how }.
 */
async function memberNames(q: (s: string, p?: any[]) => Promise<any[]>, org: string): Promise<{ byName: Map<string, string>; alias: Map<string, string> }> {
  const byName = new Map<string, string>();
  const rows = await q(
    `select distinct on (a."actorId") a."actorId" id, a."actorName" name from "ActionLog" a
       join "UserOrganization" u on u."userId" = a."actorId" and u."organizationId" = $1
      where a."actorType" = 'USER' and a."actorName" is not null order by a."actorId", a."createdAt" desc`,
    [org],
  );
  for (const r of rows) byName.set(String(r.name).replace(/\s+/g, ' ').trim().toLowerCase(), r.id);
  const alias = new Map<string, string>();
  const aliasRow = (await q(`select options from "CustomField" where "organizationId" = $1 and "entityType" = 'Quotation' and "fieldName" = 'salesperson_aliases'`, [org]))[0];
  for (const o of (aliasRow?.options as any[]) ?? []) if (o?.text && o.userIds?.length === 1) alias.set(String(o.text).replace(/\s+/g, ' ').trim().toLowerCase(), o.userIds[0]);
  return { byName, alias };
}

/** A full name -> its user: the recorded name, else an alias of the full name or of its first words ("Nee Meng"). */
function userByName(n: { byName: Map<string, string>; alias: Map<string, string> }, name: string): { id: string; how: string } | null {
  const k = name.replace(/\s+/g, ' ').trim().toLowerCase();
  if (n.byName.has(k)) return { id: n.byName.get(k)!, how: 'name in the Activity Log' };
  if (n.alias.has(k)) return { id: n.alias.get(k)!, how: 'salesperson alias' };
  const words = k.split(' ');
  for (let i = words.length - 1; i >= 1; i--) {
    const p = words.slice(0, i).join(' ');
    if (n.alias.has(p)) return { id: n.alias.get(p)!, how: `salesperson alias "${p}"` };
  }
  return null;
}

(async () => {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const ORG: string = cfg.organizationId;
  const FROM: string = cfg.from;
  if (ORG !== '5c700000-0000-4000-8000-5c7000000001') throw new Error('Refusing: imports go into WCT (S) only');
  const personalIncluded = (cfg.calendars as Cal[]).filter((c) => c.personal && c.include);
  if (personalIncluded.length) throw new Error(`Refusing: personal calendar(s) in the import list: ${personalIncluded.map((c) => c.name).join(', ')}`);
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
    const orders = new Map<string, any>((await q(`select o.id::text id, o."orderNumber", o."customerId"::text "customerId", cu.name "customerName" from "Order" o left join "Customer" cu on cu.id = o."customerId" where o."organizationId" = $1 and o."orderNumber" like 'ORD-Q-%'`, [ORG])).map((o) => [o.orderNumber, o]));
    const ptwRow = (await q(`select options from "CustomField" where "organizationId" = $1 and "entityType" = 'Delivery' and "fieldName" = 'ptw_applicants'`, [ORG]))[0];
    const applicants = new Map<string, { id: string; name: string }>(((ptwRow?.options as any[]) ?? []).map((e) => [String(e.name).toLowerCase(), { id: e.id, name: e.name }]));
    const names = await memberNames(q, ORG);
    const spOf = new Map<string, { id: string; name: string } | null>();
    const spMissing: string[] = [];
    const spFound: string[] = [];
    for (const cal of cfg.calendars as Cal[]) {
      if (!cal.salesperson) { spOf.set(cal.name, null); continue; }
      const u = userByName(names, cal.salesperson);
      spOf.set(cal.name, u ? { id: u.id, name: cal.salesperson } : null);
      if (u) spFound.push(`${cal.name} > ${cal.salesperson} (${u.how})`);
      else spMissing.push(`${cal.name} > ${cal.salesperson}`);
    }

    const buildRec = (e: IcsEvent, cal: Cal, calId: string, eventId: string, d: string, end: string): Rec => {
      const title = stripDayCounter(e.summary);
      const { marks, rest } = takeMarks(title.replace(/^\(From [^)]*\)\s*/, ''));
      const parts = splitJob(rest);
      const kind = classify(title, cal.name, parts) as Kind;
      const quotes = quotationNumbers(`${e.description}\n${title}`);
      const order = quotes.map((x) => orders.get(`ORD-${x}`)).find(Boolean) ?? null;
      let cm: { kind: string; customer: { id: string; name: string } | null } | null = kind === 'job' && parts.name ? matchCustomer(cIdx, parts.name) : null;
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
      r.hash = hashOf([r.kind, r.title, r.startDate, r.endDate, r.startTime, r.endTime, r.allDay, r.description, r.customer?.id, r.order?.id, r.crew, r.staff, spOf.get(cal.name)?.id, e.props['X-AIMS-HASH'] ?? e.lastModified]);
      return r;
    };

    // ── read the calendars ──
    const recs: Rec[] = [];
    const personal: Array<{ calendar: string; date: string; title: string }> = [];
    const skipped: Array<{ calendar: string; date: string; title: string; why: string }> = [];
    const perCal: Array<{ cal: Cal; events: number; missingFile?: boolean; calId: string }> = [];
    for (const cal of cfg.calendars as Cal[]) {
      if (!cal.include) { perCal.push({ cal, events: 0, calId: '' }); continue; }
      const file = path.join(dir, cal.file);
      if (!fs.existsSync(file)) { perCal.push({ cal, events: 0, missingFile: true, calId: '' }); continue; }
      const text = fs.readFileSync(file, 'utf8');
      const calId = (text.match(/^X-GCAL-CALENDAR-ID:(.*)$/m) || [])[1]?.trim() || cal.name;
      const evs = parseIcs(text);
      const masters = new Map(evs.filter((e) => e.rrule && !e.recurrenceId).map((e) => [e.uid, e]));
      const isPersonal = (e: IcsEvent) => !/\S\s*@\s*\S/.test(e.summary) && PERSONAL.test(e.summary);
      const seriesKeys = new Map<string, string>();
      for (const e of evs) {
        const span = Math.max(0, Math.round((Date.parse(e.endDate) - Date.parse(e.startDate)) / 86400000));
        if (e.rrule && !e.recurrenceId) {
          // A repeating event: a series when it still has an occurrence from FROM on (never capped).
          let next: string[] = [];
          try {
            next = occurrences(e.rrule, e.startDate, addDays(FROM, -span), FAR, e.exdates.map((x) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`)).slice(0, 1);
          } catch (err: any) {
            skipped.push({ calendar: cal.name, date: e.startDate, title: e.summary, why: `rule not understood: ${err?.message}` });
            continue;
          }
          if (!next.length) { skipped.push({ calendar: cal.name, date: e.startDate, title: e.summary, why: `repeating event that ended before ${FROM}` }); continue; }
          if (isPersonal(e)) { personal.push({ calendar: cal.name, date: e.startDate, title: `${e.summary} (repeating)` }); continue; }
          const r = buildRec(e, cal, calId, e.uid, e.startDate, e.endDate);
          const rrule = e.rrule.replace(/^RRULE:/i, '');
          const ex = e.exdates.map((x) => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`);
          // Cancelled single occurrences are skipped dates too.
          for (const o of evs) if (o.uid === e.uid && o.recurrenceId && o.status === 'CANCELLED') ex.push(`${o.recurrenceId.slice(0, 4)}-${o.recurrenceId.slice(4, 6)}-${o.recurrenceId.slice(6, 8)}`);
          r.series = { rrule, exdates: [...new Set(ex)].sort(), exact: !e.props['X-AIMS-HASH'], ruleType: ruleTypeOf(rrule), durationMin: e.allDay ? null : minutes(e.startTime, e.endTime, span) };
          r.hash = hashOf([r.hash, rrule, r.series.exdates]);
          seriesKeys.set(e.uid, r.key);
          recs.push(r);
          continue;
        }
        if (e.recurrenceId) {
          // A changed / moved occurrence of a series (Google's exception).
          const master = masters.get(e.uid);
          const originalDate = `${e.recurrenceId.slice(0, 4)}-${e.recurrenceId.slice(4, 6)}-${e.recurrenceId.slice(6, 8)}`;
          if (e.status === 'CANCELLED') continue;
          if (!master || !seriesKeys.has(e.uid)) {
            if (addDays(e.startDate, span) < FROM && originalDate < FROM) continue;
            if (!master) skipped.push({ calendar: cal.name, date: e.startDate, title: e.summary, why: 'changed occurrence of a series not in the export' });
            continue;
          }
          if (originalDate < FROM && e.startDate < FROM) continue;
          const r = buildRec(e, cal, calId, `${e.uid}_${e.recurrenceId}`, e.startDate, addDays(e.startDate, span));
          r.exceptionOf = { seriesKey: seriesKeys.get(e.uid)!, originalDate };
          recs.push(r);
          continue;
        }
        // One-off events from FROM on.
        if (addDays(e.startDate, span) < FROM) continue;
        if (isPersonal(e)) { personal.push({ calendar: cal.name, date: e.startDate, title: e.summary }); continue; }
        const r = buildRec(e, cal, calId, e.uid, e.startDate, addDays(e.startDate, span));
        // Read from the Schedule view: a repeating event's instance carries "_<yyyyMMdd>" (no rule there).
        if (e.props['X-AIMS-HASH'] && /_\d{8}(T\d{6}Z)?$/.test(e.uid)) r.uiRecurring = true;
        recs.push(r);
      }
      perCal.push({ cal, events: evs.length, calId });
    }
    // An exception must come after its series (the series' key decides).
    recs.sort((a, b) => Number(!!a.exceptionOf) - Number(!!b.exceptionOf));
    const dupKeys = recs.length - new Set(recs.map((r) => r.key)).size;
    if (dupKeys) throw new Error(`Refusing: ${dupKeys} events share a key`);

    // ── what was imported before ──
    const fieldIds: Record<string, string | null> = {};
    for (const ent of ['Delivery', 'CalendarNote']) fieldIds[ent] = (await q(`select id from "CustomField" where "organizationId" = $1 and "entityType" = $2 and "fieldName" = $3`, [ORG, ent, FIELD]))[0]?.id ?? null;
    const existing = new Map<string, { entity: string; entityId: string; hash: string; seriesId?: string }>();
    for (const ent of ['Delivery', 'CalendarNote']) {
      if (!fieldIds[ent]) continue;
      for (const v of await q(`select "entityId", value from "CustomFieldValue" where "customFieldId" = $1`, [fieldIds[ent]])) existing.set(v.value.key, { entity: ent, entityId: v.entityId, hash: v.value.hash });
    }
    for (const s of await q(`select id, kind, "templateId", source from "CalendarSeries" where "organizationId" = $1 and source ? 'key'`, [ORG]))
      existing.set(s.source.key, { entity: s.kind === 'JOB' ? 'Delivery' : 'CalendarNote', entityId: s.templateId, hash: s.source.hash, seriesId: s.id });
    const isJob = (r: Rec) => r.kind === 'job';
    const plan = { create: [] as Rec[], update: [] as Rec[], same: [] as Rec[], gone: [] as Array<{ key: string; entity: string; entityId: string; seriesId?: string }> };
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
    const one = recs.filter((r) => !r.series && !r.exceptionOf);
    const series = recs.filter((r) => r.series);
    const excs = recs.filter((r) => r.exceptionOf);
    console.log(`WCT (S) Google Calendar import: ${apply ? 'APPLY' : 'DRY RUN'}${deleteMissing ? ' (--delete-missing)' : ''}  (${new Date().toISOString()})`);
    console.log(`One-off events from ${FROM}; repeating events as series with Google's rule (no cap).`);
    console.log('Calendars:');
    for (const p of perCal) {
      const rs = recs.filter((r) => r.calendar === p.cal.name);
      const k = (x: string) => rs.filter((r) => r.kind === x && !r.series && !r.exceptionOf).length;
      const sp = p.cal.salesperson ? (spOf.get(p.cal.name) ? `salesperson ${p.cal.salesperson}` : `salesperson ${p.cal.salesperson} NOT FOUND`) : 'salesperson none';
      const pa = p.cal.ptwApplicant ? `, PTW applicant ${p.cal.ptwApplicant}${applicants.has(p.cal.ptwApplicant.toLowerCase()) ? '' : ' NOT FOUND'}` : '';
      if (!p.cal.include) console.log(`  ${p.cal.name.padEnd(30)} DROPPED${p.cal.personal ? ' (personal)' : ''}: ${p.cal.why ?? ''}`);
      else if (p.missingFile) console.log(`  ${p.cal.name.padEnd(30)} no events (${p.cal.why ?? 'no file'}); ${sp}${pa}`);
      else console.log(`  ${p.cal.name.padEnd(30)} ${String(rs.length).padStart(4)} records: one-off jobs ${k('job')}, leave ${k('leave')}, blockage ${k('blockage')}, general ${k('general')}, series ${rs.filter((r) => r.series).length}, exceptions ${rs.filter((r) => r.exceptionOf).length}; ${sp}${pa}`);
    }
    const jobs = recs.filter(isJob);
    const named = jobs.filter((r) => r.name);
    console.log(`Totals: one-off jobs ${one.filter(isJob).length}, one-off notes ${one.filter((r) => !isJob(r)).length} (leave ${one.filter((r) => r.kind === 'leave').length}, blockage ${one.filter((r) => r.kind === 'blockage').length}, general ${one.filter((r) => r.kind === 'general').length}), repeating series ${series.length}, exceptions ${excs.length}`);
    const byType: Record<string, number> = {};
    series.forEach((r) => (byType[`${r.series!.ruleType} (${r.series!.exact ? 'exact, ICS' : 'converted'})`] = (byType[`${r.series!.ruleType} (${r.series!.exact ? 'exact, ICS' : 'converted'})`] || 0) + 1));
    console.log(`Series by rule type: ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join('; ') || 'none'}`);
    for (const r of series) console.log(`  series [${r.calendar}] "${r.title.slice(0, 80)}" ${r.series!.exact ? 'EXACT (ICS)' : 'CONVERTED'}: ${r.series!.rrule} = ${ruleText(r.series!.rrule, r.startDate)}; exdates ${r.series!.exdates.length}`);
    const uiRec = recs.filter((r) => r.uiRecurring);
    console.log(`Instances of repeating events read from the Schedule view (no rule there), imported one by one: ${uiRec.length}${uiRec.length ? ` [${[...new Set(uiRec.map((r) => `${r.calendar}: ${r.title.slice(0, 50)}`))].join('; ')}]` : ''}`);
    console.log(`Customers (jobs with a name ${named.length}): from the linked order ${named.filter((r) => r.customer?.kind === 'order').length} (${pct(named.filter((r) => r.customer?.kind === 'order').length, named.length)}), exact ${named.filter((r) => r.customer?.kind === 'exact').length} (${pct(named.filter((r) => r.customer?.kind === 'exact').length, named.length)}), close ${named.filter((r) => r.customer?.kind === 'close').length} (${pct(named.filter((r) => r.customer?.kind === 'close').length, named.length)}), shop name only ${named.filter((r) => !r.customer).length}`);
    console.log(`Orders: jobs with a quotation no. ${jobs.filter((r) => r.quotes.length).length}, linked to an ORD-Q order ${jobs.filter((r) => r.order).length} (${pct(jobs.filter((r) => r.order).length, jobs.length)} of jobs)`);
    const typed: Record<string, number> = {};
    jobs.forEach((r) => r.crew?.typed.forEach((t) => (typed[t] = (typed[t] || 0) + 1)));
    console.log(`Crew kept as typed (not AIMS workers): ${Object.entries(typed).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
    console.log(`Salesperson users found: ${spFound.join('; ') || 'none'}`);
    console.log(`Salesperson users not found in WCT (S): ${spMissing.join('; ') || 'none'}`);
    console.log(`Calendars with no salesperson: ${(cfg.calendars as Cal[]).filter((x) => x.include && !x.salesperson).map((x) => x.name).join(', ')}`);
    console.log(`Personal events dropped (${personal.length}):`);
    for (const p of personal) console.log(`  [${p.calendar}] ${p.date} ${p.title}`);
    const skipCount: Record<string, number> = {};
    skipped.forEach((s) => (skipCount[`${s.calendar}: ${s.why}`] = (skipCount[`${s.calendar}: ${s.why}`] || 0) + 1));
    console.log(`Skipped: ${Object.entries(skipCount).map(([k, v]) => `${k} ${v}`).join('; ') || 'none'}`);
    console.log(`Plan: create ${plan.create.length}, update ${plan.update.length}, unchanged ${plan.same.length}, gone from Google ${plan.gone.length}${plan.gone.length ? (deleteMissing ? ' (deleted)' : ' (listed only; --delete-missing deletes)') : ''}`);
    console.log(`GUARD: personal calendars in the import list: ${personalIncluded.length}; the import deletes no quotation / order / DO / invoice (it writes Delivery, CalendarNote, CalendarSeries, CalendarSeriesException, CustomFieldValue, CustomField, ActionLog only).`);
    console.log('Samples (Google title > parsed):');
    const pick = [...jobs.filter((r) => r.order).slice(0, 3), ...jobs.filter((r) => r.customer?.kind === 'close').slice(0, 2), ...jobs.filter((r) => !r.customer && r.name).slice(0, 2), ...jobs.filter((r) => r.marks.length > 1).slice(0, 1), ...recs.filter((r) => r.kind === 'leave').slice(0, 1), ...recs.filter((r) => r.kind === 'general').slice(0, 1)];
    for (const r of pick.filter((x, i) => pick.findIndex((y) => y.key === x.key) === i))
      console.log(`  [${r.calendar}] ${r.startDate} "${r.title.slice(0, 110)}"\n     > ${r.kind}${r.kind === 'job' ? `: customer ${r.customer ? `${r.customer.name} (${r.customer.kind})` : `none, shop "${r.name}"`} | address ${r.address || '-'} | job ${r.jobTitle || '-'} | teams ${r.crew?.teams.map((t) => t.name).join(', ') || '-'} | workers ${r.crew?.workers.map((w) => w.name).join(', ') || '-'} | typed ${r.crew?.typed.join(', ') || '-'} | remarks ${r.remarks.join(' / ') || '-'} | marks ${r.marks.join(' ') || '-'} | order ${r.order?.orderNumber ?? '-'}` : r.staff ? `: staff ${r.staff.name}${r.staff.id ? '' : ' (not an AIMS worker)'}` : ''} | salesperson ${spOf.get(r.calendar)?.name ?? '-'}`);
    for (const g of plan.gone.slice(0, 20)) console.log(`  gone: ${g.entity} ${g.entityId} (${g.key})`);

    if (!apply) {
      await c.query('ROLLBACK');
      console.log('Dry run: nothing written. --apply --confirm-prod to write.');
      return;
    }

    // ── apply ──
    const now = new Date();
    const ensureField = async (ent: string, fieldName: string, label: string) => {
      const r = (await q(`select id from "CustomField" where "organizationId" = $1 and "entityType" = $2 and "fieldName" = $3`, [ORG, ent, fieldName]))[0];
      if (r) return r.id as string;
      const id = randomUUID();
      await c.query(
        `insert into "CustomField" (id, "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", required, "isActive", "showInList", "showInForm", "sortOrder", "createdAt", "updatedAt")
         values ($1, $2, $3, $4, $5, 'json', false, false, false, false, 0, $6, $6)`,
        [id, ORG, ent, fieldName, label, now],
      );
      return id;
    };
    const gField = { Delivery: await ensureField('Delivery', FIELD, 'Google Calendar import'), CalendarNote: await ensureField('CalendarNote', FIELD, 'Google Calendar import') };
    const sField = await ensureField('Delivery', 'job_calendar_style', 'Calendar style');
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
      const sp = spOf.get(r.calendar) ?? null;
      const app = r.marks.find((m) => m.startsWith('ptw:'));
      const a = app ? applicants.get(app.slice(4).toLowerCase()) : null;
      const crew = [...(r.crew?.teams ?? []).map((t) => ({ kind: 'team', id: t.id, name: t.name })), ...(r.crew?.workers ?? []).map((w) => ({ kind: 'worker', id: w.id, name: w.name }))].slice(0, 12);
      return {
        salespersonId: sp?.id ?? null, salespersonName: sp?.name ?? null, ptwApplicantId: a?.id ?? null, ptwApplicantName: a?.name ?? null,
        cod: r.marks.includes('cod'), postponed: r.marks.includes('postponed'), sticker: r.marks.includes('sticker'), createdById: null,
        team: r.crew?.typed.length ? r.crew.typed.join(' + ').slice(0, 120) : null, crew,
        calendarCancel: r.marks.includes('cancelled') ? { from: 'scheduled', at: now.toISOString(), byId: null } : null,
        shopName: r.name && r.customer?.kind !== 'exact' ? r.name.slice(0, 120) : null, jobTitle: r.jobTitle ? r.jobTitle.slice(0, 200) : null,
        postponedTo: null, postponedFrom: null, recordOnly: false,
      };
    };
    const noteType = (r: Rec) => (r.kind === 'leave' ? 'LEAVE' : r.kind === 'blockage' ? 'BLOCKAGE' : 'OTHER');

    const writeJob = async (r: Rec, id: string | null, draft: boolean) => {
      const fields = [r.marks.includes('cancelled') ? 'cancelled' : 'scheduled', sgToUtc(r.startDate, r.allDay ? null : r.startTime), r.allDay, r.customer?.id ?? null, (r.address || '').slice(0, 500) || null, notesText(r), ptwOf(r), r.order?.id ?? null];
      if (!id) {
        id = randomUUID();
        await c.query(
          `insert into "Delivery" (id, "organizationId", "deliveryNumber", status, "isDraft", "scheduledFor", "scheduledAllDay", "customerId", "siteAddress", notes, "ptwStatus", "orderId", "startedAt", "createdAt", "updatedAt")
           values ($1, $2, $3, $4::"DeliveryRunStatus", $13, $5, $6, $7::uuid, $8, $9, $10, $11::uuid, $12, $12, $12)`,
          [id, ORG, nextNo++, ...fields, now, draft],
        );
      } else {
        await c.query(
          `update "Delivery" set status = $3::"DeliveryRunStatus", "scheduledFor" = $4, "scheduledAllDay" = $5, "customerId" = $6::uuid, "siteAddress" = $7, notes = $8, "ptwStatus" = $9, "orderId" = $10::uuid, "updatedAt" = $11 where id = $1::uuid and "organizationId" = $2`,
          [id, ORG, ...fields, now],
        );
      }
      await upsertCfv(sField, 'Delivery', id, styleOf(r));
      // A series template carries its key on the series, not here (an occurrence made from it must not copy it).
      if (!r.series) await upsertCfv(gField.Delivery, 'Delivery', id, gValue(r));
      return id;
    };
    const writeNote = async (r: Rec, id: string | null) => {
      const fields = [stripDayCounter(r.title).slice(0, 300), noteType(r), r.staff?.id ?? null, r.staff?.name ?? null, r.startDate, r.endDate, r.allDay, r.allDay ? null : r.startTime, r.allDay ? null : r.endTime, [...r.remarks, r.description].filter(Boolean).join('\n').slice(0, 2000) || null];
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
      if (!r.series) await upsertCfv(gField.CalendarNote, 'CalendarNote', id, gValue(r));
      return id;
    };
    const seriesIdOf = new Map<string, string>(); // series key -> CalendarSeries.id
    for (const [k, v] of existing) if (v.seriesId) seriesIdOf.set(k, v.seriesId);
    const writeSeries = async (r: Rec, templateId: string, seriesId: string | null) => {
      const source = { key: r.key, calendarId: r.calendarId, calendarName: r.calendar, eventId: r.eventId, lastUpdated: r.lastUpdated, hash: r.hash, exact: r.series!.exact, importedAt: now.toISOString() };
      const vals = [r.series!.rrule, r.startDate, r.allDay ? null : r.startTime, r.series!.durationMin, r.series!.exdates, JSON.stringify(source)];
      if (!seriesId) {
        seriesId = randomUUID();
        await c.query(
          `insert into "CalendarSeries" (id, "organizationId", kind, "templateId", rrule, "startDate", "startTime", "durationMin", exdates, source, "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
          [seriesId, ORG, isJob(r) ? 'JOB' : 'NOTE', templateId, ...vals, now],
        );
      } else {
        await c.query(`update "CalendarSeries" set kind = $3, "templateId" = $4, rrule = $5, "startDate" = $6, "startTime" = $7, "durationMin" = $8, exdates = $9, source = $10, "updatedAt" = $11 where id = $1 and "organizationId" = $2`, [seriesId, ORG, isJob(r) ? 'JOB' : 'NOTE', templateId, ...vals, now]);
      }
      seriesIdOf.set(r.key, seriesId);
      return seriesId;
    };
    const linkException = async (r: Rec, recordId: string) => {
      const sid = seriesIdOf.get(r.exceptionOf!.seriesKey);
      if (!sid) return;
      await c.query(
        `insert into "CalendarSeriesException" (id, "organizationId", "seriesId", "originalDate", "recordId", "createdAt") values ($1, $2, $3, $4, $5, $6)
         on conflict ("seriesId", "originalDate") do update set "recordId" = excluded."recordId"`,
        [randomUUID(), ORG, sid, r.exceptionOf!.originalDate, recordId, now],
      );
    };
    const removeImported = async (g: { entity: string; entityId: string; seriesId?: string }) => {
      if (g.entity === 'Delivery') {
        const busy = await q(
          `select (select count(*) from "DeliveryItem" where "deliveryId" = $1::uuid)::int + (select count(*) from "MaintenanceServiceReport" where "deliveryId" = $1::uuid)::int + (select count(*) from "Delivery" where id = $1::uuid and "orderInvoiceId" is not null)::int n`,
          [g.entityId],
        );
        if (busy[0].n > 0) return false;
      }
      if (g.seriesId) {
        await c.query(`delete from "CalendarSeriesException" where "seriesId" = $1`, [g.seriesId]);
        await c.query(`delete from "CalendarSeries" where id = $1 and "organizationId" = $2`, [g.seriesId, ORG]);
      }
      await c.query(`delete from "CalendarSeriesException" where "recordId" = $1`, [g.entityId]);
      await c.query(`delete from "CustomFieldValue" where "entityId" = $1`, [g.entityId]);
      if (g.entity === 'Delivery') await c.query(`delete from "Delivery" where id = $1::uuid and "organizationId" = $2`, [g.entityId, ORG]);
      else await c.query(`delete from "CalendarNote" where id = $1 and "organizationId" = $2`, [g.entityId, ORG]);
      return true;
    };
    const write = async (r: Rec, ex: { entity: string; entityId: string; seriesId?: string } | null) => {
      let id: string;
      if (ex && (ex.entity === 'Delivery') !== isJob(r)) {
        // Job <-> note: the old record goes, a new one is made.
        if (!(await removeImported(ex))) return null;
        ex = null;
      }
      if (isJob(r)) id = await writeJob(r, ex?.entityId ?? null, !!r.series);
      else id = await writeNote(r, ex?.entityId ?? null);
      if (r.series) await writeSeries(r, id, ex?.seriesId ?? null);
      if (r.exceptionOf) await linkException(r, id);
      return id;
    };

    for (const r of [...plan.create, ...plan.update].sort((a, b) => Number(!!a.exceptionOf) - Number(!!b.exceptionOf))) {
      const ex = existing.get(r.key) ?? null;
      const id = await write(r, ex);
      if (!id) { log.push({ op: 'kept-kind-change', key: r.key }); continue; }
      await actionLog(isJob(r) ? 'deliveries' : 'calendar-notes', id, ex ? 'UPDATE' : 'CREATE', r, `${ex ? 'Updated' : 'Imported'} from Google Calendar${r.series ? ' (repeating)' : ''}`);
      log.push({ op: ex ? 'update' : 'create', id, key: r.key, kind: r.kind, series: !!r.series, exception: !!r.exceptionOf });
    }
    if (deleteMissing)
      for (const g of plan.gone) {
        const ok = await removeImported(g);
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
