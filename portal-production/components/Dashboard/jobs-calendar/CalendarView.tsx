"use client";

// The FullCalendar part of the jobs calendar (browser only: loaded with
// next/dynamic from JobsCalendar.tsx). Month by default, week and day views,
// Singapore time via the Luxon plugin. Clicking an event opens a small card at
// the click position.
// WCT calendar add (2026-11-04, canAdd): a click on an empty day / slot offers
// "Job" or "Note"; notes are slim neutral chips listed above the jobs; job chips
// show a PTW badge. (The "Untagged" mark went 2026-11-16: purple = no order.)
// WCT (openOnClick, 2026-11-16): colours by PTW state and order (purple = Misc
// job, no order). A click or tap opens the job's details in a panel on the right
// (links order > DO > job; a SiteClock job opens in SiteClock); it stays open
// until closed or another job is clicked. "+n more" lists that day's jobs in the
// panel. Calendar add on (2026-11-17): the panel's Order / Quotation / DO numbers
// are links (in-app push, so Back returns here) and an order job's title opens
// the order. (Replaced the hover card, whose card covered the chips below it, so a
// click there opened the hovered job instead of the one under the pointer.)
// Group calendar (2026-11-17, enableGroupCalendar on a parent org): child orgs'
// jobs and notes join read only, each named with its company. A child's link
// opens only for a member of that org and only after "Switch and open" (the tab
// switches org on purpose, never silently); for anyone else it is view only.
// Calendar style (2026-11-18, enableCalendarStyle, WCT group incl. child items): Google Calendar-like chips, fill =
// the salesperson's colour, a slim left bar = the PTW applicant's (no bar without a PTW), line 1 icons + title,
// line 2 the time range; cancelled / postponed greyed, never hidden; Leave notes lead with 📅. Line 1 since
// 2026-11-19: prefix + customer only (chipTitle); the hover text and the side panel keep the full title.
// Schedule view (2026-11-19, calendar style orgs): "Schedule" next to Month / Week / Day, a month at a time as a list
// grouped by date (date badge on the left; each row time, dot, icons, title, site). It shows the same (filtered)
// items, opens on today and a click opens the same side panel. FullCalendar keeps the toolbar and paging; the list is
// our own, rendered into the custom view's element (a stable host node, through a React portal).

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import luxonPlugin from "@fullcalendar/luxon3";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import JobFieldIcon from "@/components/jobFields/JobFieldIcon";
import { Box, Button, ButtonBase, Chip, Dialog, DialogActions, DialogTitle, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Popover, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import WorkOutlineIcon from "@mui/icons-material/WorkOutline";
import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import { ADD_MENU_TEXT, newButtonSlot, noteTitle, noteToCalendarInput, noteType, noteWhen, ptwColor, slotOf, type CalendarNote } from "@/helpers/calendarAdd";
import { todayIso } from "@/helpers/orgToday";
import { HOLIDAY_BG, HOLIDAY_TEXT, holidayCalendarInputs, holidayExportLine, holidaysOn, type PublicHoliday } from "@/helpers/publicHolidays";
import { categoryChipTitle } from "@/helpers/jobCategory";
import { ACTIVE_ORG_KEY } from "@/helpers/multiOrg";
import { alpha, useTheme } from "@mui/material/styles";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "next/link";
import { CALENDAR_TZ, CHIP_TEXT, CHIP_TIME, GREYED_OPACITY, chipBorder, chipFill, applicantLabel, badgeTitle, chipTimeRange, crewLine, crossOrgTarget, dayOfInstant, kindLabel, orgLabel, panelColor, panelLinks, panelMoreLink, panelRefs, rangeOf, scheduleBadge, scheduleDays, scheduleScrollDay, styledTitle, timeWindow, toCalendarInputs, wctKindLabel, ymdOf, type CalendarEvent, type GroupTag, type ScheduleDay, type ScheduleRow } from "./calendarModel";
import DoStatusTag from "@/components/DoStatusTag";
import StyledJobPanel, { type CalendarActions } from "./StyledJobPanel";
import { RETURN_ORG_KEY, chipLines, chipTone, customerOf, hoverLines, postponedLabel, rescheduleClashes, returnOrgMarker, scheduleLines, type RescheduleTarget } from "./calendarPanel";

interface Props {
  events: CalendarEvent[];
  showCancelled: boolean;
  onRange: (startStr: string, endStr: string) => void;
  /** Fixture previews only: open on this day / view instead of today / month. */
  initialDate?: string;
  initialView?: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "schedule";
  /** WCT (enableWctOrders): "Job" wording. */
  jobWords?: boolean;
  /** WCT: a click opens the job in the side panel; "+n more" lists the day there. */
  openOnClick?: boolean;
  /** WCT: the calendar is the whole dashboard, so it fills the screen. */
  fullHeight?: boolean;
  /** WCT calendar add: notes to draw, and what a click on an empty slot / a note does. */
  notes?: CalendarNote[];
  canAdd?: boolean;
  onAdd?: (kind: "job" | "note", slot: { date: string; time: string }) => void;
  onNoteClick?: (note: CalendarNote) => void;
  /** All-day jobs (2026-11-10): drag one to another day. Throws to snap it back. */
  onMove?: (event: CalendarEvent, date: string) => Promise<void>;
  /** Calendar style (enableCalendarStyle): Leave notes lead with 📅 (the jobs carry their own style). */
  styled?: boolean;
  /** Calendar style orgs (2026-11-19): the "Schedule" view next to Month / Week / Day. */
  schedule?: boolean;
  /** WCT group calendar (enableGroupCalendar, 2026-11-23): "+ New" beside the views opens the same Job / Note menu as a cell. */
  newButton?: boolean;
  /** Calendar search pick (2026-11-23): go to this day and open the job (or the note); n changes on every pick. */
  focus?: { id: string; kind: "job" | "note"; date: string; n: number } | null;
  /** Singapore public holidays (2026-11-24, calendar style orgs): an all-day banner in every view. */
  holidays?: PublicHoliday[];
  /** One job form (2026-11-24): the side panel's Edit and Complete job. */
  onEditJob?: (e: CalendarEvent) => void;
  onCompleteJob?: (e: CalendarEvent) => void;
  /** Round 36 (calendar style): what the side panel may do (toggles, Cancel / Undo, Reschedule); absent = read only. */
  actions?: CalendarActions;
  /**
   * Round 39 #8: the job dialogs' mini calendar. Read only (no panel, pop-over, add menu or drag), Day / Week only,
   * follows initialDate, a click on an empty slot picks it, the chosen time is shaded.
   */
  mini?: { height: number | string; onPick: (slot: { date: string; time: string; allDay: boolean }) => void; highlight?: { start: string; end: string; allDay: boolean } | null; scrollTo?: string | null };
}

export const SCHEDULE_VIEW = "schedule";

// Calendar style chips (WCT group; only jobs with `style` use these). 2026-11-22: two sizes up from 0.72 / 0.64 / 0.70rem
// (Month, Week, Day) and 0.875 / 0.75rem (Schedule). Month cells grow to keep about 4 two-row chips before "+n more".
export const CHIP_FONT = { text: "0.85rem", time: "0.76rem", row2: "0.82rem" } as const;
// 2026-11-24: back to the old, smaller size (Schedule view only).
export const SCHEDULE_FONT = { text: "0.875rem", time: "0.75rem", row2: "0.75rem" } as const;
export const MONTH_CELL_MIN = 206;

export default function CalendarView({
  events,
  showCancelled,
  onRange,
  initialDate,
  initialView = "dayGridMonth",
  jobWords = false,
  openOnClick = false,
  fullHeight = false,
  notes,
  canAdd = false,
  onAdd,
  onNoteClick,
  onMove,
  styled = false,
  schedule = false,
  newButton = false,
  focus = null,
  holidays,
  onEditJob,
  onCompleteJob,
  actions,
  mini,
}: Props) {
  const theme = useTheme();
  const [viewType, setViewType] = useState<string>(initialView);
  // Schedule view: FullCalendar's range on screen and the host node the list renders into.
  const [visible, setVisible] = useState<{ from: string; to: string } | null>(null);
  const [scheduleHost] = useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.style.height = "100%";
    return el;
  });
  const scheduleViews = useMemo(
    () =>
      schedule && scheduleHost
        ? { [SCHEDULE_VIEW]: { content: () => ({ domNodes: [scheduleHost] }), duration: { months: 1 }, buttonText: "Schedule" } }
        : undefined,
    [schedule, scheduleHost],
  );
  // The people list opening / closing beside the calendar changes its width, not the window's: FullCalendar only
  // re-measures on window resize, so watch the box itself.
  const calRef = useRef<FullCalendar | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === last) return;
      last = el.clientWidth;
      calRef.current?.getApi().updateSize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Round 39 #8 (mini): the form's date moves the mini calendar, its time scrolls into view.
  useEffect(() => {
    if (!mini || !initialDate) return;
    const api = calRef.current?.getApi();
    if (!api) return;
    if (api.view.currentStart > new Date(`${initialDate}T23:59:59+08:00`) || api.view.currentEnd <= new Date(`${initialDate}T00:00:00+08:00`)) api.gotoDate(initialDate);
  }, [mini, initialDate]);
  useEffect(() => {
    if (mini?.scrollTo) calRef.current?.getApi().scrollToTime(mini.scrollTo);
  }, [mini?.scrollTo]);
  // Round 36: the side panel's changes show at once (overrides) until the calendar reloads from the server.
  const [overrides, setOverrides] = useState<Record<string, CalendarEvent>>({});
  useEffect(() => setOverrides({}), [events]);
  const liveEvents = useMemo(() => (Object.keys(overrides).length ? events.map((e) => overrides[e.id] ?? e) : events), [events, overrides]);
  // Postpone / Reschedule: the picked day; the calendar jumps there behind the panel and the clashing jobs are marked.
  const [preview, setPreview] = useState<RescheduleTarget | null>(null);
  const onReschedulePreview = useCallback((t: RescheduleTarget | null) => {
    setPreview(t);
    if (t) calRef.current?.getApi().gotoDate(t.date);
  }, []);
  // Another company's job (group calendar): a member opens it in one click; the calendar switches back on return.
  const crossOpen = useCallback((orgId: string, href: string) => {
    try {
      window.sessionStorage.setItem(RETURN_ORG_KEY, returnOrgMarker(window.sessionStorage.getItem(ACTIVE_ORG_KEY)));
      window.sessionStorage.setItem(ACTIVE_ORG_KEY, orgId);
    } catch {
      return;
    }
    window.location.assign(href);
  }, []);
  const onScheduleRow = (row: ScheduleRow, pos: { left: number; top: number }) => {
    if (row.note) {
      if (row.note.foreign) return setNoteView({ pos, note: row.note });
      return onNoteClick?.(row.note);
    }
    if (!row.event) return;
    if (row.event.note) {
      const n = { ...row.event.note, ...(row.event.foreign ? { foreign: true as const, orgId: row.event.orgId, orgName: row.event.orgName } : {}) } as CalendarNote & GroupTag;
      return n.foreign ? setNoteView({ pos, note: n }) : onNoteClick?.(n);
    }
    if (openOnClick) return setPanel({ event: row.event, day: null });
    setOpen({ pos, event: row.event });
  };
  const [open, setOpen] = useState<{ pos: { left: number; top: number }; event: CalendarEvent } | null>(null);
  // Group calendar: a child org's note (read only) and a confirmed switch into a child org.
  const [noteView, setNoteView] = useState<{ pos: { left: number; top: number }; note: CalendarNote & GroupTag } | null>(null);
  const [switchTo, setSwitchTo] = useState<{ orgId: string; orgName: string; href: string } | null>(null);
  const onCrossOrg = (t: { orgId: string; orgName: string }, href: string) => setSwitchTo({ ...t, href });
  const [addMenu, setAddMenu] = useState<{ pos: { left: number; top: number }; slot: { date: string; time: string } } | null>(null);
  // WCT: the side panel: one job, or a day's jobs ("+n more"; a job picked from it keeps the way back).
  const [panel, setPanel] = useState<{ event: CalendarEvent | null; day: { date: string; events: CalendarEvent[] } | null } | null>(null);
  const patchEvent = useCallback((e: CalendarEvent) => {
    setOverrides((o) => ({ ...o, [e.id]: e }));
    setPanel((p) => (p?.event?.id === e.id ? { ...p, event: e } : p));
  }, []);
  // A reload (or a change made in the panel) refreshes the job the panel shows.
  useEffect(() => {
    setPanel((p) => {
      if (!p?.event) return p;
      const fresh = liveEvents.find((x) => x.id === p.event!.id);
      return fresh && fresh !== p.event ? { ...p, event: fresh } : p;
    });
  }, [liveEvents]);
  const clashes = useMemo(() => (preview && panel?.event ? rescheduleClashes(liveEvents, panel.event, preview) : []), [preview, panel, liveEvents]);
  const clashIds = useMemo(() => new Set(clashes.map((c) => c.event.id)), [clashes]);
  // Notes first on each day (displayOrder 0), then the jobs.
  // Calendar style (WCT group): Month shows compact Google Calendar rows (StyledRow), Week / Day keep the blocks.
  const styledCal = useMemo(() => liveEvents.some((e) => !!e.style), [liveEvents]);
  const monthRows = styledCal && viewType === "dayGridMonth";
  const inputs = useMemo(
    () => [
      ...holidayCalendarInputs(holidays ?? []),
      ...(notes ?? []).map((n) => noteToCalendarInput(n, styled)),
      ...toCalendarInputs(liveEvents, showCancelled, !!onMove && !mini, openOnClick).map((i) => ({ ...i, displayOrder: 1, ...(clashIds.has(i.id) ? { classNames: [...i.classNames, "aims-jc-clash"] } : {}) })),
      // Round 39 #8: the time chosen in the job form, shaded behind the jobs.
      ...(mini?.highlight ? [{ id: "aims-jc-pick", start: mini.highlight.start, end: mini.highlight.end, allDay: mini.highlight.allDay, display: "background", backgroundColor: theme.palette.primary.main, classNames: ["aims-jc-pick"] }] : []),
    ],
    [liveEvents, showCancelled, notes, onMove, openOnClick, styled, clashIds, mini?.highlight, theme.palette.primary.main, holidays],
  );

  const onDateClick = (arg: DateClickArg) => {
    setAddMenu({ pos: { left: arg.jsEvent.clientX, top: arg.jsEvent.clientY }, slot: slotOf(arg.dateStr, arg.allDay) });
  };
  // "+ New": the view on screen (its own days, not the greyed days around a month), kept by datesSet.
  const shownView = useRef<{ type: string; from: string; to: string } | null>(null);
  const showNewButton = newButton && canAdd && !mini;
  const customButtons = useMemo(
    () =>
      showNewButton
        ? {
            aimsNew: {
              text: "+ New",
              hint: "New job or note",
              click: (ev: MouseEvent, el: HTMLElement) => {
                const v = shownView.current;
                if (!v) return;
                // At the click, like a cell click; from the keyboard (no pointer position) under the button.
                const r = el.getBoundingClientRect();
                const pos = ev.clientX || ev.clientY ? { left: ev.clientX, top: ev.clientY } : { left: r.left, top: r.bottom };
                setAddMenu({ pos, slot: newButtonSlot(v, todayIso(new Date(), CALENDAR_TZ)) });
              },
            },
          }
        : undefined,
    [showNewButton],
  );

  // Calendar search: jump to the day, then open the job's panel (or the note) once that day's items are loaded.
  const pendingFocus = useRef<NonNullable<Props["focus"]> | null>(null);
  const tryFocus = useCallback(() => {
    const f = pendingFocus.current;
    if (!f) return;
    if (f.kind === "job") {
      const e = liveEvents.find((x) => x.id === f.id);
      if (!e) return;
      pendingFocus.current = null;
      if (openOnClick) setPanel({ event: e, day: null });
      else setOpen({ pos: { left: window.innerWidth / 2, top: 160 }, event: e });
      return;
    }
    const n = ((notes ?? []).find((x) => x.id === f.id) ?? liveEvents.find((x) => x.noteId === f.id)?.note) as (CalendarNote & GroupTag) | undefined;
    if (!n) return;
    pendingFocus.current = null;
    if (n.foreign) setNoteView({ pos: { left: window.innerWidth / 2, top: 160 }, note: n });
    else onNoteClick?.(n);
  }, [liveEvents, notes, openOnClick, onNoteClick]);
  const jumpTo = useCallback(
    (f: { id: string; kind: "job" | "note"; date: string }) => {
      pendingFocus.current = { ...f, n: 0 };
      calRef.current?.getApi().gotoDate(f.date);
      tryFocus();
    },
    [tryFocus],
  );
  useEffect(() => {
    if (!focus) return;
    jumpTo(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);
  useEffect(() => {
    tryFocus();
  }, [tryFocus]);

  const onClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    if (arg.event.extendedProps.holiday) return;
    const note = arg.event.extendedProps.note as (CalendarNote & GroupTag) | undefined;
    if (note?.foreign) return setNoteView({ pos: { left: arg.jsEvent.clientX, top: arg.jsEvent.clientY }, note });
    if (note) return onNoteClick?.(note);
    const e = arg.event.extendedProps.event as CalendarEvent;
    if (e?.note) {
      const n = { ...e.note, ...(e.foreign ? { foreign: true as const, orgId: e.orgId, orgName: e.orgName } : {}) } as CalendarNote & GroupTag;
      return n.foreign ? setNoteView({ pos: { left: arg.jsEvent.clientX, top: arg.jsEvent.clientY }, note: n }) : onNoteClick?.(n);
    }
    // WCT: the clicked job, in the panel (desktop and touch alike).
    if (openOnClick) return setPanel({ event: e, day: null });
    setOpen({ pos: { left: arg.jsEvent.clientX, top: arg.jsEvent.clientY }, event: e });
  };

  // Only an all-day job is draggable (toCalendarInputs), and only onto another day.
  const onDrop = async (arg: EventDropArg) => {
    const e = arg.event.extendedProps.event as CalendarEvent | undefined;
    if (!e || !onMove || !arg.event.allDay || !arg.event.startStr) return arg.revert();
    try {
      await onMove(e, ymdOf(arg.event.startStr));
    } catch {
      arg.revert();
    }
  };

  const border = theme.palette.divider;
  return (
    <Box
      ref={boxRef}
      data-tour="jobs-calendar"
      sx={{
        // FullCalendar reads its colours from these variables; tie them to the MUI theme so both modes work.
        "--fc-border-color": border,
        "--fc-page-bg-color": theme.palette.background.paper,
        "--fc-neutral-bg-color": alpha(theme.palette.text.primary, 0.04),
        "--fc-list-event-hover-bg-color": alpha(theme.palette.text.primary, 0.06),
        "--fc-today-bg-color": alpha(theme.palette.primary.main, 0.08),
        "--fc-button-bg-color": theme.palette.primary.main,
        "--fc-button-border-color": theme.palette.primary.main,
        "--fc-button-hover-bg-color": theme.palette.primary.dark,
        "--fc-button-hover-border-color": theme.palette.primary.dark,
        "--fc-button-active-bg-color": theme.palette.primary.dark,
        "--fc-button-active-border-color": theme.palette.primary.dark,
        "--fc-button-text-color": theme.palette.primary.contrastText,
        color: "text.primary",
        "& .fc .fc-toolbar-title": { fontSize: "1.15rem", fontWeight: 600 },
        "& .fc .fc-button": { textTransform: "capitalize", fontSize: "0.8rem", padding: "4px 10px" },
        "& .fc .fc-col-header-cell-cushion, & .fc .fc-daygrid-day-number": { color: "text.primary", textDecoration: "none" },
        "& .fc a[data-navlink]:hover": { textDecoration: "underline", cursor: "pointer" },
        "& .fc a": { color: "inherit" },
        "& .aims-jc-event": { cursor: "pointer" },
        ...(canAdd ? { "& .fc-daygrid-day, & .fc-timegrid-slot-lane": { cursor: "copy" } } : {}),
        "& .aims-jc-completed": { opacity: 0.5 },
        // Notes: one slim neutral chip, not a full bar.
        "& .aims-jc-note": { fontSize: "0.68rem", lineHeight: 1.25, borderRadius: "8px", mx: "2px", px: "2px", py: 0, fontWeight: 500 },
        "& .aims-jc-note .fc-event-main": { color: "#37474f", padding: "0 2px" },
        "& .aims-jc-cancelled .fc-event-title, & .aims-jc-cancelled .fc-event-time": { textDecoration: "line-through" },
        // Calendar style: cancelled / postponed stay, greyed out (fully grey; the softer fills keep the text readable
        // at this opacity: GREYED_OPACITY in calendarModel, checked by the contrast tests).
        "& .aims-jc-greyed": { opacity: GREYED_OPACITY, filter: "grayscale(1)" },
        // Round 36: postponed / on hold = faded (greyed), cancelled = fully grey; a reschedule clash is outlined red.
        "& .aims-jc-tone-postponed": { opacity: 0.55, filter: "grayscale(0.5)" },
        "& .aims-jc-clash": { outline: "2px solid #d32f2f", outlineOffset: "1px", zIndex: 5 },
        "& .aims-jc-styled .fc-event-main": { padding: 0 },
        // Month (calendar style, round 36): the same pastel boxes as Week / Day, two rows each; cells fit about 4.
        "& .fc-dayGridMonth-view .aims-jc-styled": { borderRadius: "4px", marginBottom: "2px" },
        "& .fc-dayGridMonth-view .aims-jc-styled:hover": { filter: "brightness(0.96)" },
        ...(monthRows ? { "& .fc-dayGridMonth-view .fc-daygrid-day-frame": { minHeight: MONTH_CELL_MIN } } : {}),
        "& .fc-schedule-view": { height: "100%" },
        "@media (max-width: 600px)": { "& .fc .fc-toolbar": { flexDirection: "column", gap: 1 } },
      }}
    >
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, luxonPlugin, interactionPlugin]}
        dateClick={mini ? (arg: DateClickArg) => mini.onPick({ ...slotOf(arg.dateStr, arg.allDay), allDay: arg.allDay }) : canAdd ? onDateClick : undefined}
        eventOrder="displayOrder,start,-duration,allDay,title"
        timeZone={CALENDAR_TZ}
        initialView={initialView}
        initialDate={initialDate}
        headerToolbar={mini ? { left: "prev,next", center: "title", right: "timeGridDay,timeGridWeek" } : { left: "prev,next today", center: "title", right: `${showNewButton ? "aimsNew " : ""}dayGridMonth,timeGridWeek,timeGridDay${scheduleViews ? `,${SCHEDULE_VIEW}` : ""}` }}
        customButtons={customButtons}
        views={mini ? undefined : scheduleViews}
        buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day", ...(scheduleViews ? { [SCHEDULE_VIEW]: "Schedule" } : {}) }}
        firstDay={1}
        // Round 39 (calendar style orgs): a day number (Month) or day header (Week) opens that day in Day view.
        navLinks={styledCal}
        navLinkDayClick="timeGridDay"
        // About 4 items a day before "+N more" (calendar style: two-row boxes since round 36).
        dayMaxEvents={4}
        // Month: filled blocks so the source colours read at a glance, page-high.
        // Week / Day: a fixed-height grid that opens at 07:00 and scrolls for night jobs.
        eventDisplay="block"
        // WCT's dashboard is the calendar alone: it fills the screen in every view.
        // Month rows: the page grows with the taller day cells (6 rows each).
        height={mini ? mini.height : monthRows ? "auto" : fullHeight ? "calc(100vh - 210px)" : viewType === "dayGridMonth" ? "auto" : viewType === SCHEDULE_VIEW ? 640 : 760}
        // Calendar style (Week / Day): jobs at the same time sit side by side, so no block hides another's text or PTW bar.
        slotEventOverlap={!styledCal}
        nowIndicator
        scrollTime="07:00:00"
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
        events={inputs}
        eventClick={mini ? undefined : onClick}
        // WCT: the day goes to the panel and FullCalendar opens no pop-over (see MORE_LINK_HANDLED).
        moreLinkClick={openOnClick && !mini ? (panelMoreLink((day) => setPanel({ event: null, day })) as any) : undefined}
        // Job category (WCT group): the chip's tooltip names it (no tooltip for orgs without categories).
        eventDidMount={(arg) => {
          if (arg.event.extendedProps.holiday) return;
          const t = categoryChipTitle(arg.event.extendedProps.event as CalendarEvent | undefined, arg.event.title);
          if (t) arg.el.title = t;
        }}
        eventDrop={onMove ? onDrop : undefined}
        eventAllow={(drop) => drop.allDay}
        // Custom job fields: the job's icons after its time + title (default rendering otherwise).
        eventContent={(arg: EventContentArg) => {
          if (arg.event.extendedProps.holiday) return true;
          const e = arg.event.extendedProps.event as CalendarEvent;
          if (e?.style) return <StyledBox event={e} block={arg.view.type !== "dayGridMonth"} />;
          if (!e?.badges?.length && !e?.ptw) return true;
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, overflow: "hidden", px: 0.25 }}>
              {arg.timeText && <Box component="span" sx={{ fontWeight: 600, flexShrink: 0 }}>{arg.timeText}</Box>}
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{arg.event.title}</Box>
              {e.ptw && (
                <Box component="span" title={`PTW: ${e.ptw.label}${e.ptw.remark ? ` (${e.ptw.remark})` : ""}`} sx={{ flexShrink: 0, fontSize: 10, fontWeight: 700, lineHeight: "14px", px: 0.5, borderRadius: "3px", bgcolor: "#fff", color: ptwColor(e.ptw.status) }}>
                  PTW
                </Box>
              )}
              {(e.badges ?? []).map((b) => (
                <Box key={b.fieldId} component="span" title={badgeTitle(b)} sx={{ display: "inline-flex", bgcolor: "#fff", borderRadius: "50%", p: "1px", flexShrink: 0 }}>
                  <JobFieldIcon icon={b.icon} sx={{ fontSize: 13, color: b.colour }} />
                </Box>
              ))}
            </Box>
          );
        }}
        datesSet={(arg: DatesSetArg) => {
          setViewType(arg.view.type);
          shownView.current = { type: arg.view.type, from: arg.view.calendar.formatIso(arg.view.currentStart, true), to: arg.view.calendar.formatIso(arg.view.currentEnd, true) };
          setVisible(rangeOf(arg.startStr, arg.endStr));
          onRange(arg.startStr, arg.endStr);
        }}
      />

      {/* Schedule view: the list, rendered into the custom view's host node. */}
      {scheduleHost &&
        viewType === SCHEDULE_VIEW &&
        createPortal(
          <ScheduleList events={liveEvents} notes={notes} holidays={holidays} range={visible} showCancelled={showCancelled} byPtw={openOnClick} onRow={onScheduleRow} />,
          scheduleHost,
        )}

      {/* WCT: the details panel on the right (stays until closed or another job is clicked). */}
      {openOnClick && panel && (
        <JobPanel
          panel={panel}
          jobWords={jobWords}
          linkRefs={canAdd}
          onCrossOrg={onCrossOrg}
          actions={actions}
          onPatched={patchEvent}
          onReschedulePreview={onReschedulePreview}
          clashes={clashes}
          onCrossOpen={crossOpen}
          onEdit={onEditJob}
          onComplete={onCompleteJob}
          onJump={(l) => jumpTo({ id: `aims:${l.id}`, kind: "job", date: l.date })}
          onPick={(event) => setPanel((p) => ({ event, day: p?.day ?? null }))}
          onBack={() => setPanel((p) => (p?.day ? { event: null, day: p.day } : null))}
          onClose={() => setPanel(null)}
        />
      )}

      <Popover
        open={!!open}
        onClose={() => setOpen(null)}
        anchorReference="anchorPosition"
        anchorPosition={open?.pos}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { maxWidth: 360, p: 2 } } }}
      >
        {open && <EventCard event={open.event} jobWords={jobWords} byPtw={openOnClick} onCrossOrg={onCrossOrg} />}
      </Popover>

      {/* Group calendar: a child org's note, read only. */}
      <Popover
        open={!!noteView}
        onClose={() => setNoteView(null)}
        anchorReference="anchorPosition"
        anchorPosition={noteView?.pos}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { maxWidth: 360, p: 2 } } }}
      >
        {noteView && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3, mb: 1 }}>
              {noteTitle(noteView.note)}
            </Typography>
            {noteView.note.orgName && <Row label="Company">{noteView.note.orgName}</Row>}
            <Row label="When">{noteWhen(noteView.note)}</Row>
            <Row label="Type">{noteType(noteView.note.type).label}</Row>
            {noteView.note.staffName && <Row label="Staff">{noteView.note.staffName}</Row>}
            {noteView.note.remark && <Row label="Remark">{noteView.note.remark}</Row>}
          </Box>
        )}
      </Popover>

      {/* Group calendar: opening a child org's record switches this tab to that org, only when confirmed. */}
      <Dialog open={!!switchTo} onClose={() => setSwitchTo(null)}>
        <DialogTitle>{switchTo ? `Open in ${switchTo.orgName}?` : ""}</DialogTitle>
        <DialogActions>
          <Button onClick={() => setSwitchTo(null)}>Cancel</Button>
          <Button
            variant="contained"
            disableElevation
            onClick={() => {
              if (!switchTo) return;
              try {
                window.sessionStorage.setItem(ACTIVE_ORG_KEY, switchTo.orgId);
              } catch {
                return setSwitchTo(null);
              }
              window.location.assign(switchTo.href);
            }}
          >
            Switch and open
          </Button>
        </DialogActions>
      </Dialog>

      {/* WCT calendar add: what to add on the clicked day / slot. */}
      <Menu open={!!addMenu} onClose={() => setAddMenu(null)} anchorReference="anchorPosition" anchorPosition={addMenu?.pos} data-tour="jobs-calendar-add">
        <MenuItem
          onClick={() => {
            const slot = addMenu!.slot;
            setAddMenu(null);
            onAdd?.("job", slot);
          }}
        >
          <ListItemIcon>
            <WorkOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={ADD_MENU_TEXT.job.primary} secondary={ADD_MENU_TEXT.job.secondary} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            const slot = addMenu!.slot;
            setAddMenu(null);
            onAdd?.("note", slot);
          }}
        >
          <ListItemIcon>
            <StickyNote2OutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={ADD_MENU_TEXT.note.primary} secondary={ADD_MENU_TEXT.note.secondary} />
        </MenuItem>
      </Menu>
    </Box>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ mb: 0.75 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ wordBreak: "break-word" }}>
        {children}
      </Typography>
    </Stack>
  );
}

