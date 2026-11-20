// Dashboard "Today's jobs" card (jobs calendar orgs, the WCT group; Elroy 2026-11-21): today's jobs as
// the calendar chips read them (time, status icons, customer), all-day jobs first, then by time;
// cancelled jobs left out; another company's job (group calendar) is listed without a link. The card shows the first TODAY_MAX and "+N more".
import { chipLines } from "@/components/Dashboard/jobs-calendar/calendarPanel";
import type { CalendarEvent } from "@/components/Dashboard/jobs-calendar/calendarModel";

export const TODAY_MAX = 6;

export interface TodayRow {
  id: string;
  time: string;
  icons: string;
  customer: string;
  href: string | null;
}

export function todaysJobs(events: CalendarEvent[], max = TODAY_MAX): { rows: TodayRow[]; more: number } {
  const live = events
    .filter((e) => !e.cancelled)
    .slice()
    .sort((a, b) => (a.allDay === b.allDay ? String(a.start).localeCompare(String(b.start)) : a.allDay ? -1 : 1));
  const rows = live.slice(0, max).map((e) => {
    const l = chipLines(e);
    return { id: e.id, time: l.time, icons: l.icons, customer: l.customer, href: e.foreign ? null : e.href };
  });
  return { rows, more: Math.max(0, live.length - max) };
}
