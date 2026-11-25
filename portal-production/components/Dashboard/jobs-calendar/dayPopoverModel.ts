// "+N more" day card (WCT group, 2026-11-26, Google Calendar's day pop-over): a click on "+N more" in Month opens a
// floating card over that day listing EVERY item of the day. All-day items first (full-width bars in their own
// colours; a pointed end on the side that carries on from the day before / into the next day), then the timed
// items one line each (dot, time, markers, title). Pure helpers, tested by helpers/dayPopover.test.mjs; the card
// itself is DayPopover.tsx.

import { compactTime, panelColor, type CalendarEvent } from "./calendarModel";
import { chipLines } from "./calendarPanel";

/** What the card needs of one FullCalendar segment's event (EventApi fields, copied so the helper stays pure). */
export interface PopoverSegEvent {
  id: string;
  title: string;
  allDay: boolean;
  /** startStr / endStr ("2026-11-10" for all-day, an ISO instant for timed); end is exclusive, null when none. */
  start: string;
  end: string | null;
  backgroundColor?: string;
  textColor?: string;
  display?: string;
  extendedProps?: Record<string, any>;
}

export interface DayPopoverItem {
  key: string;
  allDay: boolean;
  title: string;
  /** Timed items: "10pm". */
  time: string;
  /** ✅ ❌ ⭕ 📌 🟫 and the PTW marks (✋ 👍 👎 + the applicant's circle), shown before the title so they never cut. */
  markers: string;
  /** All-day bar colours (the bar's own); timed: the dot. */
  bg: string;
  text: string;
  dot: string;
  greyed: boolean;
  cancelled: boolean;
  /** All-day: carries on from the day before / into the next day (pointed end on that side). */
  contBefore: boolean;
  contAfter: boolean;
  holiday: boolean;
  /** What a click opens: the job, or the note (both as their chips do). */
  event: CalendarEvent | null;
  note: any | null;
}

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const NEUTRAL_BG = "#cfd8dc";
const NEUTRAL_TEXT = "#37474f";

/** The day's items for the card, in the calendar's own order (all-day first, then timed by start time). */
export function dayPopoverItems(date: string, segEvents: PopoverSegEvent[]): { allDay: DayPopoverItem[]; timed: DayPopoverItem[] } {
  const seen = new Set<string>();
  const allDay: DayPopoverItem[] = [];
  const timed: Array<DayPopoverItem & { at: string; n: number }> = [];
  segEvents.forEach((s, n) => {
    if (!s || s.display === "background" || s.display === "inverse-background") return;
    if (seen.has(s.id)) return;
    seen.add(s.id);
    const p = s.extendedProps ?? {};
    const e = (p.event as CalendarEvent | undefined) ?? null;
    const note = p.note ?? e?.note ?? null;
    const lines = e?.style ? chipLines(e) : null;
    const markers = lines ? [lines.icons, lines.row2].filter(Boolean).join(" ") : "";
    const title = lines ? lines.customer || s.title : s.title;
    const base = {
      key: s.id,
      title,
      markers,
      bg: s.backgroundColor || NEUTRAL_BG,
      text: s.textColor || NEUTRAL_TEXT,
      dot: e ? panelColor(e, true) : s.backgroundColor || NEUTRAL_BG,
      greyed: !!e?.style?.greyed,
      cancelled: !!e?.cancelled,
      holiday: !!p.holiday,
      event: e,
      note,
    };
    if (s.allDay) {
      const startDay = s.start.slice(0, 10);
      const endDay = s.end ? s.end.slice(0, 10) : addDays(startDay, 1);
      allDay.push({ ...base, allDay: true, time: "", contBefore: startDay < date, contAfter: endDay > addDays(date, 1) });
    } else {
      timed.push({ ...base, allDay: false, time: compactTime(s.start), contBefore: false, contAfter: false, at: new Date(s.start).toISOString(), n });
    }
  });
  timed.sort((a, b) => a.at.localeCompare(b.at) || a.n - b.n);
  return { allDay, timed: timed.map(({ at: _a, n: _n, ...r }) => r) };
}

/** The card's header: "TUE" + "10". */
export function dayPopoverHeader(date: string, timeZone = "Asia/Singapore"): { weekday: string; day: string } {
  const d = new Date(`${date}T12:00:00+08:00`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-SG", { timeZone, ...o }).format(d);
  return { weekday: f({ weekday: "short" }).toUpperCase(), day: f({ day: "numeric" }) };
}

/** A bar's outline: a pointed end on each side that carries on (Google's continuation arrow). */
export function barClipPath(contBefore: boolean, contAfter: boolean, point = 8): string | undefined {
  if (!contBefore && !contAfter) return undefined;
  const l = contBefore ? `${point}px 0, ` : "0 0, ";
  const r = contAfter ? `calc(100% - ${point}px) 0, 100% 50%, calc(100% - ${point}px) 100%, ` : "100% 0, 100% 100%, ";
  const lb = contBefore ? `${point}px 100%, 0 50%` : "0 100%";
  return `polygon(${l}${r}${lb})`;
}

/**
 * Where the card sits: over the day cell (Google: centred on it, its top a little above the cell's), kept inside the
 * window with a 16px margin; MUI Popover also keeps it on screen (marginThreshold), this is the start point.
 */
export function dayPopoverPosition(cell: { left: number; top: number; width: number }, win: { width: number }, cardWidth: number): { left: number; top: number } {
  const half = cardWidth / 2;
  const centre = cell.left + cell.width / 2;
  const left = Math.min(Math.max(centre, 16 + half), Math.max(16 + half, win.width - 16 - half));
  return { left, top: Math.max(16, cell.top - 8) };
}

/** The card's width: a bit wider than the cell, between 240 and 340px. */
export const dayPopoverWidth = (cellWidth: number): number => Math.round(Math.min(340, Math.max(240, cellWidth * 1.25)));
