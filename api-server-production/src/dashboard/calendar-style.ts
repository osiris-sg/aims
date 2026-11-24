/**
 * Jobs calendar style (WCT group, 2026-11-18, flag enableCalendarStyle).
 * Google Calendar-like chips: fill = the job's salesperson's colour, a slim
 * left bar = the PTW applicant's colour (no bar when no PTW is needed), and
 * icons for PTW status, DOs, cancelled / postponed, COD, 📌 Generate sticker; Leave notes get 📅.
 * Cancelled and postponed jobs stay on the calendar, greyed out.
 *
 * Colours are per person per org (UserOrganization.settings.calendar, edited
 * in Org Settings > Calendar colours, 2026-11-25; was Job fields). A bar colour must never be a
 * fill colour (or close to one), so the two read apart at a glance.
 *
 * Pure helpers; calendar-style.service.ts does the reads and writes.
 */
import type { PtwApplicantList } from '../deliveries/ptw-applicants';

/** Salesperson fills (Google Calendar tones). */
export const FILL_PALETTE = ['#039be5', '#8e24aa', '#e67c73', '#3f51b5', '#7986cb', '#ad1457', '#26a69a'] as const;
/** PTW applicant bars. */
// 2026-11-19: amber #c99a00 replaces yellow #f6bf26 (too faint as a bar on the soft chip fills).
export const BAR_PALETTE = ['#d50000', '#c99a00', '#0b8043', '#f4511e', '#795548', '#212121'] as const;
/** A job with no salesperson (or one with no colour yet). */
export const NEUTRAL_FILL = '#b0bec5';
/** A PTW bar whose applicant has no colour yet. */
export const NEUTRAL_BAR = '#455a64';
/** Two colours closer than this (RGB distance) read as the same. */
export const MIN_COLOUR_DISTANCE = 80;

/** Seeds (scripts/wct-calendar-style-seed.ts): salesperson fills by login email, PTW bars by name. */
export const SEED_FILLS: Record<string, string> = {
  'hh@wct.com.sg': '#039be5',
  'amy@wct.com.sg': '#8e24aa',
  'pc@wct.com.sg': '#e67c73',
  'joyna@wct.com.sg': '#3f51b5',
};
export const SEED_BARS: Record<string, string> = { Bala: '#d50000', Joyna: '#f6bf26', Kherry: '#0b8043' };
export const SEED_DEFAULT_APPLICANT = 'Bala';

/**
 * ✅ (Elroy 2026-11-20, replaces the round 6 "completed only" rule): every DO that is not cancelled or voided counts,
 * draft or completed ("DO generated"). Soft-deleted DOs are no longer DOs (their type changes), so they never count.
 */
export function isLiveDo(d: { config?: unknown }): boolean {
  const c: any = d.config || {};
  return c.cancelled !== true && c.voided !== true;
}

/** A completed / signed DO (the DO's "Completed" tag); kept for callers that need it. */
export function isCompletedDo(d: { status?: string | null; config?: unknown }): boolean {
  const c: any = d.config || {};
  if (c.cancelled === true || c.voided === true) return false;
  return d.status === 'delivered_installed';
}

export const ICON = {
  ptwPending: '✋',
  ptwApproved: '👍',
  ptwRejected: '👎',
  doDone: '✅',
  cancelled: '❌',
  postponed: '⭕',
  leave: '📅',
  cod: '🟫',
  sticker: '📌',
} as const;

/** The legend: icons only, no people colours. */
export const CALENDAR_STYLE_LEGEND: Array<{ icon: string; label: string }> = [
  { icon: ICON.ptwPending, label: 'PTW pending' },
  { icon: ICON.ptwApproved, label: 'PTW approved' },
  { icon: ICON.ptwRejected, label: 'PTW rejected' },
  { icon: ICON.doDone, label: 'DO generated' },
  { icon: ICON.cancelled, label: 'Cancelled' },
  { icon: ICON.postponed, label: 'Postponed' },
  { icon: ICON.leave, label: 'Leave' },
  { icon: ICON.cod, label: 'COD' },
  { icon: ICON.sticker, label: 'Generate sticker' },
];

