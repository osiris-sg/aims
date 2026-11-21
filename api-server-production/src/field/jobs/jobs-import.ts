/**
 * Field > Plan > Upload schedule (FIELD_PLAN.md phase 2). The parser is siteclock @62b7d9d
 * src/modules/jobs/jobs-import.ts as it is (columns, header guessing, dates, times, clocking, blank date = the row
 * above, CSV); the resolver is src/lib/jobs-plan.ts planDayJobs / resolveTeam / resolveJobWorker over AIMS rows.
 *
 * Differences, both forced by AIMS having one job list (the calendar):
 *  - "Client / job" must name an AIMS customer (a calendar job needs one); no customer is ever created here.
 *  - Only "add". SiteClock's "replace" deletes the day's jobs; in AIMS that would delete calendar jobs, so it is
 *    not offered (FIELD_PLAN.md, feature list: partial).
 */
import * as ExcelJS from 'exceljs';
import { DateTime } from 'luxon';
import { addDays } from '../common/time';
import { findPlace, teamMembersOn, type Place } from './jobs-lib';

type Db = any;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export type Clocking = 'OFF' | 'ARRIVE' | 'ARRIVE_LEAVE';

export const IMPORT_COLUMNS = [
  { key: 'date', header: 'Date', hint: 'yyyy-mm-dd or dd/mm/yyyy. Leave blank to repeat the row above.' },
  { key: 'time', header: 'Start', hint: 'HH:mm (24h), e.g. 08:30 or 14:00. Optional.' },
  { key: 'title', header: 'Client / job', hint: 'The customer, as it is in AIMS Customers.' },
  { key: 'location', header: 'Address or site', hint: 'The place as workers should see it, or the exact name of one of your sites.' },
  { key: 'search', header: 'Postal code', hint: '6-digit postal code (or building / street) so the map can find it. Not needed for your own sites.' },
  { key: 'description', header: 'Work', hint: 'What is to be done. Optional.' },
  { key: 'instructions', header: 'Instructions', hint: 'Who to call, what to bring. Optional.' },
  { key: 'teams', header: 'Teams', hint: 'Team names, comma-separated, e.g. Team A, Team B. The whole team goes on the job.' },
  { key: 'workers', header: 'Workers', hint: 'Individual workers by name, employee no. or phone, comma-separated. Not needed for people already in a named team.' },
  { key: 'exceptWorkers', header: 'Leave out', hint: 'Members of the named teams who are NOT on this job.' },
  { key: 'clocking', header: 'Clocking', hint: 'Blank = company rule. Or: off, in, in and out.' },
  { key: 'qrRequired', header: 'QR', hint: 'yes = workers must scan the job\'s QR code there.' },
] as const;
type Key = (typeof IMPORT_COLUMNS)[number]['key'];

export type PlanRow = {
  time?: string | null;
  title?: string | null;
  location?: string | null;
  search?: string | null;
  description?: string | null;
  instructions?: string | null;
  teams?: string[];
  workers?: string[];
  exceptWorkers?: string[];
  clocking?: Clocking | null;
  qrRequired?: boolean;
  label?: string;
};
export type ImportRow = PlanRow & { row: number; date: string | null };
export type PlannedJob = {
  startTime: string | null;
  title: string;
  customerId: string;
  location: string;
  place: Place;
  description: string | null;
  instructions: string | null;
  teamIds: string[];
  workerIds: string[];
  exceptWorkerIds: string[];
  clocking?: Clocking | null;
  qrRequired?: boolean;
};

const clean = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text ?? '').join('').trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return clean(o.result);
    if (o.hyperlink !== undefined) return String(o.text ?? o.hyperlink).trim();
  }
  return String(v).trim();
};

/** "Team A, Team B + Ali & Raja; Naga" -> ["Team A", "Team B", "Ali", "Raja", "Naga"] */
export const list = (s: string) => s.split(/\s*(?:,|;|\+|&|\band\b|\n)\s*/i).map((x) => x.trim()).filter(Boolean);

