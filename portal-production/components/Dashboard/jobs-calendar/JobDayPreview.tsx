"use client";

// Round 39 #8 (WCT group, 2026-11-20): the job dialogs' mini calendar. New job (calendar), Add job / Schedule (order
// page, DO menu, job page) and Postpone / Reschedule open as one large dialog: the form on the left, this on the
// right. It shows the chosen day (or its week) from the same calendar data (GET /dashboard/jobs-calendar), with the
// same chips, colours and icons, the person's People ticks and Company filter applied, read only. The form's date
// moves it; a click on an empty slot fills the form's date and time. slotHints (calendarPanel.ts) gives the warning
// above Save (same team at the same time, or 3+ jobs in the slot); it never blocks.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, CircularProgress, Typography, useMediaQuery } from "@mui/material";
import { request } from "@/helpers/request";
import { unwrap } from "@/app/portal/admin/organizations/_lib/siteclock-connection";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import CalendarView from "./CalendarView";
import { filterByPeople, parseHidden, peopleStorageKey, rangeOf, withoutSiteClockJobs, type CalendarPayload } from "./calendarModel";
import { parseFilters, slotHints } from "./calendarPanel";
import { useCalendarApi } from "./calendarAddApi";

export interface JobDayPreviewProps {
  /** YYYY-MM-DD; empty = today. */
  date: string;
  /** "HH:mm", or null / "" for no specific time. */
  time: string | null;
  allDay: boolean;
  durationMin: number;
  /** The form's picked teams / workers (2026-11-25): only picks are compared ("+2PT" typed in Team / crew never is). */
  crew?: Array<{ kind: string; id: string; name: string }> | null;
  /** The shared Schedule dialog's picked SiteClock worker (a name): compared with the other jobs' picked names. */
  team?: string | null;
  /** The job being edited / rescheduled: never shown as its own clash. */
  excludeId?: string | null;
  onPick: (slot: { date: string; time: string | null }) => void;
  /** The warning lines for above Save (empty = none). */
  onHints?: (lines: string[]) => void;
  /** Group New job (2026-11-22): another company of the group was chosen; show that company's own calendar. */
  orgId?: string | null;
}

/** Fixture previews only (/preview/jobs-calendar): the calendar data instead of the API. */
export const JobDayPreviewFixture = createContext<CalendarPayload | null>(null);

const SGT_TODAY = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addMin = (date: string, time: string, min: number) => new Date(Date.parse(`${date}T${time}:00+08:00`) + min * 60_000).toISOString();