/** Category title prefixes (job category list, deliveries/job-category.ts). */
export const CATEGORY_PREFIX: Record<string, string> = { 'site visit': '(SV)', meeting: '(M)', 'collect cheque': '(CC)' };
export const categoryPrefix = (category: string | null | undefined): string | null => CATEGORY_PREFIX[String(category ?? '').trim().toLowerCase()] ?? null;

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
export const normHex = (v: unknown): string | null => (isHex(v) ? v.toLowerCase() : null);

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function colourDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** White or dark text on a fill (WCAG relative luminance). */
export function textOn(fill: string): string {
  const [r, g, b] = rgb(fill).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l > 0.4 ? '#212121' : '#ffffff';
}

/**
 * Bars vs fills: every bar colour must be at least MIN_COLOUR_DISTANCE from
 * every fill colour and the neutral fill. Returns the first clash, or null.
 */
export function colourClash(fills: string[], bars: string[]): { fill: string; bar: string } | null {
  for (const bar of bars) {
    for (const fill of [...fills, NEUTRAL_FILL]) {
      if (colourDistance(fill, bar) < MIN_COLOUR_DISTANCE) return { fill, bar };
    }
  }
  return null;
}

export interface CalendarColours {
  /** userId -> salesperson fill. */
  fill: Record<string, string>;
  /** userId -> PTW applicant bar. */
  bar: Record<string, string>;
  /** The org's default PTW applicant (prefilled on new jobs, and used for a PTW job with none). */
  defaultApplicant: { id: string; name: string | null } | null;
  /** The org's PTW applicants list (2026-11-19; deliveries/ptw-applicants.ts), when it has one: bars and the default come from it. */
  ptwList?: PtwApplicantList | null;
  /**
   * PTW stripe colour per PTW status (Org Settings > Calendar colours, 2026-11-25). A status with a colour draws its
   * stripe in it; a status without one keeps the applicant's colour (the behaviour before). Absent = none set.
   */
  ptwStatus?: PtwStatusColours;
}

