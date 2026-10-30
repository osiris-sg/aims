"use client";

// The FullCalendar part of the jobs calendar (browser only: loaded with
// next/dynamic from JobsCalendar.tsx). Month by default, week and day views,
// Singapore time via the Luxon plugin. Clicking an event opens a small card at
// the click position.

import React, { useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import luxonPlugin from "@fullcalendar/luxon3";
import type { DatesSetArg, EventClickArg } from "@fullcalendar/core";
import { Box, Button, Chip, Divider, Popover, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "next/link";
import { CALENDAR_TZ, CANCELLED_COLOR, KIND_COLOR, KIND_LABEL, crewLine, timeWindow, toCalendarInputs, type CalendarEvent } from "./calendarModel";

interface Props {
  events: CalendarEvent[];
  showCancelled: boolean;
  onRange: (startStr: string, endStr: string) => void;
  /** Fixture previews only: open on this day / view instead of today / month. */
  initialDate?: string;
  initialView?: "dayGridMonth" | "timeGridWeek" | "timeGridDay";
}

export default function CalendarView({ events, showCancelled, onRange, initialDate, initialView = "dayGridMonth" }: Props) {
  const theme = useTheme();
  const [viewType, setViewType] = useState<string>(initialView);
  const [open, setOpen] = useState<{ pos: { left: number; top: number }; event: CalendarEvent } | null>(null);
  const inputs = useMemo(() => toCalendarInputs(events, showCancelled), [events, showCancelled]);

  const onClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const e = arg.event.extendedProps.event as CalendarEvent;
    setOpen({ pos: { left: arg.jsEvent.clientX, top: arg.jsEvent.clientY }, event: e });
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
        "& .aims-jc-completed": { opacity: 0.5 },
        "& .aims-jc-cancelled .fc-event-title, & .aims-jc-cancelled .fc-event-time": { textDecoration: "line-through" },
        "@media (max-width: 600px)": { "& .fc .fc-toolbar": { flexDirection: "column", gap: 1 } },
      }}
    >
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, luxonPlugin]}
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
        height={viewType === "dayGridMonth" ? "auto" : 760}
        nowIndicator
        scrollTime="07:00:00"
        eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
        events={inputs}
        eventClick={onClick}
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
        {open && <EventCard event={open.event} />}
      </Popover>
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

function EventCard({ event: e }: { event: CalendarEvent }) {
  const color = e.cancelled ? CANCELLED_COLOR : KIND_COLOR[e.kind];
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography variant="caption" color="text.secondary">
          {KIND_LABEL[e.kind]}
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
      <Divider sx={{ my: 1.5 }} />
      {e.href ? (
        <Button component={Link} href={e.href} size="small" variant="contained" disableElevation>
          Open delivery
        </Button>
      ) : e.siteclockUrl ? (
        <Button href={e.siteclockUrl} target="_blank" rel="noopener noreferrer" size="small" variant="outlined" endIcon={<OpenInNewIcon fontSize="small" />}>
          Open in SiteClock
        </Button>
      ) : null}
    </Box>
  );
}
