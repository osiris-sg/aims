"use client";

// Fixture-rendered jobs calendar (WCT, enableJobsCalendar). No API, no sign-in. Served only with PREVIEW_FIXTURES=1.

import React, { useMemo, useState } from "react";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { JobsCalendarPanel } from "@/components/Dashboard/JobsCalendar";
import type { CalendarEvent, CalendarPayload } from "@/components/Dashboard/jobs-calendar/calendarModel";
import type { CalendarNote } from "@/helpers/calendarAdd";
import QuickJobDialog from "@/components/Dashboard/jobs-calendar/QuickJobDialog";
import NoteDialog from "@/components/Dashboard/jobs-calendar/NoteDialog";

const at = (day: number, hh: number, mm = 0) => new Date(Date.parse(`2026-11-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`)).toISOString();
const base: Pick<CalendarEvent, "allDay" | "completed" | "cancelled" | "rider" | "crew" | "siteclockUrl" | "deliveryNumber"> = { allDay: false, completed: false, cancelled: false, rider: null, crew: [], siteclockUrl: null, deliveryNumber: null };
const aims = (id: string, kind: CalendarEvent["kind"], n: number, who: string, day: number, hh: number, mins: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...base, id: `aims:${id}`, source: "aims", kind, title: `${kind === "return" ? "Return " : ""}#${n} ${who}`, start: at(day, hh), end: new Date(Date.parse(at(day, hh)) + mins * 60_000).toISOString(),
  status: "scheduled", statusLabel: "Scheduled", address: "10 Anson Road, Singapore 079903", site: who, worker: null, href: `/portal/deliveries/${id}`, deliveryNumber: n,
  // The server's chip label (customer, else site address, else the title without numbers).
  chipLabel: who, ...over,
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

// WCT calendar add (?add=1): a quick job on an unsigned quotation (PTW badge), an order job (Order + QO + DO), a misc job, and notes.
const ADD_EVENTS: CalendarEvent[] = [
  aims("q1", "delivery", 29, "Domino's Pizza (Tampines)", 4, 15, 60, { untagged: true, ptw: { status: "REQUIRED", label: "Required", remark: "MCST form" }, worker: "Kumar Raj", quotationNumber: "QO202611-012", quotationHref: "/portal/documents/QUOTATION/tpl-q/q-12" }),
  aims("q2", "service", 30, "Changi Airport T3", 10, 16, 60, {
    orderNumber: "ORD202611-004", orderHref: "/portal/orders/ord-4", title: "ORD202611-004 · #30 Changi Airport T3", ptw: { status: "APPROVED", label: "Approved", remark: null },
    quotationNumber: "QO202611-004", quotationHref: "/portal/documents/QUOTATION/tpl-q/q-4", doNumber: "DO202611021", doTag: "Pending", doHref: "/portal/documents/DELIVERY_ORDER/tpl-do/do-21",
  }),
  aims("q3", "service", 31, "Kulnari Adventure Golf", 12, 14, 60),
];
const NOTES: CalendarNote[] = [
  { id: "n1", title: "Ali on leave", type: "LEAVE", staffId: "w1", staffName: "Muhammad Ali", startDate: "2026-11-09", endDate: "2026-11-11", allDay: true, startTime: null, endTime: null, remark: null },
  { id: "n2", title: "Loading bay closed", type: "BLOCKAGE", staffId: null, staffName: null, startDate: "2026-11-03", endDate: "2026-11-03", allDay: false, startTime: "09:00", endTime: "12:00", remark: "Tuas site" },
  { id: "n3", title: "PTW window, Jewel", type: "PTW", staffId: null, staffName: null, startDate: "2026-11-05", endDate: "2026-11-06", allDay: true, startTime: null, endTime: null, remark: null },
];

// Calendar style (?style=1, enableCalendarStyle): fills by salesperson, PTW bars, icons, greyed cancelled / postponed.
const icon = (i: string, label: string) => ({ icon: i, label });
const st = (fill: string, bar: string | null, icons: Array<{ icon: string; label: string }>, over: Partial<NonNullable<CalendarEvent["style"]>> = {}): NonNullable<CalendarEvent["style"]> => ({
  fill, text: "#ffffff", bar, icons, greyed: false, prefix: null, ...over,
});
const STYLE_EVENTS: CalendarEvent[] = [
  aims("y1", "service", 41, "Domino's Pizza (Tampines)", 4, 10, 90, { orderNumber: "ORD202611-003", title: "ORD202611-003 · #41 Domino's Pizza (Tampines)", salesperson: { id: "u1", name: "Nat HH" }, ptwApplicant: { id: "b", name: "Bala" }, style: st("#039be5", "#d50000", [icon("✋", "PTW pending"), icon("✅", "DO completed")]) }),
  aims("y2", "service", 42, "Yoshinoya (S)", 4, 14, 60, { salesperson: { id: "u2", name: "Amy Yap" }, ptwApplicant: { id: "j", name: "Joyna" }, cod: true, style: st("#8e24aa", "#f6bf26", [icon("👍", "PTW approved"), icon("2✅", "2 DOs completed"), icon("🟫", "COD")]) }),
  aims("y3", "delivery", 43, "Kulnari Adventure Golf", 5, 9, 60, { category: "Site visit", style: st("#b0bec5", null, [], { text: "#212121", prefix: "(SV)" }) }),
  aims("y4", "service", 44, "Jewel Changi", 5, 15, 60, { ptwApplicant: { id: "k", name: "Kherry" }, style: st("#e67c73", "#0b8043", [icon("👎", "PTW rejected")]) }),
  aims("y5", "delivery", 45, "Raffles City", 6, 11, 60, { status: "cancelled", statusLabel: "Cancelled", cancelled: true, style: st("#3f51b5", null, [icon("❌", "Cancelled")], { greyed: true }) }),
  aims("y6", "service", 46, "Tampines Hub", 6, 14, 60, { statusLabel: "Postponed", postponed: true, category: "Meeting", style: st("#039be5", null, [icon("⭕", "Postponed")], { greyed: true, prefix: "(M)" }) }),
  aims("y7", "service", 47, "BC Air: Paya Lebar", 10, 10, 60, { orgId: "c", orgName: "BC Air", foreign: true, category: "Collect cheque", style: st("#8e24aa", null, [], { prefix: "(CC)" }) }),
  aims("y8", "service", 48, "Sheng Siong (Bedok)", 19, 9, 120, { salesperson: { id: "u2", name: "Amy Yap" }, sticker: true, style: st("#8e24aa", null, [icon("📌", "Generate sticker")]) }),
  aims("y9", "delivery", 49, "Changi City Point", 19, 0, 0, { allDay: true, start: "2026-11-19", end: null, salesperson: { id: "u1", name: "Nat HH" }, style: st("#039be5", null, []) }),
  aims("y10", "service", 50, "Woodlands Civic Centre", 20, 14, 60, { salesperson: { id: "u1", name: "Nat HH" }, ptwApplicant: { id: "b", name: "Bala" }, sticker: true, style: st("#039be5", "#d50000", [icon("✋", "PTW pending"), icon("📌", "Generate sticker")]) }),
  // 2026-11-19: every salesperson tint with a PTW bar on the right; an applicant who is not on the PTW applicants list.
  aims("y11", "service", 51, "Jewel Changi Airport", 12, 10, 90, { salesperson: { id: "u4", name: "Joyna" }, ptwApplicant: { id: "pta_joyna", name: "Joyna" }, style: st("#3f51b5", "#f6bf26", [icon("✋", "PTW pending")]) }),
  aims("y12", "service", 52, "Ion Orchard", 12, 14, 60, { salesperson: { id: "u3", name: "PC Tan" }, ptwApplicant: { id: "pta_bala", name: "Bala" }, style: st("#e67c73", "#d50000", [icon("👍", "PTW approved")]) }),
  aims("y13", "service", 53, "Bugis Junction", 13, 9, 60, { ptwApplicant: { id: "user_richie", name: "Richie", inList: false }, style: st("#b0bec5", "#455a64", [icon("✋", "PTW pending")], { text: "#212121" }) }),
  aims("y14", "delivery", 54, "Northpoint City", 13, 13, 60, { salesperson: { id: "u2", name: "Amy Yap" }, ptwApplicant: { id: "pta_kherry", name: "Kherry" }, style: st("#8e24aa", "#0b8043", [icon("✋", "PTW pending")]) }),
  // Add-on 4: a busy day (17 Nov, 9 jobs) for the Month rows: 6 rows, then "+3 more".
  aims("b1", "service", 61, "Kopitiam Investment @ Jurong Point", 17, 8, 60, { salesperson: { id: "u1", name: "Nat HH" }, ptwApplicant: { id: "pta_bala", name: "Bala" }, style: st("#039be5", "#d50000", [icon("✋", "PTW pending")]) }),
  aims("b2", "service", 62, "Yoshinoya (S) Pte Ltd", 17, 9, 30, { salesperson: { id: "u2", name: "Amy Yap" }, style: st("#8e24aa", null, [icon("✅", "DO completed")]) }),
  aims("b3", "service", 63, "Domino's Pizza Singapore Pte Ltd (Kebun Baru Community Club)", 17, 9, 60, { salesperson: { id: "u3", name: "PC Tan" }, ptwApplicant: { id: "pta_joyna", name: "Joyna" }, style: st("#e67c73", "#f6bf26", [icon("👍", "PTW approved")]) }),
  aims("b4", "delivery", 64, "Six1two Pte Ltd", 17, 10, 60, { salesperson: { id: "u4", name: "Joyna" }, ptwApplicant: { id: "pta_kherry", name: "Kherry" }, style: st("#3f51b5", "#0b8043", [icon("✋", "PTW pending"), icon("🟫", "COD")]) }),
  aims("b5", "service", 65, "Old Chang Kee @ Ng Teng Fong Hospital", 17, 11, 60, { salesperson: { id: "u1", name: "Nat HH" }, status: "cancelled", statusLabel: "Cancelled", cancelled: true, style: st("#039be5", null, [icon("❌", "Cancelled")], { greyed: true }) }),
  aims("b6", "service", 66, "Brinda's Pte Ltd", 17, 13, 30, { salesperson: { id: "u2", name: "Amy Yap" }, postponed: true, statusLabel: "Postponed", style: st("#8e24aa", "#d50000", [icon("⭕", "Postponed")], { greyed: true }) }),
  aims("b7", "service", 67, "Kiat Lay Coldroom Specialist", 17, 14, 60, { salesperson: { id: "u3", name: "PC Tan" }, style: st("#e67c73", null, [icon("📌", "Generate sticker")]) }),
  aims("b8", "service", 68, "HongLi Eatery House", 17, 16, 60, { ptwApplicant: { id: "pta_bala", name: "Bala" }, style: st("#b0bec5", "#d50000", [icon("✋", "PTW pending")], { text: "#212121" }) }),
  aims("b9", "delivery", 69, "Iron Chef F&B @ FoodLoft", 17, 21, 30, { salesperson: { id: "u4", name: "Joyna" }, style: st("#3f51b5", null, []) }),
].map((e, i) => (e.foreign ? e : { ...e, createdBy: i % 3 === 0 ? { id: "u1", name: "Nat HH" } : i % 3 === 1 ? { id: "u2", name: "Amy Yap" } : null }));
// People list (2026-11-19): creators + the Sales people, with their colours (Joyna: automatic colour).
const STYLE_PEOPLE = [
  { id: "u2", name: "Amy Yap", colour: "#8e24aa", auto: false },
  { id: "j", name: "Joyna Chua", colour: "#33b679", auto: true },
  { id: "u1", name: "Nat HH", colour: "#039be5", auto: false },
  { id: "u3", name: "Rave Ng", colour: "#e67c73", auto: false },
];
const STYLE_NOTES = [
  { ...NOTES[0], startDate: "2026-11-18", endDate: "2026-11-20", createdBy: { id: "j", name: "Joyna Chua" } },
  { ...NOTES[1], startDate: "2026-11-19", endDate: "2026-11-19", createdBy: null },
];
const STYLE_LEGEND = [icon("✋", "PTW pending"), icon("👍", "PTW approved"), icon("👎", "PTW rejected"), icon("✅", "DO completed"), icon("❌", "Cancelled"), icon("⭕", "Postponed"), icon("📅", "Leave"), icon("🟫", "COD"), icon("📌", "Generate sticker")];

export default function PreviewClient({ mode, view, cancelled, down, add = false, styled = false, hq = false }: { mode: "light" | "dark"; view: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "schedule"; cancelled: boolean; down: boolean; add?: boolean; styled?: boolean; hq?: boolean }) {
  const theme = useMemo(() => createTheme({ palette: { mode } }), [mode]);
  const [showCancelled, setShowCancelled] = useState(cancelled);
  const [adding, setAdding] = useState<{ kind: "job" | "note"; slot: { date: string; time: string } } | null>(null);
  const [editNote, setEditNote] = useState<CalendarNote | null>(null);
  const data: CalendarPayload = useMemo(
    () => ({
      from: "2026-10-26",
      to: "2026-12-06",
      timezone: "Asia/Singapore",
      events: styled ? STYLE_EVENTS : [...(down ? EVENTS.filter((e) => e.source === "aims") : EVENTS), ...(add ? ADD_EVENTS : [])],
      siteclock: { state: down ? "unavailable" : "ok" },
      ...(add ? { notes: styled ? STYLE_NOTES : NOTES } : {}),
      ...(styled ? { style: { legend: STYLE_LEGEND }, people: STYLE_PEOPLE, group: { orgs: [{ id: "p", name: "WCT (S)" }, { id: "c", name: "BC Air" }, { id: "r", name: "Racking" }] } } : {}),
      ...(hq ? { hqView: true } : {}),
    }),
    [down, add, styled, hq],
  );
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ p: 3, maxWidth: 1280, mx: "auto", bgcolor: "background.default", minHeight: "100vh" }}>
        <JobsCalendarPanel
          data={data}
          loading={false}
          error=""
          showCancelled={showCancelled}
          onShowCancelled={setShowCancelled}
          onRange={() => undefined}
          initialDate="2026-11-03"
          initialView={view}
          jobWords={add}
          canAdd={add}
          onAdd={(kind, slot) => setAdding({ kind, slot })}
          onNoteClick={setEditNote}
        />
        {add && (
          <>
            <QuickJobDialog open={adding?.kind === "job"} slot={adding?.slot} withQuotation onClose={() => setAdding(null)} onSaved={() => setAdding(null)} />
            <NoteDialog open={adding?.kind === "note" || !!editNote} slot={adding?.kind === "note" ? adding.slot : null} note={editNote} onClose={() => { setAdding(null); setEditNote(null); }} onSaved={() => undefined} />
          </>
        )}
      </Box>
    </ThemeProvider>
  );
}
