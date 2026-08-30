/**
 * Interior-design project schedule: the firm's standard activity sequence
 * (top → bottom, as given by the owners) and the weekly Mon–Sun calendar
 * renderer that reproduces their "Project Schedule" sheet for print/PDF.
 */
import { escapeHtml } from '../common/services/document-html/shared';

export const ID_SCHEDULE_SEQUENCE: string[] = [
  '3D Rendering Discussion',
  'Shopping (Lightings, Sanitary, Tiles etc.)',
  'Visit Supplier (Laminate, Tabletop etc.)',
  'Confirmation Meeting with Owner on Design & Materials',
  'Site Survey',
  'Protection / Uplift Works',
  'Hacking Works',
  'Book Gas Appointment',
  'Electrical Works',
  'Aircon Works',
  'Measure Window',
  'Plumbing Works',
  'Tiling Works',
  'Disposal Works',
  'Gas Works',
  'Partial Toilet Window Installation',
  'Measure Door',
  'Partition Works',
  'Measure Curtain',
  'Painting Works',
  'Disposal Works (2nd)',
  'Install Windows',
  'Measure Carpentry',
  'Meet Owner for Carpentry Elevation Discussion',
  'Carpentry Fabrication',
  'Door Installation',
  'Carpentry Installation',
  'Tabletop Measurement',
  'Final Plumbing Works',
  'Final Electrical Works',
  'Aircon Works (Final)',
  'Disposal Works (Final)',
  'General Cleaning Works',
  'Curtain Installation',
  'Furniture Move In',
];

// Singapore public holidays (MOM gazette). Extend each year.
export const SG_PUBLIC_HOLIDAYS: Record<string, string> = {
  '2025-01-01': "New Year's Day",
  '2025-01-29': 'Chinese New Year',
  '2025-01-30': 'Chinese New Year',
  '2025-03-31': 'Hari Raya Puasa',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Labour Day',
  '2025-05-12': 'Vesak Day',
  '2025-06-07': 'Hari Raya Haji',
  '2025-08-09': 'National Day',
  '2025-10-20': 'Deepavali',
  '2025-12-25': 'Christmas Day',
  '2026-01-01': "New Year's Day",
  '2026-02-17': 'Chinese New Year',
  '2026-02-18': 'Chinese New Year',
  '2026-03-21': 'Hari Raya Puasa',
  '2026-04-03': 'Good Friday',
  '2026-05-01': 'Labour Day',
  '2026-05-27': 'Hari Raya Haji',
  '2026-05-31': 'Vesak Day',
  '2026-06-01': 'Vesak Day (in lieu)',
  '2026-08-09': 'National Day',
  '2026-08-10': 'National Day (in lieu)',
  '2026-11-08': 'Deepavali',
  '2026-11-09': 'Deepavali (in lieu)',
  '2026-12-25': 'Christmas Day',
};

export type ScheduleItem = { id?: string; label: string; kind: string; startDate: Date | string; endDate: Date | string; notes?: string | null };

const DAY = 86400000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const atMidnight = (d: Date | string) => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
};
const mondayOf = (d: Date) => {
  const x = atMidnight(d);
  const dow = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(x.getTime() - dow * DAY);
};
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmt = (d: Date) => d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short' });

/** Weeks covering every item, each with 7 day buckets of labels. */
export function buildWeeks(items: ScheduleItem[]) {
  if (!items.length) return [];
  const starts = items.map((i) => atMidnight(i.startDate).getTime());
  const ends = items.map((i) => atMidnight(i.endDate).getTime());
  const first = mondayOf(new Date(Math.min(...starts)));
  const last = new Date(Math.max(...ends));
  const weeks: Array<{ index: number; days: Array<{ date: Date; iso: string; dow: string; holiday: string | null; work: string[]; notes: string[] }> }> = [];
  let cursor = first;
  let index = 1;
  while (cursor.getTime() <= last.getTime()) {
    const days = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(cursor.getTime() + d * DAY);
      const key = iso(date);
      days.push({ date, iso: key, dow: DOW[d], holiday: SG_PUBLIC_HOLIDAYS[key] || null, work: [] as string[], notes: [] as string[] });
    }
    weeks.push({ index, days });
    cursor = new Date(cursor.getTime() + 7 * DAY);
    index += 1;
  }
  for (const it of items) {
    const s = atMidnight(it.startDate).getTime();
    const e = atMidnight(it.endDate).getTime();
    for (const w of weeks) {
      for (const day of w.days) {
        const t = day.date.getTime();
        if (t < s || t > e) continue;
        if (it.kind === 'note') day.notes.push(it.label);
        else if (it.kind === 'holiday') day.holiday = day.holiday || it.label;
        else if (day.dow !== 'Sun') day.work.push(it.label); // workers off on Sundays
      }
    }
  }
  return weeks;
}