/** A JS Date (Excel date cell), yyyy-mm-dd, d/m/yyyy, d-m-yyyy, d.m.yyyy, "7 Nov 2026", "Nov 7 2026". */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date) return DateTime.fromJSDate(v, { zone: 'utc' }).toFormat('yyyy-MM-dd');
  const s = clean(v);
  if (!s) return null;
  if (DATE_RE.test(s)) return s;
  const iso = DateTime.fromISO(s, { zone: 'utc' });
  if (iso.isValid && /^\d{4}-\d{2}-\d{2}/.test(s)) return iso.toFormat('yyyy-MM-dd');
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const d = DateTime.fromObject({ year: y, month: Number(dmy[2]), day: Number(dmy[1]) });
    return d.isValid ? d.toFormat('yyyy-MM-dd') : null;
  }
  for (const f of ['d LLL yyyy', 'd LLLL yyyy', 'LLL d yyyy', 'LLLL d yyyy', 'd LLL yy', 'ccc d LLL yyyy', 'd-LLL-yyyy', 'd-LLL-yy']) {
    const d = DateTime.fromFormat(s.replace(/,/g, ''), f);
    if (d.isValid) return d.toFormat('yyyy-MM-dd');
  }
  return null;
}

/** A JS Date / Excel fraction (time cell), "8:30", "08:30", "0830", "8.30am", "830pm", "2pm". undefined = unreadable. */
export function parseTime(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return DateTime.fromJSDate(v, { zone: 'utc' }).toFormat('HH:mm');
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const s = clean(v).toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (TIME_RE.test(s)) return s;
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/) ?? s.match(/^(\d{1,2})(\d{2})(am|pm)?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const mm = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || mm > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function parseClocking(s: string): Clocking | null | undefined {
  const t = s.toLowerCase().replace(/[^a-z+&]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t === 'default' || t === 'company' || t === 'company rule' || t === 'rule') return null;
  if (['off', 'none', 'no', 'not needed', 'nothing'].includes(t)) return 'OFF';
  if (/(in ?(and|&|\+|\/) ?out|both|in out|arrive ?(and|&|\+) ?leave|clock in and out)/.test(t)) return 'ARRIVE_LEAVE';
  if (/^(in|clock in|arrive|arrival|clock in only|in only)$/.test(t)) return 'ARRIVE';
  return undefined;
}

const yes = (s: string) => /^(y|yes|true|1|✓|✔|x|required|scan)$/i.test(s.trim());

function mapHeaders(cells: string[]): Partial<Record<number, Key>> {
  const out: Partial<Record<number, Key>> = {};
  const taken = new Set<Key>();
  const rules: [Key, RegExp][] = [
    ['exceptWorkers', /leave ?out|except|without|not on|exclude/],
    ['qrRequired', /\bqr\b/],
    ['clocking', /clock/],
    ['date', /^date|^day$|^when/],
    ['time', /^start|^time|^from$/],
    ['title', /client|job|title|customer|name of job/],
    ['search', /postal|post ?code|zip|search|map|lookup/],
    ['location', /address|location|place|site|where|venue/],
    ['description', /work|description|task|scope|what/],
    ['instructions', /instruction|note|remark|call/],
    ['teams', /team|crew ?name/],
    ['workers', /worker|crew|staff|people|who|employee|name/],
  ];
  cells.forEach((h, i) => {
    const t = h.toLowerCase().trim();
    if (!t) return;
    for (const [key, re] of rules) {
      if (!taken.has(key) && re.test(t)) {
        out[i] = key;
        taken.add(key);
        return;
      }
    }
  });
  return out;
}

/** Minimal RFC-4180 CSV parser (quotes, embedded commas and newlines). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((c) => c.trim() !== ''));
}

/** An .xlsx (first sheet that isn't Help) or .csv into rows, with every problem that stops a row being used. */
export async function parseScheduleFile(buf: Buffer, filename: string): Promise<{ rows: ImportRow[]; problems: string[] }> {
  let grid: unknown[][] = [];
  if (/\.csv$/i.test(filename)) {
    grid = parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets.find((w) => w.name.toLowerCase() !== 'help') ?? wb.worksheets[0];
    if (!ws) return { rows: [], problems: ['The file has no sheets.'] };
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const cells: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (c, i) => {
        cells[i - 1] = c.value;
      });
      grid[n - 1] = cells;
    });
  }
  let headerAt = -1;
  let map: Partial<Record<number, Key>> = {};
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const m = mapHeaders((grid[i] ?? []).map(clean));
    const keys = Object.values(m);
    if (keys.includes('title') && keys.includes('location')) {
      headerAt = i;
      map = m;
      break;
    }
  }
  if (headerAt < 0) return { rows: [], problems: ["Couldn't find the header row. Use the template: it needs at least a 'Client / job' and an 'Address or site' column."] };

  const rows: ImportRow[] = [];
  const problems: string[] = [];
  let lastDate: string | null = null;
  for (let i = headerAt + 1; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    const get = (k: Key): unknown => {
      const idx = Object.entries(map).find(([, v]) => v === k)?.[0];
      return idx === undefined ? undefined : cells[Number(idx)];
    };
    if (Object.keys(map).every((idx) => clean(cells[Number(idx)]) === '')) continue;
    const n = i + 1;
    const label = `Row ${n}`;
    const rawDate = get('date');
    let date = parseDate(rawDate);
    if (!date && clean(rawDate) === '') date = lastDate;
    if (!date) problems.push(`${label}: can't read the date "${clean(rawDate)}", use yyyy-mm-dd or dd/mm/yyyy`);
    else lastDate = date;
    const time = parseTime(get('time'));
    if (time === undefined) problems.push(`${label}: can't read the start time "${clean(get('time'))}", use HH:mm`);
    const clockingRaw = clean(get('clocking'));
    const clocking = parseClocking(clockingRaw);
    if (clocking === undefined) problems.push(`${label}: clocking "${clockingRaw}" should be blank, off, in, or in and out`);
    const title = clean(get('title'));
    const location = clean(get('location'));
    if (!title) problems.push(`${label}: no client / job name`);
    if (!location) problems.push(`${label}: no address or site`);
    rows.push({
      row: n,
      label,
      date,
      time: time ?? null,
      title,
      location,
      search: clean(get('search')) || null,
      description: clean(get('description')) || null,
      instructions: clean(get('instructions')) || null,
      teams: list(clean(get('teams'))),
      workers: list(clean(get('workers'))),
      exceptWorkers: list(clean(get('exceptWorkers'))),
      clocking: clocking ?? null,
      qrRequired: yes(clean(get('qrRequired'))),
    });
  }
  if (!rows.length) problems.push('No job rows found under the header.');
  return { rows, problems };
}

