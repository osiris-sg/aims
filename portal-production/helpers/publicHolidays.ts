// Jobs calendar public holidays (WCT group, calendar style orgs, 2026-11-24). The API sends `holidays` (from the Field
// module's public holidays table) for calendar style orgs only. Shown as an all-day banner on every view and as the
// first line of that day in the Export list. Pure helpers, tested by helpers/publicHolidays.test.mjs.

export interface PublicHoliday {
  /** yyyy-MM-dd */
  date: string;
  name: string;
}

/** The banner colours: muted, the same in both themes (like the notes' neutral chip). */
export const HOLIDAY_BG = "#eceff1";
export const HOLIDAY_BORDER = "#b0bec5";
export const HOLIDAY_TEXT = "#546e7a";
/** Before the notes (0) and the jobs (1) of each day. */
export const HOLIDAY_ORDER = -1;
/** Class on every banner (CSS hook: no pointer, no hover). */
export const HOLIDAY_CLASS = "aims-jc-holiday";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const nextDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Valid holidays only, one per date (the first wins), by date. */
export function cleanHolidays(holidays: ReadonlyArray<Partial<PublicHoliday>> | null | undefined): PublicHoliday[] {
  // One banner per holiday per day (date + name, any case), however many companies are ticked (2026-11-24).
  const by = new Map<string, PublicHoliday>();
  for (const h of holidays ?? []) {
    const date = clean(h?.date).slice(0, 10);
    const name = clean(h?.name);
    const key = `${date}|${name.toLowerCase()}`;
    if (!YMD.test(date) || !name || by.has(key)) continue;
    by.set(key, { date, name });
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** "Public holiday: Deepavali" (the banner and the Export list line). */
export const holidayExportLine = (name: string): string => `Public holiday: ${clean(name)}`;

/** The holidays on one day (yyyy-MM-dd). */
export const holidaysOn = (holidays: ReadonlyArray<Partial<PublicHoliday>> | null | undefined, date: string): PublicHoliday[] => cleanHolidays(holidays).filter((h) => h.date === date);

/**
 * The holidays as FullCalendar event inputs: one all-day banner per day, muted, not draggable, ordered before the
 * notes and jobs. extendedProps.holiday marks it, so a click handler can ignore it.
 */
export function holidayCalendarInputs(holidays: ReadonlyArray<Partial<PublicHoliday>> | null | undefined) {
  return cleanHolidays(holidays).map((h) => ({
    id: `holiday:${h.date}|${h.name.toLowerCase()}`,
    title: holidayExportLine(h.name),
    start: h.date,
    end: nextDay(h.date),
    allDay: true,
    display: "block" as const,
    backgroundColor: HOLIDAY_BG,
    borderColor: HOLIDAY_BORDER,
    textColor: HOLIDAY_TEXT,
    classNames: ["aims-jc-event", HOLIDAY_CLASS],
    displayOrder: HOLIDAY_ORDER,
    editable: false,
    startEditable: false,
    durationEditable: false,
    interactive: false,
    extendedProps: { holiday: h },
  }));
}
