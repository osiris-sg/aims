"use client";

// The FullCalendar part of the jobs calendar (browser only: loaded with
// next/dynamic from JobsCalendar.tsx). Month by default, week and day views,
// Singapore time via the Luxon plugin. Clicking an event opens a small card at
// the click position.
// WCT calendar add (2026-11-04, canAdd): a click on an empty day / slot offers
// "Job" or "Note"; notes are all-day bars listed above the jobs; job chips show a
// PTW badge and an "Untagged" mark.

import React, { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import luxonPlugin from "@fullcalendar/luxon3";
import interactionPlugin, { type DateClickArg } from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import JobFieldIcon from "@/components/jobFields/JobFieldIcon";
import { Box, Button, Chip, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Popover, Stack, Typography } from "@mui/material";
import WorkOutlineIcon from "@mui/icons-material/WorkOutline";
import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import { noteToCalendarInput, ptwColor, slotOf, type CalendarNote } from "@/helpers/calendarAdd";
import { alpha, useTheme } from "@mui/material/styles";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "next/link";
import { CALENDAR_TZ, CANCELLED_COLOR, KIND_COLOR, badgeTitle, crewLine, kindLabel, timeWindow, toCalendarInputs, ymdOf, type CalendarEvent } from "./calendarModel";
import { useRouter } from "next/navigation";
import DoStatusTag from "@/components/DoStatusTag";

interface Props {
  events: CalendarEvent[];
  showCancelled: boolean;
  onRange: (startStr: string, endStr: string) => void;
  /** Fixture previews only: open on this day / view instead of today / month. */
  initialDate?: string;
  initialView?: "dayGridMonth" | "timeGridWeek" | "timeGridDay";
  /** WCT (enableWctOrders): "Job" wording. */
  jobWords?: boolean;
  /** WCT: clicking a job opens its page (no card), when it has one. */
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
}

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
}: Props) {
  const theme = useTheme();
  const router = useRouter();
  const [viewType, setViewType] = useState<string>(initialView);
  const [open, setOpen] = useState<{ pos: { left: number; top: number }; event: CalendarEvent } | null>(null);
  const [addMenu, setAddMenu] = useState<{ pos: { left: number; top: number }; slot: { date: string; time: string } } | null>(null);
  // Notes first on each day (displayOrder 0), then the jobs.
  const inputs = useMemo(
    () => [...(notes ?? []).map(noteToCalendarInput), ...toCalendarInputs(events, showCancelled, !!onMove).map((i) => ({ ...i, displayOrder: 1 }))],
    [events, showCancelled, notes, onMove],
  );

  const onDateClick = (arg: DateClickArg) => {
    setAddMenu({ pos: { left: arg.jsEvent.clientX, top: arg.jsEvent.clientY }, slot: slotOf(arg.dateStr, arg.allDay) });
  };

  const onClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const note = arg.event.extendedProps.note as CalendarNote | undefined;
    if (note) return onNoteClick?.(note);
    const e = arg.event.extendedProps.event as CalendarEvent;
    // WCT: a job opens its page at once; a SiteClock-only job (no AIMS page) keeps the card.
    if (openOnClick && e.href) return router.push(e.href);
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
        "& .aims-jc-cancelled .fc-event-title, & .aims-jc-cancelled .fc-event-time": { textDecoration: "line-through" },
        "@media (max-width: 600px)": { "& .fc .fc-toolbar": { flexDirection: "column", gap: 1 } },
      }}
    >
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, luxonPlugin, interactionPlugin]}
        dateClick={canAdd ? onDateClick : undefined}
        eventOrder="displayOrder,start,-duration,allDay,title"
        timeZone={CALENDAR_TZ}
        initialView={initialView}
        initialDate={initialDate}
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay" }}
        buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day" }}
        firstDay={1}
        dayMaxEvents={4}
        // Month: filled blocks so the source colours read at a glance, page-high.
        // Week / Day: a fixed-height grid that opens at 07:00 and scrolls for night jobs.
        eventDisplay="block"
        // WCT's dashboard is the calendar alone: it fills the screen in every view.
        height={fullHeight ? "calc(100vh - 210px)" : viewType === "dayGridMonth" ? "auto" : 760}
        nowIndicator
        scrollTime="07:00:00"
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
        events={inputs}
        eventClick={onClick}
        eventDrop={onMove ? onDrop : undefined}
        eventAllow={(drop) => drop.allDay}
        // Custom job fields: the job's icons after its time + title (default rendering otherwise).
        eventContent={(arg: EventContentArg) => {
          const e = arg.event.extendedProps.event as CalendarEvent;
          if (!e?.badges?.length && !e?.ptw && !e?.untagged) return true;
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, overflow: "hidden", px: 0.25 }}>
              {arg.timeText && <Box component="span" sx={{ fontWeight: 600, flexShrink: 0 }}>{arg.timeText}</Box>}
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{arg.event.title}</Box>
              {e.untagged && (
                <Box component="span" title="No quotation or order yet" sx={{ flexShrink: 0, fontSize: 10, fontWeight: 700, lineHeight: "14px", px: 0.5, borderRadius: "3px", bgcolor: "#fff", color: "#424242" }}>
                  Untagged
                </Box>
              )}
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
          onRange(arg.startStr, arg.endStr);
        }}
      />

      <Popover
        open={!!open}
        onClose={() => setOpen(null)}
        anchorReference="anchorPosition"
        anchorPosition={open?.pos}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { maxWidth: 360, p: 2 } } }}
      >
        {open && <EventCard event={open.event} jobWords={jobWords} />}
      </Popover>

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
          <ListItemText primary="Job" secondary="Quick job, no quotation needed" />
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
          <ListItemText primary="Note" secondary="Leave, PTW, blockage or other" />
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