/** Their printed sheet: header block, then week rows (Mon–Sun) with the day's activities. */
export function renderScheduleHtml(opts: { projectSite: string; contractNo: string | null; manager: string | null; contact: string | null; orgName: string; logo?: string | null; items: ScheduleItem[] }): string {
  const weeks = buildWeeks(opts.items);
  const header = `
    <div class="hdr">
      <div>
        ${opts.logo ? `<img src="${escapeHtml(opts.logo)}" alt="" style="max-height:40px;max-width:180px;object-fit:contain;margin-bottom:6px;" />` : ''}
        <div class="site">PROJECT SITE: ${escapeHtml(opts.projectSite)}</div>
        ${opts.contractNo ? `<div class="contract">(${escapeHtml(opts.contractNo)})</div>` : ''}
      </div>
      <div class="pm">
        <div><span>Project Manager:</span> ${escapeHtml(opts.manager || '')}</div>
        <div><span>Contact No:</span> ${escapeHtml(opts.contact || '')}</div>
      </div>
    </div>
    <div class="disc">Proposed schedule may be subjected to changes due to unforeseen circumstances on site</div>`;

  const weekRows = weeks
    .map(
      (w) => `
      <table class="week">
        <thead><tr><th class="wk">Week ${w.index}</th>${w.days.map((d) => `<th class="${d.dow === 'Sun' ? 'sun' : ''}"><div class="dow">${d.dow}</div><div class="date">${fmt(d.date)}</div></th>`).join('')}</tr></thead>
        <tbody><tr><td class="wk"></td>${w.days
          .map((d) => {
            const cells: string[] = [];
            if (d.holiday) cells.push(`<div class="ph">${escapeHtml(d.holiday)}<br/><small>(PUBLIC HOLIDAY)</small></div>`);
            if (d.dow === 'Sun') cells.push(`<div class="off">WORKERS OFF DAY</div>`);
            for (const l of d.work) cells.push(`<div class="act">${escapeHtml(l)}</div>`);
            for (const n of d.notes) cells.push(`<div class="note">${escapeHtml(n)}</div>`);
            return `<td class="${d.dow === 'Sun' ? 'sun' : ''}">${cells.join('')}</td>`;
          })
          .join('')}</tr></tbody>
      </table>`,
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; } body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color:#111; margin:0; font-size: 11px; }
    .hdr { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #111; padding-bottom:6px; margin-bottom:4px; }
    .site { font-weight:800; font-size:14px; letter-spacing:.2px; } .contract { color:#444; font-size:12px; }
    .pm div { font-size:11.5px; } .pm span { color:#555; display:inline-block; min-width:110px; }
    .disc { font-style:italic; color:#666; font-size:10px; margin-bottom:10px; }
    table.week { width:100%; border-collapse:collapse; table-layout:fixed; margin-bottom:10px; page-break-inside:avoid; }
    table.week th, table.week td { border:1px solid #999; vertical-align:top; padding:4px 5px; }
    table.week th { background:#e9e9e9; text-align:left; } th.wk, td.wk { width:62px; font-weight:800; background:#dcdcdc; }
    .dow { font-weight:700; } .date { color:#444; font-weight:400; }
    table.week td { height:72px; } th.sun, td.sun { background:#f5f5f5; }
    .act { background:#ffe58a; border:1px solid #e6c95a; border-radius:3px; padding:2px 4px; margin-bottom:3px; font-weight:600; }
    .note { background:#d9f2d0; border:1px solid #9fd38f; border-radius:3px; padding:2px 4px; margin-bottom:3px; font-style:italic; }
    .ph { background:#f8b4b4; border:1px solid #e07070; border-radius:3px; padding:2px 4px; margin-bottom:3px; font-weight:700; text-transform:uppercase; }
    .off { color:#777; font-weight:700; font-size:10px; margin-bottom:3px; }
    .empty { color:#888; padding:24px; text-align:center; }
  </style></head><body>${header}${weeks.length ? weekRows : '<div class="empty">No activities scheduled yet.</div>'}</body></html>`;
}
