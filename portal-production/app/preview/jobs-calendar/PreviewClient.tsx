"use client";

// Fixture-rendered jobs calendar (WCT, enableJobsCalendar). No API, no sign-in. Served only with PREVIEW_FIXTURES=1.

import React, { useMemo, useState } from "react";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { JobsCalendarPanel } from "@/components/Dashboard/JobsCalendar";
import type { CalendarEvent, CalendarPayload } from "@/components/Dashboard/jobs-calendar/calendarModel";

const at = (day: number, hh: number, mm = 0) => new Date(Date.parse(`2026-11-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`)).toISOString();
const base: Pick<CalendarEvent, "allDay" | "completed" | "cancelled" | "rider" | "crew" | "siteclockUrl" | "deliveryNumber"> = { allDay: false, completed: false, cancelled: false, rider: null, crew: [], siteclockUrl: null, deliveryNumber: null };
const aims = (id: string, kind: CalendarEvent["kind"], n: number, who: string, day: number, hh: number, mins: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...base, id: `aims:${id}`, source: "aims", kind, title: `${kind === "return" ? "Return " : ""}#${n} ${who}`, start: at(day, hh), end: new Date(Date.parse(at(day, hh)) + mins * 60_000).toISOString(),
  status: "scheduled", statusLabel: "Scheduled", address: "10 Anson Road, Singapore 079903", site: who, worker: null, href: `/portal/deliveries/${id}`, deliveryNumber: n, ...over,
});
const sc = (id: string, title: string, day: number, hh: number | null, mins = 60, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...base, id: `sc:${id}`, source: "siteclock", kind: "siteclock", title, start: hh === null ? `2026-11-${String(day).padStart(2, "0")}` : at(day, hh), end: hh === null ? null : new Date(Date.parse(at(day, hh)) + mins * 60_000).toISOString(),
  allDay: hh === null, status: "NOT_STARTED", statusLabel: "Not started", address: "1 Jurong West Central 2", site: "Jurong Point", worker: "Team A", href: null, siteclockUrl: "https://siteclock.osiris.sg/#/jobs", ...over,
});

const EVENTS: CalendarEvent[] = [
  aims("a1", "service", 21, "Ajiya Okonomiyaki Restaurant", 3, 10, 90, { worker: "Muhammad Ali", crew: [{ name: "Muhammad Ali", arrivedAt: at(3, 10, 5), leftAt: at(3, 11, 20) }], status: "completed", statusLabel: "Completed", completed: true, rider: "Muhammad Ali" }),
  aims("a2", "delivery", 22, "Marina Bay Sands", 3, 14, 60),
  aims("a3", "return", 23, "Changi Business Park", 4, 9, 60),
  aims("a4", "service", 24, "E!Avenue #02-346", 5, 11, 120, { worker: "Tan Wei Ming", status: "in_progress", statusLabel: "In progress", rider: "Tan Wei Ming", crew: [{ name: "Tan Wei Ming", arrivedAt: at(5, 11, 2), leftAt: null }] }),
  aims("a5", "delivery", 25, "Raffles City", 6, 15, 60, { status: "cancelled", statusLabel: "Cancelled", cancelled: true }),
  aims("a6", "service", 26, "Tampines Hub", 10, 9, 60, { worker: "Muhammad Ali" }),
  aims("a7", "service", 27, "Jewel Changi", 10, 13, 90, { worker: "Kumar Raj" }),
  aims("a8", "delivery", 28, "Paya Lebar Quarter", 12, 10, 60),
  sc("s1", "Troubleshoot exhaust VSD at rooftop", 3, 8, 60, { crew: [{ name: "Lim Ah Kow", arrivedAt: at(3, 8, 10), leftAt: at(3, 9, 0) }], status: "DONE", statusLabel: "Done", completed: true }),
  sc("s2", "Monthly PM: AHU 1-4", 4, 13, 180),
  sc("s3", "Standby crew", 5, null),
  sc("s4", "Chiller inspection", 11, 9, 120, { worker: "Team B" }),
  sc("s5", "Duct cleaning", 17, 10, 240, { worker: "Team C" }),
];

export default function PreviewClient({ mode, view, cancelled, down }: { mode: "light" | "dark"; view: "dayGridMonth" | "timeGridWeek" | "timeGridDay"; cancelled: boolean; down: boolean }) {
  const theme = useMemo(() => createTheme({ palette: { mode } }), [mode]);
  const [showCancelled, setShowCancelled] = useState(cancelled);
  const data: CalendarPayload = useMemo(
    () => ({ from: "2026-10-26", to: "2026-12-06", timezone: "Asia/Singapore", events: down ? EVENTS.filter((e) => e.source === "aims") : EVENTS, siteclock: { state: down ? "unavailable" : "ok" } }),
    [down],
  );
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ p: 3, maxWidth: 1280, mx: "auto", bgcolor: "background.default", minHeight: "100vh" }}>
        <JobsCalendarPanel data={data} loading={false} error="" showCancelled={showCancelled} onShowCancelled={setShowCancelled} onRange={() => undefined} initialDate="2026-11-03" initialView={view} />
      </Box>
    </ThemeProvider>
  );
}
