/**
 * Google Calendar -> AIMS import (WCT group, 2026-11-25). Calendars shared WITH the service account (Amy, Kherry,
 * Rave, ...) have no "Export calendar" in Google's settings, so they are read from the Schedule view (read only):
 * gcal-ui-scrape.json (every event's label: when, title, calendar, location, date) and gcal-ui-desc.json (the
 * description from each event's pop-up). This turns both into one ICS file per calendar under <exportDir>/ui-ics/,
 * so wct-gcal-import.ts reads every calendar the same way.
 *
 * The UI gives no last-modified time: X-AIMS-HASH (a hash of the event's fields) stands in for it.
 *
 *   npx ts-node --transpile-only scripts/gcal/gcal-ui-to-ics.ts ~/Downloads/gcal-export
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { icsEscape, popupDescription, stripDayCounter } from './gcal-title';

const MONTHS: Record<string, number> = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
const dOf = (d: number, m: number, y: number) => `${y}${pad(m)}${pad(d)}`;
const to24 = (t: string, fallbackAmPm?: string) => {
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const ap = m[3] || fallbackAmPm || 'am';
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return `${pad(h)}${m[2] ?? '00'}00`;
};

/** Google's aria label: "<when>, <title>, Calendar: <cal>, [Accepted,] <No location|location>, [colour: x,] <date(s)>". */
export function parseLabel(a: string) {
  const ci = a.lastIndexOf(', Calendar: ');
  const head = ci >= 0 ? a.slice(0, ci) : a;
  const tail = ci >= 0 ? a.slice(ci + 12) : '';
  const calendar = tail.split(',')[0].trim();
  const locM = tail.match(/^[^,]*,(?: Accepted,| Declined,| Tentative,| Needs action,)? ([^,]*?)(?:, colour: [^,]*)?, (?:\d|$)/);
  const location = locM && locM[1] !== 'No location' ? locM[1].trim() : '';
  let title = head;
  let start: string | null = null, end: string | null = null, st: string | null = null, et: string | null = null;
  const cross = head.match(/^(\d{1,2}) ([A-Z][a-z]+) (\d{4}) at ([\d:]+[ap]m) to (\d{1,2}) ([A-Z][a-z]+) (\d{4}) at ([\d:]+[ap]m), ([\s\S]*)$/);
  const timed = head.match(/^([\d:]+(?:am|pm)?) to ([\d:]+(?:am|pm)), ([\s\S]*)$/);
  const allDay = /^All day, /.test(head);
  if (cross) {
    start = dOf(+cross[1], MONTHS[cross[2]], +cross[3]);
    end = dOf(+cross[5], MONTHS[cross[6]], +cross[7]);
    st = to24(cross[4]);
    et = to24(cross[8]);
    title = cross[9];
  } else {
    if (timed) {
      st = to24(timed[1], timed[2].slice(-2));
      et = to24(timed[2]);
      title = timed[3];
    } else if (allDay) title = head.slice(9);
    const range = tail.match(/(\d{1,2})(?: ([A-Z][a-z]+))?(?: (\d{4}))? – (\d{1,2}) ([A-Z][a-z]+) (\d{4})\s*$/);
    const single = tail.match(/(\d{1,2}) ([A-Z][a-z]+) (\d{4})\s*$/);
    if (range) {
      const ey = +range[6], em = MONTHS[range[5]];
      const sm = range[2] ? MONTHS[range[2]] : em;
      const sy = range[3] ? +range[3] : sm > em ? ey - 1 : ey;
      start = dOf(+range[1], sm, sy);
      end = dOf(+range[4], em, ey);
    } else if (single) start = end = dOf(+single[1], MONTHS[single[2]], +single[3]);
  }
  return { title: stripDayCounter(title.trim()), calendar, location, allDay: allDay && !cross, start, end, st, et };
}