// ── Resolution (jobs-plan.ts) ───────────────────────────────────────────────

export function resolveTeam(q: string, teams: { id: string; name: string }[]) {
  const strip = (s: string) => norm(s).replace(/^team /, '');
  const hits = teams.filter((t) => norm(t.name) === norm(q) || strip(t.name) === strip(q));
  if (hits.length === 1) return { team: hits[0] };
  if (!hits.length) return { error: `no team "${q}"` };
  return { error: `"${q}" matches several teams: ${hits.map((t) => t.name).join(', ')}` };
}

type W = { id: string; name: string; phone: string | null; employeeNo: string | null };

/** By phone (8+ digits, last 8), else exact name or employee no., a unique whole word, a unique partial; never a guess. */
export function resolveJobWorker(q: string, workers: W[]) {
  const name = q.trim();
  const digits = name.replace(/\D/g, '');
  if (digits.length >= 8 && /^[+\d\s()-]+$/.test(name)) {
    const byPhone = workers.filter((w) => (w.phone ?? '').replace(/\D/g, '').endsWith(digits.slice(-8)));
    if (byPhone.length === 1) return { worker: byPhone[0] };
    if (!byPhone.length) return { error: `no worker with phone ${name}` };
    return { error: `${name} matches several workers: ${byPhone.map((u) => u.name).join(', ')}` };
  }
  const users = workers.filter((u) => u.name.toLowerCase().includes(name.toLowerCase()) || (u.employeeNo ?? '').toLowerCase() === name.toLowerCase()).slice(0, 20);
  const exact = users.filter((u) => norm(u.name) === norm(name) || (u.employeeNo && norm(u.employeeNo) === norm(name)));
  if (exact.length === 1) return { worker: exact[0] };
  const word = users.filter((u) => norm(u.name).split(' ').includes(norm(name)));
  if (word.length === 1) return { worker: word[0] };
  if (users.length === 1) return { worker: users[0] };
  if (!users.length) return { error: `no worker "${name}"` };
  const pool = word.length ? word : users;
  return { error: `"${name}" could be ${pool.slice(0, 6).map((u) => `${u.name}${u.employeeNo ? ` (${u.employeeNo})` : ''}`).join(', ')}` };
}