/** The PTW statuses with a stripe colour, as the settings page names them. SUBMITTED (applied) reads "Pending". */
export const PTW_STATUS_COLOUR_KEYS = ['REQUIRED', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type PtwStatusKey = (typeof PTW_STATUS_COLOUR_KEYS)[number];
export type PtwStatusColours = Partial<Record<PtwStatusKey, string>>;
export const PTW_STATUS_LABEL: Record<PtwStatusKey, string> = { REQUIRED: 'Required', SUBMITTED: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

/** A stored / sent { REQUIRED: '#rrggbb', … } read back: known statuses with a valid colour only. */
export function cleanPtwStatusColours(raw: unknown): PtwStatusColours {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: PtwStatusColours = {};
  for (const k of PTW_STATUS_COLOUR_KEYS) {
    const c = normHex(src[k]);
    if (c) out[k] = c;
  }
  return out;
}

/** The stripe colour a PTW status asks for, or null (the applicant's colour then). */
export function ptwStatusColour(status: string | null | undefined, colours: Pick<CalendarColours, 'ptwStatus'>): string | null {
  const k = String(status ?? '').toUpperCase() as PtwStatusKey;
  return colours.ptwStatus?.[k] ?? null;
}

/** The legend's PTW stripe rows: one per status with a colour, in status order (none when nothing is set). */
export function ptwStripeLegend(colours: Pick<CalendarColours, 'ptwStatus'> | null | undefined): Array<{ label: string; colour: string }> {
  const set = colours?.ptwStatus ?? {};
  return PTW_STATUS_COLOUR_KEYS.filter((k) => set[k]).map((k) => ({ label: `PTW ${PTW_STATUS_LABEL[k].toLowerCase()}`, colour: set[k]! }));
}

export const NO_COLOURS: CalendarColours = { fill: {}, bar: {}, defaultApplicant: null };

/** Group calendar: a child org's items use the parent's colours first, then the child's own. */
export function mergeColours(child: CalendarColours, parent: CalendarColours | null | undefined): CalendarColours {
  if (!parent) return child;
  return {
    fill: { ...child.fill, ...parent.fill },
    bar: { ...child.bar, ...parent.bar },
    defaultApplicant: child.defaultApplicant ?? parent.defaultApplicant,
    ...(child.ptwList || parent.ptwList ? { ptwList: child.ptwList ?? parent.ptwList } : {}),
    ...(child.ptwStatus || parent.ptwStatus ? { ptwStatus: { ...child.ptwStatus, ...parent.ptwStatus } } : {}),
  };
}

/** A person's calendar settings as stored in UserOrganization.settings.calendar. */
export interface PersonCalendarSettings {
  fill: string | null;
  bar: string | null;
  ptwDefault: boolean;
}

export function personSettingsOf(settings: unknown): PersonCalendarSettings {
  const c: any = settings && typeof settings === 'object' ? (settings as any).calendar : null;
  return { fill: normHex(c?.fill), bar: normHex(c?.bar), ptwDefault: c?.ptwDefault === true };
}

/** The org's colour maps from its members' settings. */
export function coloursOf(members: Array<{ userId: string; settings: unknown; name?: string | null }>): CalendarColours {
  const out: CalendarColours = { fill: {}, bar: {}, defaultApplicant: null };
  for (const m of members) {
    const s = personSettingsOf(m.settings);
    if (s.fill) out.fill[m.userId] = s.fill;
    if (s.bar) out.bar[m.userId] = s.bar;
    if (s.ptwDefault && !out.defaultApplicant) out.defaultApplicant = { id: m.userId, name: m.name ?? null };
  }
  return out;
}

export interface StyleInput {
  cancelled: boolean;
  postponed: boolean;
  /** PTW status (null / NOT_NEEDED = no PTW). */
  ptwStatus: string | null;
  /** The job's DOs that are not cancelled (draft or completed; else its order's). */
  doCount: number;
  cod: boolean;
  category: string | null;
  salespersonId: string | null;
  ptwApplicantId: string | null;
  /** "Generate sticker" ticked on the job (2026-11-19): 📌. */
  sticker?: boolean;
}

export interface EventStyle {
  fill: string;
  text: string;
  /** The PTW applicant's bar (null: no PTW needed). */
  bar: string | null;
  icons: Array<{ icon: string; label: string }>;
  /** Cancelled or postponed: drawn greyed out, never hidden. */
  greyed: boolean;
  /** "(SV)" / "(M)" / "(CC)" before the title, or null. */
  prefix: string | null;
  /** The PTW applicant as a colour circle (2026-11-20: 🔴 Bala, 🟡 Joyna, 🟢 Kherry); null without a PTW or an applicant. */
  applicantIcon?: string | null;
}

/**
 * Colour circles for the PTW applicant (2026-11-20, chip line 2): the circle closest to the applicant's bar colour.
 * Bala #d50000 = 🔴, Joyna amber #c99a00 (or the old yellow) = 🟡, Kherry #0b8043 = 🟢.
 */
export const COLOUR_CIRCLES: ReadonlyArray<{ icon: string; hex: string }> = [
  { icon: '🔴', hex: '#d50000' },
  { icon: '🟠', hex: '#f4511e' },
  { icon: '🟡', hex: '#e8b500' },
  { icon: '🟢', hex: '#0b8043' },
  { icon: '🔵', hex: '#1e64c8' },
  { icon: '🟣', hex: '#8e24aa' },
  { icon: '🟤', hex: '#795548' },
  { icon: '⚫', hex: '#212121' },
];

export function colourCircle(hex: string | null | undefined): string | null {
  const h = normHex(hex);
  if (!h) return null;
  let best = COLOUR_CIRCLES[0];
  for (const c of COLOUR_CIRCLES) if (colourDistance(h, c.hex) < colourDistance(h, best.hex)) best = c;
  return best.icon;
}

const ptwNeeded = (s: string | null | undefined) => !!s && s !== 'NOT_NEEDED';

export function ptwIcon(status: string | null | undefined): { icon: string; label: string } | null {
  const s = String(status ?? '').toUpperCase();
  if (s === 'REQUIRED' || s === 'SUBMITTED') return { icon: ICON.ptwPending, label: s === 'REQUIRED' ? 'PTW pending' : 'PTW applied' };
  if (s === 'APPROVED') return { icon: ICON.ptwApproved, label: 'PTW approved' };
  if (s === 'REJECTED') return { icon: ICON.ptwRejected, label: 'PTW rejected' };
  return null;
}

/** "✅" for one DO, "2✅" for two. */
export const doIcon = (n: number): string | null => (n > 0 ? (n > 1 ? `${n}${ICON.doDone}` : ICON.doDone) : null);

export function styleOf(i: StyleInput, colours: CalendarColours): EventStyle {
  const fill = (i.salespersonId && colours.fill[i.salespersonId]) || NEUTRAL_FILL;
  // The applicant stored on the job only: the default applicant is stamped when a job is saved, never at render.
  const applicant = i.ptwApplicantId;
  const applicantBar = ptwNeeded(i.ptwStatus) ? (applicant && colours.bar[applicant]) || NEUTRAL_BAR : null;
  // Org Settings > Calendar colours (2026-11-25): a PTW status colour, when set, draws the stripe; else the applicant's.
  const bar = applicantBar ? ptwStatusColour(i.ptwStatus, colours) ?? applicantBar : null;
  const icons: EventStyle['icons'] = [];
  if (i.cancelled) icons.push({ icon: ICON.cancelled, label: 'Cancelled' });
  else if (i.postponed) icons.push({ icon: ICON.postponed, label: 'Postponed' });
  const p = ptwIcon(i.ptwStatus);
  if (p) icons.push(p);
  const d = doIcon(i.doCount);
  if (d) icons.push({ icon: d, label: i.doCount > 1 ? `${i.doCount} DOs generated` : 'DO generated' });
  if (i.cod) icons.push({ icon: ICON.cod, label: 'COD' });
  if (i.sticker) icons.push({ icon: ICON.sticker, label: 'Generate sticker' });
  // An applicant with no colour (the neutral bar) gets no circle.
  const applicantIcon = applicantBar && applicant && applicantBar !== NEUTRAL_BAR ? colourCircle(applicantBar) : null;
  return { fill, text: textOn(fill), bar, icons, greyed: i.cancelled || i.postponed, prefix: null /* 2026-11-25: no (SV) / (M) / (CC) tag on the chips for now (categoryPrefix kept for later) */, ...(applicantIcon ? { applicantIcon } : {}) };
}

/**
 * Salesperson of an order / quotation from the quotation's salesman field
 * (config.salesPerson or documentInfo.salesPerson): a salesman code (S002)
 * of a member, matched without case. Free text (old ERP names such as
 * "Henry") matches nobody: neutral fill.
 */
export function quotationSalesmanCode(config: any): string | null {
  const v = config?.salesPerson ?? config?.documentInfo?.salesPerson ?? null;
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
}

export function salespersonFromCode(code: string | null, codes: Map<string, string>): string | null {
  if (!code) return null;
  return codes.get(code.toUpperCase()) ?? null;
}

/**
 * The calendar's people list (2026-11-19, WCT group): people with no salesperson colour yet get an automatic one,
 * distinct from every colour in use, in name order (stable from load to load). A colour picked in Org Settings >
 * Calendar colours replaces it.
 */
export const AUTO_PALETTE = ['#33b679', '#f09300', '#9e69af', '#c0ca33', '#4285f4', '#e4c441', '#616161', '#a79b8e', '#00897b', '#d81b60', '#5d4037', '#7cb342'] as const;

export interface PanelPerson {
  id: string;
  name: string;
  colour: string;
  /** true = an automatic colour (none picked in Settings yet). */
  auto: boolean;
}

/**
 * Round 39 (Elroy 2026-11-20): a chip is filled with its salesperson's colour exactly as the People panel shows it,
 * the automatic colours too (Henry Hoo orange). A colour picked in Settings still wins; nobody else changes.
 */
export function withPanelFills(colours: CalendarColours, people: PanelPerson[] | null | undefined): CalendarColours {
  if (!people?.length) return colours;
  const fill = { ...colours.fill };
  for (const p of people) if (!fill[p.id] && p.colour) fill[p.id] = p.colour;
  return { ...colours, fill };
}

export function panelPeople(people: Array<{ id: string; name: string }>, fills: Record<string, string>): PanelPerson[] {
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const used = new Set(Object.values(fills).map((c) => c.toLowerCase()));
  const free = AUTO_PALETTE.filter((c) => !used.has(c));
  let n = 0;
  return sorted.map((p) => {
    const fill = fills[p.id];
    if (fill) return { id: p.id, name: p.name, colour: fill, auto: false };
    const pool = free.length ? free : AUTO_PALETTE;
    return { id: p.id, name: p.name, colour: pool[n++ % pool.length], auto: true };
  });
}