function main() {
  const dir = process.argv[2] || path.join(process.env.HOME || '', 'Downloads', 'gcal-export');
  const scrape = JSON.parse(fs.readFileSync(path.join(dir, 'gcal-ui-scrape.json'), 'utf8'));
  // Descriptions: gcal-ui-desc.json ({ byId: { <chip id>: { base, txt } } }, raw pop-up text) or the compact
  // gcal-ui-desc-by-eid.json ({ <event id without the instance date>: description }).
  const descFile = path.join(dir, 'gcal-ui-desc.json');
  const desc: Record<string, any> = fs.existsSync(descFile) ? JSON.parse(fs.readFileSync(descFile, 'utf8')).byId : {};
  const baseDesc = new Map<string, string>();
  for (const v of Object.values(desc)) if (v && v.base && v.txt) baseDesc.set(v.base.split(' ')[0], popupDescription(v.txt));
  const eidFile = path.join(dir, 'gcal-ui-desc-by-eid.json');
  if (fs.existsSync(eidFile)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(eidFile, 'utf8')))) baseDesc.set(k, String(v));
  const byCal = new Map<string, string[]>();
  const calIds = new Map<string, string>();
  const seen = new Set<string>();
  let skipped = 0;
  for (const e of scrape.events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const p = parseLabel(e.a);
    const [eid, calId] = String(e.dec || '').split(' ');
    if (!p.start || !eid) { skipped++; continue; }
    calIds.set(p.calendar, calId || '');
    const base = eid.replace(/_\d{8}(T\d{6}Z)?$/, '');
    const d = desc[e.id];
    const description = d?.txt ? popupDescription(d.txt) : baseDesc.get(base) ?? '';
    const startLine = p.st ? `DTSTART;TZID=Asia/Singapore:${p.start}T${p.st}` : `DTSTART;VALUE=DATE:${p.start}`;
    let endLine: string;
    if (p.et) endLine = `DTEND;TZID=Asia/Singapore:${p.end}T${p.et}`;
    else {
      const x = new Date(`${p.end!.slice(0, 4)}-${p.end!.slice(4, 6)}-${p.end!.slice(6, 8)}T00:00:00Z`);
      x.setUTCDate(x.getUTCDate() + 1);
      endLine = `DTEND;VALUE=DATE:${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}`;
    }
    const hash = createHash('sha1').update(JSON.stringify([p.title, p.start, p.end, p.st, p.et, p.location, description])).digest('hex').slice(0, 16);
    const ev = ['BEGIN:VEVENT', `UID:${eid}`, startLine, endLine, `SUMMARY:${icsEscape(p.title)}`];
    if (description) ev.push(`DESCRIPTION:${icsEscape(description)}`);
    if (p.location) ev.push(`LOCATION:${icsEscape(p.location)}`);
    ev.push(`X-GCAL-CALENDAR-ID:${calId}`, `X-AIMS-HASH:${hash}`, `X-AIMS-DESCRIPTION-READ:${d?.txt || baseDesc.has(base) ? 'yes' : 'no'}`, 'END:VEVENT');
    (byCal.get(p.calendar) ?? byCal.set(p.calendar, []).get(p.calendar)!).push(ev.join('\r\n'));
  }
  const out = path.join(dir, 'ui-ics');
  fs.mkdirSync(out, { recursive: true });
  for (const [cal, evs] of byCal) {
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AIMS//gcal-ui-to-ics//EN', `X-WR-CALNAME:${cal}`, `X-GCAL-CALENDAR-ID:${calIds.get(cal)}`, 'X-WR-TIMEZONE:Asia/Singapore', ...evs, 'END:VCALENDAR'].join('\r\n');
    fs.writeFileSync(path.join(out, `${cal.replace(/[^\w' ()-]+/g, '').trim() || 'calendar'}.ics`), body + '\r\n');
    console.log(`${cal.padEnd(30)} ${String(evs.length).padStart(5)} events  (${calIds.get(cal)})`);
  }
  console.log(`skipped (no date): ${skipped}`);
}

if (require.main === module) main();