/** AIMS only: the calendar job's customer, by exact name, else a unique partial match. Never created here. */
export function resolveCustomer(q: string, customers: { id: string; name: string }[]) {
  const exact = customers.filter((c) => norm(c.name) === norm(q));
  if (exact.length === 1) return { customer: exact[0] };
  const part = exact.length ? exact : customers.filter((c) => norm(c.name).includes(norm(q)));
  if (part.length === 1) return { customer: part[0] };
  if (!part.length) return { error: `no customer "${q}" in Customers (add it there first)` };
  return { error: `"${q}" could be ${part.slice(0, 6).map((c) => c.name).join(', ')}` };
}

/** A day's rows; every row is checked so all problems come back together; `planned` holds the rows that resolved. */
export async function planDayJobs(db: Db, organizationId: string, date: string, rows: PlanRow[]) {
  const [teams, workersRaw, profiles, customers] = await Promise.all([
    db.workerTeam.findMany({ where: { organizationId, active: true }, select: { id: true, name: true } }),
    db.worker.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, phone: true } }),
    db.fieldWorkerProfile.findMany({ where: { organizationId }, select: { workerId: true, employeeNo: true } }),
    db.customer.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);
  const emp = new Map(profiles.map((p: any) => [p.workerId, p.employeeNo]));
  const workers: W[] = workersRaw.map((w: any) => ({ ...w, employeeNo: (emp.get(w.id) as string) ?? null }));
  const placeCache = new Map<string, Place | null>();
  const problems: string[] = [];
  const planned: PlannedJob[] = [];
  for (const [i, j] of rows.entries()) {
    const label = j.label ?? `Job ${i + 1} (${j.title ?? 'untitled'})`;
    const startTime = j.time ? String(j.time).trim() : null;
    if (startTime && !TIME_RE.test(startTime)) problems.push(`${label}: time "${startTime}" must be HH:mm`);
    if (!j.title || !j.location) {
      problems.push(`${label}: needs a title and a location`);
      continue;
    }
    const cust = resolveCustomer(String(j.title), customers);
    if (!cust.customer) problems.push(`${label}: ${cust.error}`);
    const teamIds: string[] = [];
    for (const t of j.teams ?? []) {
      const r = resolveTeam(String(t), teams);
      if (r.team) teamIds.push(r.team.id);
      else problems.push(`${label}: ${r.error}`);
    }
    const workerIds: string[] = [];
    for (const w of j.workers ?? []) {
      const r = resolveJobWorker(String(w), workers);
      if (r.worker) workerIds.push(r.worker.id);
      else problems.push(`${label}: ${r.error}`);
    }
    const exceptWorkerIds: string[] = [];
    if ((j.exceptWorkers ?? []).length) {
      const members = await teamMembersOn(db, organizationId, teamIds, date);
      for (const w of j.exceptWorkers!) {
        const r = resolveJobWorker(String(w), workers);
        if (!r.worker) {
          problems.push(`${label}: ${r.error}`);
          continue;
        }
        if (!members.some((m) => m.workerId === r.worker!.id)) problems.push(`${label}: ${r.worker.name} isn't in ${(j.teams ?? []).join(' / ') || 'any named team'} on that date, so can't be left out of it`);
        else exceptWorkerIds.push(r.worker.id);
      }
    }
    const key = norm(`${j.location}|${j.search ?? ''}`);
    if (!placeCache.has(key)) placeCache.set(key, await findPlace(db, organizationId, String(j.location), j.search ? String(j.search) : null));
    const place = placeCache.get(key);
    if (!place) problems.push(`${label}: couldn't find "${j.search || j.location}" on the map, give a postal code or street address`);
    if (!teamIds.length && !workerIds.length && !(j.teams ?? []).length && !(j.workers ?? []).length) problems.push(`${label}: nobody is assigned`);
    if (place && cust.customer) {
      planned.push({
        startTime: startTime && TIME_RE.test(startTime) ? startTime : null,
        title: cust.customer.name,
        customerId: cust.customer.id,
        location: String(j.location).trim(),
        place,
        description: j.description ? String(j.description).trim() : null,
        instructions: j.instructions ? String(j.instructions).trim() : null,
        teamIds,
        workerIds,
        exceptWorkerIds,
        ...(j.clocking !== undefined ? { clocking: j.clocking } : {}),
        ...(j.qrRequired !== undefined ? { qrRequired: !!j.qrRequired } : {}),
      });
    }
  }
  return { planned, problems, teams };
}

