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

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { ADD_MENU_TEXT, noteTitle, noteToCalendarInput, noteType, noteWhen, ptwColor, slotOf, type CalendarNote } from "@/helpers/calendarAdd";
import { categoryChipTitle } from "@/helpers/jobCategory";
import { ACTIVE_ORG_KEY } from "@/helpers/multiOrg";
import { alpha, useTheme } from "@mui/material/styles";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "next/link";
import { CALENDAR_TZ, CHIP_TEXT, GREYED_OPACITY, applicantLabel, badgeTitle, chipIcons, chipTimeRange, crewLine, crossOrgTarget, chipTitle, dayOfInstant, kindLabel, orgLabel, panelColor, panelLinks, panelMoreLink, panelRefs, rangeOf, scheduleBadge, scheduleDays, scheduleScrollDay, styledTitle, timeWindow, toCalendarInputs, wctKindLabel, ymdOf, type CalendarEvent, type GroupTag, type ScheduleDay, type ScheduleRow } from "./calendarModel";
import DoStatusTag from "@/components/DoStatusTag";

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
}

export const SCHEDULE_VIEW = "schedule";

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
  const onScheduleRow = (row: ScheduleRow, pos: { left: number; top: number }) => {
    if (row.note) {
      if (row.note.foreign) return setNoteView({ pos, note: row.note });
      return onNoteClick?.(row.note);
    }
    if (!row.event) return;
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
  // Notes first on each day (displayOrder 0), then the jobs.
  const inputs = useMemo(
    () => [...(notes ?? []).map((n) => noteToCalendarInput(n, styled)), ...toCalendarInputs(events, showCancelled, !!onMove, openOnClick).map((i) => ({ ...i, displayOrder: 1 }))],
    [events, showCancelled, notes, onMove, openOnClick, styled],
  );

  const onDateClick = (arg: DateClickArg) => {
    setAddMenu({ pos: { left: arg.jsEvent.clientX, top: arg.jsEvent.clientY }, slot: slotOf(arg.dateStr, arg.allDay) });
  };

  const onClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const note = arg.event.extendedProps.note as (CalendarNote & GroupTag) | undefined;
    if (note?.foreign) return setNoteView({ pos: { left: arg.jsEvent.clientX, top: arg.jsEvent.clientY }, note });
    if (note) return onNoteClick?.(note);
    const e = arg.event.extendedProps.event as CalendarEvent;
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
        "& .aims-jc-styled .fc-event-main": { padding: 0 },
        "& .fc-schedule-view": { height: "100%" },
        "@media (max-width: 600px)": { "& .fc .fc-toolbar": { flexDirection: "column", gap: 1 } },
      }}
    >
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, luxonPlugin, interactionPlugin]}
        dateClick={canAdd ? onDateClick : undefined}
        eventOrder="displayOrder,start,-duration,allDay,title"
        timeZone={CALENDAR_TZ}
        initialView={initialView}
        initialDate={initialDate}
        headerToolbar={{ left: "prev,next today", center: "title", right: `dayGridMonth,timeGridWeek,timeGridDay${scheduleViews ? `,${SCHEDULE_VIEW}` : ""}` }}
        views={scheduleViews}
        buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day", ...(scheduleViews ? { [SCHEDULE_VIEW]: "Schedule" } : {}) }}
        firstDay={1}
        dayMaxEvents={4}
        // Month: filled blocks so the source colours read at a glance, page-high.
        // Week / Day: a fixed-height grid that opens at 07:00 and scrolls for night jobs.
        eventDisplay="block"
        // WCT's dashboard is the calendar alone: it fills the screen in every view.
        height={fullHeight ? "calc(100vh - 210px)" : viewType === "dayGridMonth" ? "auto" : viewType === SCHEDULE_VIEW ? 640 : 760}
        nowIndicator
        scrollTime="07:00:00"
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
        events={inputs}
        eventClick={onClick}
        // WCT: the day goes to the panel and FullCalendar opens no pop-over (see MORE_LINK_HANDLED).
        moreLinkClick={openOnClick ? (panelMoreLink((day) => setPanel({ event: null, day })) as any) : undefined}
        // Job category (WCT group): the chip's tooltip names it (no tooltip for orgs without categories).
        eventDidMount={(arg) => {
          const t = categoryChipTitle(arg.event.extendedProps.event as CalendarEvent | undefined, arg.event.title);
          if (t) arg.el.title = t;
        }}
        eventDrop={onMove ? onDrop : undefined}
        eventAllow={(drop) => drop.allDay}
        // Custom job fields: the job's icons after its time + title (default rendering otherwise).
        eventContent={(arg: EventContentArg) => {
          const e = arg.event.extendedProps.event as CalendarEvent;
          if (e?.style) return <StyledChip event={e} />;
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
          setVisible(rangeOf(arg.startStr, arg.endStr));
          onRange(arg.startStr, arg.endStr);
        }}
      />

      {/* Schedule view: the list, rendered into the custom view's host node. */}
      {scheduleHost &&
        viewType === SCHEDULE_VIEW &&
        createPortal(
          <ScheduleList events={events} notes={notes} range={visible} showCancelled={showCancelled} byPtw={openOnClick} onRow={onScheduleRow} />,
          scheduleHost,
        )}

      {/* WCT: the details panel on the right (stays until closed or another job is clicked). */}
      {openOnClick && panel && (
        <JobPanel
          panel={panel}
          jobWords={jobWords}
          linkRefs={canAdd}
          onCrossOrg={onCrossOrg}
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
function JobPanel({
  panel,
  jobWords,
  linkRefs,
  onCrossOrg,
  onPick,
  onBack,
  onClose,
}: {
  panel: { event: CalendarEvent | null; day: { date: string; events: CalendarEvent[] } | null };
  jobWords: boolean;
  linkRefs: boolean;
  onCrossOrg: (t: { orgId: string; orgName: string }, href: string) => void;
  onPick: (e: CalendarEvent) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { event, day } = panel;
  return (
    <Paper
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
      <Box sx={{ p: 2, overflowY: "auto", flex: 1 }}>
        {event ? (
          <EventCard event={event} jobWords={jobWords} byPtw linkRefs={linkRefs} onCrossOrg={onCrossOrg} />
        ) : day ? (
          <List dense disablePadding>
            {day.events.map((e) => (
              <ListItemButton key={e.id} onClick={() => onPick(e)} sx={{ borderRadius: 1, alignItems: "flex-start" }}>
                <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: panelColor(e, true), mt: 0.75, mr: 1.25, flexShrink: 0, opacity: e.style?.greyed ? 0.45 : 1 }} />
                <ListItemText
                  primary={e.style ? `${chipIcons(e) ? `${chipIcons(e)} ` : ""}${styledTitle(e)}` : e.title}
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
function StyledChip({ event: e }: { event: CalendarEvent }) {
  const st = e.style!;
  const icons = chipIcons(e);
  return (
    <Box
      title={[styledTitle(e), chipTimeRange(e), e.doNumber ? `DO ${e.doNumber}` : "", e.quotationNumber ? `Quotation ${e.quotationNumber}` : "", ...st.icons.map((i) => i.label), e.salesperson?.name ? `Salesperson: ${e.salesperson.name}` : "", e.ptwApplicant && st.bar ? `PTW applicant: ${applicantLabel(e.ptwApplicant)}` : ""].filter(Boolean).join("\n")}
      sx={{
        position: "relative",
        display: "flex",
        // Fill the event (Week / Day: a timed job is taller than its text) so the PTW bar runs top to bottom.
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        pl: 0.75,
        pr: st.bar ? 1.5 : 0.5,
        py: 0.25,
        color: CHIP_TEXT,
        lineHeight: 1.25,
        minWidth: 0,
      }}
    >
      {st.bar && (
        <Box
          aria-hidden
          data-testid="ptw-bar"
          sx={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "7px", borderLeft: "2px solid #ffffff", bgcolor: st.bar, borderRadius: "0 2px 2px 0", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.22)" }}
        />
      )}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ fontWeight: 600, fontSize: "0.75rem", whiteSpace: "nowrap", overflow: "hidden", textDecoration: e.cancelled ? "line-through" : "none" }}>
          {icons && <span style={{ marginRight: 4 }}>{icons}</span>}
          {chipTitle(e)}
        </Box>
        <Box sx={{ fontSize: "0.7rem", opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden" }}>{chipTimeRange(e)}</Box>
      </Box>
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
  range,
  showCancelled,
  byPtw,
  onRow,
}: {
  events: CalendarEvent[];
  notes?: Array<CalendarNote & GroupTag>;
  range: { from: string; to: string } | null;
  showCancelled: boolean;
  byPtw: boolean;
  onRow: (row: ScheduleRow, pos: { left: number; top: number }) => void;
}) {
  const days: ScheduleDay[] = useMemo(() => scheduleDays(events, notes, range, { showCancelled, byPtw }), [events, notes, range, showCancelled, byPtw]);
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
                {d.rows.map((r) => (
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
                      opacity: r.greyed ? 0.5 : 1,
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ width: { xs: "auto", sm: 150 }, flexShrink: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {r.time}
                    </Typography>
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: r.colour, flexShrink: 0 }} />
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
                ))}
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}