export default function JobDayPreview({ date, time, allDay, durationMin, crew = null, team, excludeId, onPick, onHints, orgId = null }: JobDayPreviewProps) {
  const api = useCalendarApi();
  const { getToken, userId } = useAuth();
  const { isHideSiteClockJobs } = useOrganizationFeatures();
  const fixture = useContext(JobDayPreviewFixture);
  // FullCalendar needs a real height: the dialog's (88vh) less its title, actions and padding; phones a fixed one.
  const phone = useMediaQuery((th: any) => th.breakpoints.down("md"));
  const calHeight = phone ? 480 : "calc(88vh - 190px)";
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [loaded, setData] = useState<CalendarPayload | null>(null);
  const data = fixture ?? loaded;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef("");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : SGT_TODAY();

  const onRange = useCallback((startStr: string, endStr: string) => {
    const r = rangeOf(startStr, endStr);
    setRange((cur) => (cur && cur.from === r.from && cur.to === r.to ? cur : r));
  }, []);
  useEffect(() => {
    if (!range || fixture) return;
    const key = `${orgId ?? ""}|${range.from}|${range.to}`;
    latest.current = key;
    setLoading(true);
    (async () => {
      try {
        let payload: CalendarPayload | null;
        if (orgId) {
          // Another company: its own calendar, read with that company's header (the server checks the membership).
          const r = await api<CalendarPayload>("GET", `/dashboard/jobs-calendar?from=${range.from}&to=${range.to}`, undefined, orgId);
          if (!r.ok) throw new Error(r.message || "Couldn't load the calendar");
          payload = r.data;
        } else {
          const token = await getToken();
          if (!token) return;
          const res = await request({ path: `/dashboard/jobs-calendar?from=${range.from}&to=${range.to}`, method: "GET", ownError: true }, undefined, token);
          payload = unwrap<CalendarPayload>(res, "Couldn't load the calendar");
        }
        if (latest.current !== key) return;
        setData(payload ? withoutSiteClockJobs(payload, !!isHideSiteClockJobs) : payload);
        setError("");
      } catch (e: any) {
        if (latest.current === key) setError(e?.message || "Couldn't load the calendar");
      } finally {
        if (latest.current === key) setLoading(false);
      }
    })();
  }, [range, getToken, isHideSiteClockJobs, fixture, orgId, api]);

  // The person's People ticks and Company filter, as the calendar keeps them in this browser.
  const { hidden, companies } = useMemo(() => {
    const key = peopleStorageKey(userId);
    try {
      return { hidden: parseHidden(window.localStorage.getItem(key)), companies: parseFilters(window.localStorage.getItem(key.replace(/^aims-jc-people-hidden:/, "aims-jc-filters:"))).companies };
    } catch {
      return { hidden: [] as string[], companies: [] as string[] };
    }
  }, [userId]);
  const ownOrgId = data?.group?.orgs?.[0]?.id ?? null;
  const events = useMemo(() => {
    const all = data?.events ?? [];
    const byPeople = Array.isArray(data?.people) ? filterByPeople(all, hidden) : all;
    // The Company filter belongs to the calendar the person is in, not to another company's own calendar.
    const shown = companies.length && !orgId ? byPeople.filter((e) => companies.includes(e.orgId || ownOrgId || "")) : byPeople;
    return excludeId ? shown.filter((e) => e.id !== excludeId && e.id !== `aims:${excludeId}`) : shown;
  }, [data, hidden, companies, ownOrgId, excludeId, orgId]);
  const notes = useMemo(() => (Array.isArray(data?.people) && data?.notes ? filterByPeople(data.notes, hidden) : data?.notes), [data, hidden]);

  const t = !allDay && time && /^\d{2}:\d{2}$/.test(time) ? time : null;
  const highlight = useMemo(
    () => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? (t ? { start: addMin(date, t, 0), end: addMin(date, t, Math.max(15, durationMin || 60)), allDay: false } : { start: date, end: date, allDay: true }) : null),
    [date, t, durationMin],
  );
  const crewKey = JSON.stringify(crew ?? []);
  const hints = useMemo(
    () => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? slotHints(events, { date, time: t, durationMin, crew: JSON.parse(crewKey), pickedName: team, excludeId }) : []),
    [events, date, t, durationMin, crewKey, team, excludeId],
  );
  const hintsKey = hints.join("\n");
  useEffect(() => {
    onHints?.(hints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintsKey]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", position: "relative" }} data-tour="job-dialog-calendar">
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {loading && <CircularProgress size={16} sx={{ position: "absolute", top: 10, left: 10, zIndex: 2 }} />}
      <Box>
        <CalendarView
          events={events}
          notes={notes}
          showCancelled
          onRange={onRange}
          initialDate={day}
          initialView="timeGridDay"
          jobWords
          styled={!!data?.style}
          mini={{ height: calHeight, onPick: (s) => onPick({ date: s.date, time: s.allDay ? null : s.time }), highlight, scrollTo: t ? `${String(Math.max(0, Number(t.slice(0, 2)) - 1)).padStart(2, "0")}:00:00` : null }}
        />
      </Box>
    </Box>
  );
}

/** The warning above Save (never blocks). */
export function SlotHintsAlert({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <Alert severity="warning" sx={{ mx: 2, mb: 1, py: 0 }} data-tour="job-dialog-clash">
      {lines.map((l) => (
        <Typography key={l} variant="body2">
          {l}
        </Typography>
      ))}
    </Alert>
  );
}

/** The large dialog's paper: about 90% of the screen on a desktop (phones: the dialog is full screen). */
export const SPLIT_PAPER_SX = { width: "90vw", maxWidth: "1500px", height: "88vh" } as const;

/** Form on the left (scrolls), mini calendar on the right; stacked on phones. */
export function JobSplitContent({ form, preview }: { form: React.ReactNode; preview: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, height: { md: "100%" }, minHeight: 0 }}>
      <Box sx={{ width: { xs: "100%", md: 580 }, flexShrink: 0, overflowY: { md: "auto" }, overflowX: "hidden", pr: { md: 1 } }}>{form}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{preview}</Box>
    </Box>
  );
}

/** The split layout only when asked (the shared Schedule dialog keeps its old layout for every other org). */
export function SplitIf({ split, preview, children }: { split: boolean; preview: React.ReactNode; children: React.ReactNode }) {
  return split ? <JobSplitContent form={children} preview={preview} /> : <>{children}</>;
}