/** The template: a Schedule sheet with three example rows and a Help sheet with this org's teams, workers and sites. */
export async function buildTemplate(db: Db, organizationId: string, today: string): Promise<ExcelJS.Workbook> {
  const [teams, workers, sites, profiles] = await Promise.all([
    db.workerTeam.findMany({ where: { organizationId, active: true }, select: { name: true }, orderBy: { name: 'asc' } }),
    db.worker.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, phone: true }, orderBy: { name: 'asc' } }),
    db.fieldSite.findMany({ where: { organizationId, active: true, kind: 'PERMANENT' }, select: { name: true }, orderBy: { name: 'asc' } }),
    db.fieldWorkerProfile.findMany({ where: { organizationId }, select: { workerId: true, employeeNo: true } }),
  ]);
  const emp = new Map(profiles.map((p: any) => [p.workerId, p.employeeNo]));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Schedule');
  const header = ws.addRow(IMPORT_COLUMNS.map((c) => c.header));
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1FE' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  [12, 8, 28, 30, 12, 30, 30, 18, 24, 16, 12, 6].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  const t1 = teams[0]?.name ?? 'Team A';
  const t2 = teams[1]?.name ?? teams[0]?.name ?? 'Team B';
  const w1 = workers[0]?.name ?? 'Ali';
  const s1 = sites[0]?.name ?? 'Our office';
  ws.addRow([addDays(today, 1), '08:30', 'Ajiya Okonomiyaki Restaurant', 'E!Avenue #02-346', '608532', 'Troubleshoot exhaust VSD at rooftop', 'Call the management on arrival', t1, '', '', '', 'yes']);
  ws.addRow(['', '14:00', 'Office collection', s1, '', 'Collect parts', '', t2, w1, '', 'off', '']);
  ws.addRow([addDays(today, 2), '09:00', 'Woodlands AHU service', 'Causeway Point #03-10', '738099', 'Quarterly service', '', t1, '', w1, 'in and out', '']);
  for (let r = 2; r <= 4; r++) ws.getRow(r).font = { color: { argb: 'FF6B7A8D' }, italic: true };
  ws.getColumn(1).numFmt = '@';
  const help = wb.addWorksheet('Help');
  help.getColumn(1).width = 18;
  help.getColumn(2).width = 90;
  help.addRow(['How to fill in the Schedule sheet']).font = { bold: true, size: 13 };
  help.addRow(['Rows 2 to 4 are examples: overwrite or delete them. One row per job. Upload the file on Field > Plan, Upload schedule.']);
  help.addRow([]);
  for (const c of IMPORT_COLUMNS) help.addRow([c.header, c.hint]);
  help.addRow([]);
  help.addRow(['Your teams', teams.map((t: any) => t.name).join(', ') || '(none yet, add teams on Field > Teams)']);
  help.addRow(['Your sites', sites.map((s: any) => s.name).join(', ') || '(none)']);
  help.addRow([]);
  help.addRow(['Your workers', 'Write the name as shown here, or the employee no., or the phone number.']).font = { bold: true };
  for (const w of workers) help.addRow([emp.get(w.id) ?? '', `${w.name}${w.phone ? ` · ${w.phone}` : ''}`]);
  return wb;
}