function EventCard({ event: e, jobWords }: { event: CalendarEvent; jobWords: boolean }) {
  const color = e.cancelled ? CANCELLED_COLOR : KIND_COLOR[e.kind];
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography variant="caption" color="text.secondary">
          {kindLabel(e.kind, jobWords)}
        </Typography>
      </Stack>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3, mb: 1, textDecoration: e.cancelled ? "line-through" : "none" }}>
        {e.title}
      </Typography>
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
      <Row label="Status">
        <Chip
          size="small"
          label={e.statusLabel}
          sx={{ height: 22, bgcolor: alpha(color, 0.15), color: "text.primary", border: `1px solid ${alpha(color, 0.5)}` }}
        />
      </Row>
      {e.verificationLabel && <Row label="Sign-off">{e.verificationLabel}</Row>}
      {e.ptw && <Row label="PTW">{`${e.ptw.label}${e.ptw.remark ? ` (${e.ptw.remark})` : ""}`}</Row>}
      {e.untagged && <Row label="Order">Untagged: link it from the job page</Row>}
      {(e.badges ?? []).map((b) => (
        <Row key={b.fieldId} label={b.label}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <JobFieldIcon icon={b.icon} sx={{ fontSize: 16, color: b.colour }} />
            <span>{b.text}</span>
          </Stack>
        </Row>
      ))}
      {e.orderNumber && (
        <Row label="Order">
          <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{e.orderNumber}</Box>
        </Row>
      )}
      {e.doNumber && (
        <Row label="DO">
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{e.doNumber}</Box>
            {e.doTag && <DoStatusTag tag={e.doTag} />}
          </Stack>
        </Row>
      )}
      <Divider sx={{ my: 1.5 }} />
      {e.href ? (
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
      ) : e.siteclockUrl ? (
        <Button href={e.siteclockUrl} target="_blank" rel="noopener noreferrer" size="small" variant="outlined" endIcon={<OpenInNewIcon fontSize="small" />}>
          Open in SiteClock
        </Button>
      ) : null}
    </Box>
  );
}