/** A numbered row's link (WCT calendar add): underlined like the order page's Quotation link; an in-app push, so Back returns here. */
function RefLink({ href, children, onOpen }: { href: string | null; children: React.ReactNode; onOpen?: (href: string) => void }) {
  const num = <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{children}</Box>;
  if (href && onOpen) {
    return (
      <a
        href={href}
        style={{ color: "inherit" }}
        onClick={(ev) => {
          ev.preventDefault();
          onOpen(href);
        }}
      >
        {num}
      </a>
    );
  }
  return href ? (
    <Link href={href} style={{ color: "inherit" }}>
      {num}
    </Link>
  ) : (
    num
  );
}

/** The panel title's link: a plain in-app link, or (a child org's job) one that asks before switching org. */
function RefTitle({ href, onOpen, children }: { href: string; onOpen?: (href: string) => void; children: React.ReactNode }) {
  return onOpen ? (
    <a
      href={href}
      style={{ color: "inherit" }}
      onClick={(ev) => {
        ev.preventDefault();
        onOpen(href);
      }}
    >
      {children}
    </a>
  ) : (
    <Link href={href} style={{ color: "inherit" }}>
      {children}
    </Link>
  );
}

function EventCard({
  event: e,
  jobWords,
  byPtw = false,
  linkRefs = false,
  onCrossOrg,
}: {
  event: CalendarEvent;
  jobWords: boolean;
  byPtw?: boolean;
  linkRefs?: boolean;
  onCrossOrg?: (t: { orgId: string; orgName: string }, href: string) => void;
}) {
  const color = panelColor(e, byPtw);
  // Group calendar: a child org's link (member only) asks before switching org.
  const cross = crossOrgTarget(e);
  const openCross = cross && onCrossOrg ? (href: string) => onCrossOrg(cross, href) : undefined;
  const company = orgLabel(e);
  // Calendar add on: the Order / DO numbers are links, so the buttons keep only Open job.
  const links = byPtw ? panelLinks(e, linkRefs) : null;
  // WCT calendar add: numbered Order / Quotation / DO links and the title to the order (null = as before).
  const refs = byPtw ? panelRefs(e, linkRefs) : null;
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography variant="caption" color="text.secondary">
          {byPtw ? wctKindLabel(e) : kindLabel(e.kind, jobWords)}
        </Typography>
      </Stack>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3, mb: 1, textDecoration: e.cancelled ? "line-through" : "none" }}>
        {refs?.titleHref ? (
          <RefTitle href={refs.titleHref} onOpen={openCross}>
            {styledTitle(e)}
          </RefTitle>
        ) : (
          styledTitle(e)
        )}
      </Typography>
      {company && <Row label="Company">{company}</Row>}
      <Row label="When">{timeWindow(e)}</Row>
      {(e.address || e.site) && (
        <Row label={e.source === "siteclock" ? "Site" : "Address"}>
          {e.site && e.address && e.site !== e.address ? (
            <>
              {e.site}
              <br />
              {e.address}
            </>
          ) : (
            e.address || e.site
          )}
        </Row>
      )}
      {e.source === "aims" ? (
        <>
          <Row label="Worker">{e.worker || "Not on SiteClock"}</Row>
          {e.rider && <Row label="Rider">{e.rider}</Row>}
          {/* Job category (WCT group; absent elsewhere). */}
          {e.category && <Row label="Category">{e.category}</Row>}
        </>
      ) : (
        e.worker && <Row label="Teams">{e.worker}</Row>
      )}
      {e.crew.length > 0 && (
        <Row label="Crew">
          {e.crew.map((c) => (
            <div key={c.name}>{crewLine(c)}</div>
          ))}
        </Row>
      )}
      {e.style && e.style.icons.length > 0 && (
        <Row label="Marks">
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {e.style.icons.map((i) => (
              <span key={i.label}>{`${i.icon} ${i.label}`}</span>
            ))}
          </Stack>
        </Row>
      )}
      {e.style && <Row label="Salesperson">{e.salesperson?.name || "None"}</Row>}
      {e.style && e.ptwApplicant && <Row label="PTW applicant">{applicantLabel(e.ptwApplicant)}</Row>}
      {/* People list (2026-11-19): who made the job (own company's jobs; "Unknown" when not recorded). */}
      {e.style && e.createdBy !== undefined && !e.foreign && <Row label="Created by">{e.createdBy?.name || "Unknown"}</Row>}
      <Row label="Status">
        <Chip
          size="small"
          label={e.statusLabel}
          sx={{ height: 22, bgcolor: alpha(color, 0.15), color: "text.primary", border: `1px solid ${alpha(color, 0.5)}` }}
        />
      </Row>
      {e.verificationLabel && <Row label="Sign-off">{e.verificationLabel}</Row>}
      {e.ptw && <Row label="PTW">{`${e.ptw.label}${e.ptw.remark ? ` (${e.ptw.remark})` : ""}`}</Row>}
      {(e.badges ?? []).map((b) => (
        <Row key={b.fieldId} label={b.label}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <JobFieldIcon icon={b.icon} sx={{ fontSize: 16, color: b.colour }} />
            <span>{b.text}</span>
          </Stack>
        </Row>
      ))}
      {refs?.rows.map((r) => (
        <Row key={r.key} label={r.label}>
          {r.key === "do" && e.doTag ? (
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <RefLink href={r.href} onOpen={openCross}>
                {r.number}
              </RefLink>
              <DoStatusTag tag={e.doTag} />
            </Stack>
          ) : (
            <RefLink href={r.href} onOpen={openCross}>
              {r.number}
            </RefLink>
          )}
        </Row>
      ))}
      {!refs && e.orderNumber && (
        <Row label="Order">
          <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{e.orderNumber}</Box>
        </Row>
      )}
      {!refs && e.doNumber && (
        <Row label="DO">
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{e.doNumber}</Box>
            {e.doTag && <DoStatusTag tag={e.doTag} />}
          </Stack>
        </Row>
      )}
      <Divider sx={{ my: 1.5 }} />
      {links ? (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {links.map((l, i) =>
            l.external ? (
              <Button key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" size="small" variant="outlined" endIcon={<OpenInNewIcon fontSize="small" />}>
                {l.label}
              </Button>
            ) : openCross ? (
              <Button key={l.label} onClick={() => openCross(l.href)} size="small" variant={i === 0 ? "contained" : "outlined"} disableElevation>
                {l.label}
              </Button>
            ) : (
              <Button key={l.label} component={Link} href={l.href} size="small" variant={i === 0 ? "contained" : "outlined"} disableElevation>
                {l.label}
              </Button>
            ),
          )}
        </Stack>
      ) : e.href && !e.foreign ? (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button component={Link} href={e.href} size="small" variant="contained" disableElevation>
            {jobWords ? "Open job" : "Open delivery"}
          </Button>
          {e.doHref && (
            <Button component={Link} href={e.doHref} size="small" variant="outlined">
              View DO
            </Button>
          )}
          {e.orderHref && (
            <Button component={Link} href={e.orderHref} size="small" variant="outlined">
              Open order
            </Button>
          )}
        </Stack>
      ) : e.siteclockUrl && !e.viewOnly ? (
        <Button href={e.siteclockUrl} target="_blank" rel="noopener noreferrer" size="small" variant="outlined" endIcon={<OpenInNewIcon fontSize="small" />}>
          Open in SiteClock
        </Button>
      ) : null}
    </Box>
  );
}

const panelDay = (date: string) => new Intl.DateTimeFormat("en-SG", { timeZone: CALENDAR_TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00+08:00`));
const chipTime = (e: CalendarEvent) => (e.allDay ? "All day" : new Intl.DateTimeFormat("en-SG", { timeZone: CALENDAR_TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(e.start)).toLowerCase());

/** WCT: the side panel. One job's details, or a day's jobs ("+n more") to pick from. */
/** What sits outside the side panel but belongs to it: its dialogs, menus, pickers, tooltips and the toasts. */
const PANEL_KEEPS_OPEN = '.MuiModal-root, .MuiDialog-root, .MuiPopover-root, .MuiPopper-root, .MuiMenu-root, .Toastify, [role="dialog"], [role="listbox"], [role="menu"], [role="tooltip"]';

function JobPanel({
  panel,
  jobWords,
  linkRefs,
  onCrossOrg,
  actions,
  onPatched,
  onReschedulePreview,
  clashes,
  onCrossOpen,
  onEdit,
  onComplete,
  onJump,
  onPick,
  onBack,
  onClose,
}: {
  panel: { event: CalendarEvent | null; day: { date: string; events: CalendarEvent[] } | null };
  jobWords: boolean;
  linkRefs: boolean;
  onCrossOrg: (t: { orgId: string; orgName: string }, href: string) => void;
  actions?: CalendarActions;
  onPatched: (e: CalendarEvent) => void;
  onReschedulePreview: (t: RescheduleTarget | null) => void;
  clashes: import("./calendarPanel").Clash[];
  onCrossOpen: (orgId: string, href: string) => void;
  onEdit?: (e: CalendarEvent) => void;
  onComplete?: (e: CalendarEvent) => void;
  onJump?: (l: { id: string; date: string }) => void;
  onPick: (e: CalendarEvent) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { event, day } = panel;
  // Round 39: a click anywhere outside the panel closes it, and so does Esc. Its own dialogs, menus, pickers and
  // tooltips (drawn outside it) do not count; a job clicked outside opens in a fresh panel.
  const paperRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const down = (ev: PointerEvent) => {
      const t = ev.target;
      if (!(t instanceof Element) || paperRef.current?.contains(t) || t.closest(PANEL_KEEPS_OPEN)) return;
      closeRef.current();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && !ev.defaultPrevented) closeRef.current();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <Paper
      ref={paperRef}
      elevation={8}
      square
      data-tour="jobs-calendar-panel"
      sx={{
        position: "fixed",
        top: { xs: 56, sm: 64 },
        right: 0,
        bottom: 0,
        width: { xs: "100%", sm: 380 },
        zIndex: (t) => t.zIndex.drawer + 1,
        display: "flex",
        flexDirection: "column",
        borderLeft: 1,
        borderColor: "divider",
        // Round 36: everything in the panel can be selected and copied.
        userSelect: "text",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
        {event && day && (
          <IconButton size="small" aria-label="Back" onClick={onBack}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        )}
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          {event ? (jobWords ? "Job" : "Delivery") : day ? panelDay(day.date) : ""}
        </Typography>
        <IconButton size="small" aria-label="Close" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      {/* 2026-11-23: the panel never scrolls sideways; its rows wrap (StyledJobPanel Row / document lists). */}
      <Box sx={{ p: 2, overflowY: "auto", overflowX: "hidden", flex: 1, minWidth: 0 }}>
        {event ? (
          event.style && event.source === "aims" ? (
            <StyledJobPanel event={event} actions={actions} onPatched={onPatched} onReschedulePreview={onReschedulePreview} clashes={clashes} onCrossOpen={onCrossOpen} onEdit={onEdit} onComplete={onComplete} onJump={onJump} />
          ) : (
            <EventCard event={event} jobWords={jobWords} byPtw linkRefs={linkRefs} onCrossOrg={onCrossOrg} />
          )
        ) : day ? (
          <List dense disablePadding>
            {day.events.map((e) => (
              <ListItemButton key={e.id} onClick={() => onPick(e)} sx={{ borderRadius: 1, alignItems: "flex-start" }}>
                <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: panelColor(e, true), mt: 0.75, mr: 1.25, flexShrink: 0, opacity: e.style?.greyed ? 0.45 : 1 }} />
                <ListItemText
                  primary={e.style ? [chipLines(e).icons, customerOf(e), chipLines(e).row2].filter(Boolean).join(" ") : e.title}
                  secondary={`${chipTime(e)} · ${e.statusLabel}${e.orgName ? ` · ${e.orgName}` : ""}`}
                  primaryTypographyProps={{ sx: { fontWeight: 500, textDecoration: e.cancelled ? "line-through" : "none", wordBreak: "break-word" } }}
                />
              </ListItemButton>
            ))}
          </List>
        ) : null}
      </Box>
    </Paper>
  );
}

/**
 * Calendar style chip (Google Calendar-like): the salesperson's soft fill comes from FullCalendar's background; the
 * PTW applicant's colour is a bar on the RIGHT edge (5px, none without a PTW) behind a thin white gap, so it reads
 * on any fill; line 1 the icons and title, line 2 the time range.
 */
/** A styled job's hover text (2026-11-24): name, time, Salesperson, Created by, PTW applicant, Team / crew, Assigned workers. */
const styledTooltip = (e: CalendarEvent): string => {
  const st = e.style!;
  return hoverLines(e, chipTimeRange(e), e.ptwApplicant && st.bar ? applicantLabel(e.ptwApplicant) : null).join("\n");
};

/** The PTW applicant's circle (only on a job that needs a PTW), with a hairline edge so yellow still reads. */
function PtwCircle({ colour, size = 9 }: { colour: string; size?: number }) {
  return <Box component="span" data-testid="ptw-circle" sx={{ width: size, height: size, borderRadius: "50%", bgcolor: colour, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)", flexShrink: 0, display: "inline-block" }} />;
}

/**
 * Calendar style item (round 36, 2026-11-20): the same in Month, Week and Day. A box lightly filled in the
 * salesperson's colour (the event's background) with dark text. Row 1: status icons (✅ / 2✅, ❌, ⭕, 📌, 🟫), then the
 * customer; Month puts a small grey time first (round 39: Day / Week blocks none, the time axis shows it). Row 2, only when there is something: (SV) / (M) / (CC), PTW status (✋ 👍 👎), the PTW applicant's colour
 * circle. Cut at the edge (no "…"); the full text is in the hover text and the side panel.
 */
function StyledBox({ event: e, block }: { event: CalendarEvent; block: boolean }) {
  const l = chipLines(e);
  return (
    <Box
      title={styledTooltip(e)}
      data-testid="styled-chip"
      sx={{ px: 0.5, py: "1px", overflow: "hidden", color: CHIP_TEXT, lineHeight: 1.3, fontSize: CHIP_FONT.text, minWidth: 0, height: block ? "100%" : "auto", boxSizing: "border-box" }}
    >
      <Box sx={{ display: "flex", gap: "3px", alignItems: "baseline", whiteSpace: "nowrap", overflow: "hidden" }}>
        {/* Round 39: Day / Week blocks print no time (the time axis shows it); Month keeps a small grey time. */}
        {l.time && !block && (
          <Box component="span" sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums", fontSize: CHIP_FONT.time, color: CHIP_TIME }}>
            {l.time}
          </Box>
        )}
        {l.icons && <Box component="span" sx={{ flexShrink: 0 }}>{l.icons}</Box>}
        <Box component="span" sx={{ fontWeight: 600, overflow: "hidden", textOverflow: "clip", textDecoration: e.cancelled ? "line-through" : "none" }}>
          {l.customer}
        </Box>
      </Box>
      {l.row2 && <Box sx={{ whiteSpace: "nowrap", overflow: "hidden", fontSize: CHIP_FONT.row2 }}>{l.row2}</Box>}
    </Box>
  );
}


/**
 * Schedule view (2026-11-19): the month as a list grouped by date. Date badge on the left (today circled), rows on the
 * right: time (or All day), coloured dot, icons, title, site. Opens scrolled to today (or the next day with items)
 * when the month on screen holds today; another month opens at its top.
 */
function ScheduleList({
  events,
  notes,
  holidays,
  range,
  showCancelled,
  byPtw,
  onRow,
}: {
  events: CalendarEvent[];
  notes?: Array<CalendarNote & GroupTag>;
  holidays?: PublicHoliday[];
  range: { from: string; to: string } | null;
  showCancelled: boolean;
  byPtw: boolean;
  onRow: (row: ScheduleRow, pos: { left: number; top: number }) => void;
}) {
  const days: ScheduleDay[] = useMemo(() => {
    const list = scheduleDays(events, notes, range, { showCancelled, byPtw });
    // Public holidays (2026-11-24): a holiday with nothing else on it still gets its day.
    const have = new Set(list.map((d) => d.date));
    const extra = (holidays ?? []).filter((h) => range && h.date >= range.from && h.date <= range.to && !have.has(h.date)).map((h) => ({ date: h.date, rows: [] }) as unknown as ScheduleDay);
    return extra.length ? [...list, ...extra].sort((a, b) => a.date.localeCompare(b.date)) : list;
  }, [events, notes, range, showCancelled, byPtw, holidays]);
  const today = dayOfInstant(new Date());
  const boxRef = useRef<HTMLDivElement | null>(null);
  const scrolledFor = useRef("");
  const rangeKey = range ? `${range.from}|${range.to}` : "";
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !range || !days.length || scrolledFor.current === rangeKey) return;
    scrolledFor.current = rangeKey;
    const target = range.from <= today && today <= range.to ? scheduleScrollDay(days, today) : null;
    const el = target ? (box.querySelector(`[data-day="${target}"]`) as HTMLElement | null) : null;
    box.scrollTop = el ? el.offsetTop - box.offsetTop : 0;
  }, [days, range, rangeKey, today]);
  // FullCalendar may rebuild its view element when the page re-renders (e.g. the side panel opening), which moves
  // this list and resets its scroll: put the reader back where they were.
  const savedTop = useRef(0);
  useLayoutEffect(() => {
    const restore = () => {
      const box = boxRef.current;
      if (box && savedTop.current > 0 && Math.abs(box.scrollTop - savedTop.current) > 1) box.scrollTop = savedTop.current;
    };
    restore();
    const id = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(id);
  });
  return (
    <Box
      ref={boxRef}
      data-tour="jobs-calendar-schedule"
      onScroll={(ev) => {
        savedTop.current = (ev.currentTarget as HTMLDivElement).scrollTop;
      }}
      sx={{ height: "100%", overflowY: "auto", position: "relative" }}
    >
      {!days.length ? (
        <Typography color="text.secondary" sx={{ p: 3 }}>
          Nothing scheduled
        </Typography>
      ) : (
        days.map((d) => {
          const b = scheduleBadge(d.date);
          const isToday = d.date === today;
          return (
            <Box key={d.date} data-day={d.date} sx={{ display: "flex", borderBottom: 1, borderColor: "divider", py: 1 }}>
              <Box sx={{ width: { xs: 56, sm: 76 }, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", pt: 0.25 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: isToday ? "primary.main" : "text.secondary", lineHeight: 1.2 }}>
                  {b.weekday}
                </Typography>
                <Box
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.15rem",
                    fontWeight: 600,
                    bgcolor: isToday ? "primary.main" : "transparent",
                    color: isToday ? "primary.contrastText" : "text.primary",
                  }}
                >
                  {b.day}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                  {b.month}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {holidaysOn(holidays ?? [], d.date).map((h) => (
                  <Typography key={h.date + h.name} variant="body2" data-testid="schedule-holiday" sx={{ px: 1, py: 0.5, mb: 0.5, borderRadius: 1, bgcolor: HOLIDAY_BG, color: HOLIDAY_TEXT, fontSize: SCHEDULE_FONT.text, fontWeight: 600 }}>
                    {holidayExportLine(h.name)}
                  </Typography>
                ))}
                {d.rows.map((r) =>
                  r.event?.style ? (
                    <ScheduleStyledRow key={r.key} row={r} event={r.event} onRow={onRow} />
                  ) : (
                  <ButtonBase
                    key={r.key}
                    onClick={(ev) => onRow(r, { left: ev.clientX, top: ev.clientY })}
                    sx={{
                      width: "100%",
                      justifyContent: "flex-start",
                      textAlign: "left",
                      borderRadius: 1,
                      px: 1,
                      py: 0.75,
                      gap: 1.25,
                      flexWrap: { xs: "wrap", sm: "nowrap" },
                      opacity: r.greyed ? GREYED_OPACITY : 1,
                      filter: r.greyed ? "grayscale(1)" : "none",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: r.colour, flexShrink: 0 }} />
                    <Typography variant="body2" color="text.secondary" sx={{ width: { xs: "auto", sm: 120 }, flexShrink: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {r.time}
                    </Typography>
                    {r.ptw ? <PtwCircle colour={r.ptw} size={10} /> : r.event?.style ? <Box sx={{ width: 10, flexShrink: 0 }} /> : null}
                    <Box sx={{ minWidth: 0, flex: 1, display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word", textDecoration: r.cancelled ? "line-through" : "none" }}>
                        {r.icons && <span style={{ marginRight: 6 }}>{r.icons}</span>}
                        {r.title}
                      </Typography>
                      {r.site && (
                        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                          {r.site}
                        </Typography>
                      )}
                    </Box>
                  </ButtonBase>
                  ),
                )}
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}

/** Schedule view, calendar style (round 36): the same pastel box and two rows as the calendar, the site after it. */
function ScheduleStyledRow({ row: r, event: e, onRow }: { row: ScheduleRow; event: CalendarEvent; onRow: (row: ScheduleRow, pos: { left: number; top: number }) => void }) {
  const l = chipLines(e);
  const sl = scheduleLines(e);
  const tone = chipTone(e);
  const fill = e.style!.fill;
  return (
    <ButtonBase
      onClick={(ev) => onRow(r, { left: ev.clientX, top: ev.clientY })}
      sx={{
        width: "100%",
        justifyContent: "flex-start",
        textAlign: "left",
        borderRadius: 1,
        px: 1,
        py: 0.5,
        mb: 0.5,
        gap: 1.25,
        flexWrap: { xs: "wrap", sm: "nowrap" },
        bgcolor: chipFill(fill),
        border: `1px solid ${chipBorder(fill)}`,
        color: CHIP_TEXT,
        opacity: tone === "cancelled" ? GREYED_OPACITY : tone === "postponed" ? 0.55 : 1,
        filter: tone === "cancelled" ? "grayscale(1)" : tone === "postponed" ? "grayscale(0.5)" : "none",
        "&:hover": { filter: tone ? undefined : "brightness(0.97)" },
      }}
    >
      <Typography variant="body2" sx={{ width: { xs: "auto", sm: 130 }, flexShrink: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: SCHEDULE_FONT.time, color: CHIP_TIME }}>
        {r.time}
      </Typography>
      {/* 2026-11-24, the phone format. Line 1: icons + name @ address (subject) - team | remarks, the company muted at
          the end. Line 2: assigned workers · QO no. · salesperson · created by (and the PTW marks). */}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 0.75 }}>
          <Typography variant="body2" component="span" sx={{ wordBreak: "break-word", fontSize: SCHEDULE_FONT.text, color: CHIP_TEXT }}>
            {l.icons && <span style={{ marginRight: 6 }}>{l.icons}</span>}
            <span style={{ fontWeight: 600, textDecoration: e.cancelled ? "line-through" : "none" }}>{sl.name}</span>
            {sl.where && <span>{` @ ${sl.where}`}</span>}
            {sl.subject && <span>{` (${sl.subject})`}</span>}
            {sl.team && <span>{` - ${sl.team}`}</span>}
            {sl.remarks && <span style={{ fontStyle: "italic" }}>{` | ${sl.remarks}`}</span>}
          </Typography>
          {e.orgName && (
            <Typography variant="caption" component="span" data-testid="schedule-company" sx={{ ml: "auto", fontSize: SCHEDULE_FONT.row2, color: CHIP_TEXT, opacity: 0.55, whiteSpace: "nowrap" }}>
              {e.orgName}
            </Typography>
          )}
        </Box>
        {(sl.line2 || l.row2) && (
          <Typography variant="caption" component="div" sx={{ color: CHIP_TEXT, fontSize: SCHEDULE_FONT.row2, opacity: 0.85 }}>
            {[l.row2, sl.line2].filter(Boolean).join(" · ")}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}
