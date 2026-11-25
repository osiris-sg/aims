"use client";

// "+N more" day card (WCT group, 2026-11-26): Google Calendar's day pop-over. A floating card over the day cell (not
// a dialog, no page change): weekday + big date, close X; all-day bars first, then timed items one line each. A click
// on an item opens it as its chip does (job / note side panel). Closes on X, Esc or a click outside. Rules and layout
// maths in dayPopoverModel.ts.

import React from "react";
import { Box, ButtonBase, IconButton, Popover, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { GREYED_OPACITY } from "./calendarModel";
import { barClipPath, dayPopoverHeader, type DayPopoverItem } from "./dayPopoverModel";

export interface DayPopoverState {
  date: string;
  pos: { left: number; top: number };
  width: number;
  allDay: DayPopoverItem[];
  timed: DayPopoverItem[];
}

const greyedSx = (i: DayPopoverItem) => (i.greyed ? { opacity: GREYED_OPACITY, filter: i.cancelled ? "grayscale(1)" : "grayscale(0.5)" } : {});

function Bar({ item: i, onPick }: { item: DayPopoverItem; onPick: (i: DayPopoverItem) => void }) {
  const sx = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: 22,
    px: i.contBefore ? "12px" : 1,
    pr: i.contAfter ? "12px" : 1,
    borderRadius: i.contBefore || i.contAfter ? 0 : "4px",
    clipPath: barClipPath(i.contBefore, i.contAfter),
    bgcolor: i.bg,
    color: i.text,
    fontSize: "0.8rem",
    fontWeight: 500,
    lineHeight: 1.3,
    textAlign: "left" as const,
    justifyContent: "flex-start",
    ...greyedSx(i),
  };
  const text = (
    <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, textDecoration: i.cancelled ? "line-through" : "none" }}>
      {[i.markers, i.title].filter(Boolean).join(" ")}
    </Box>
  );
  if (i.holiday) return <Box sx={sx}>{text}</Box>;
  return (
    <ButtonBase data-testid="day-popover-item" onClick={() => onPick(i)} sx={{ ...sx, "&:hover": { filter: "brightness(0.95)" } }}>
      {text}
    </ButtonBase>
  );
}

function Row({ item: i, onPick }: { item: DayPopoverItem; onPick: (i: DayPopoverItem) => void }) {
  return (
    <ButtonBase
      data-testid="day-popover-item"
      onClick={() => onPick(i)}
      sx={{ display: "flex", alignItems: "center", gap: 0.75, width: "100%", minHeight: 24, px: 1, borderRadius: "4px", justifyContent: "flex-start", fontSize: "0.8rem", color: "text.primary", "&:hover": { bgcolor: "action.hover" }, ...greyedSx(i) }}
    >
      <Box component="span" sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: i.dot, flexShrink: 0 }} />
      <Box component="span" sx={{ flexShrink: 0, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
        {i.time}
      </Box>
      {i.markers && <Box component="span" sx={{ flexShrink: 0 }}>{i.markers}</Box>}
      <Box component="span" sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, textDecoration: i.cancelled ? "line-through" : "none" }}>
        {i.title}
      </Box>
    </ButtonBase>
  );
}

export default function DayPopover({ state, onClose, onPick }: { state: DayPopoverState | null; onClose: () => void; onPick: (i: DayPopoverItem) => void }) {
  const head = state ? dayPopoverHeader(state.date) : null;
  return (
    <Popover
      open={!!state}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={state?.pos}
      transformOrigin={{ vertical: "top", horizontal: "center" }}
      marginThreshold={16}
      disableRestoreFocus
      slotProps={{
        paper: {
          "data-testid": "day-popover",
          "data-tour": "jobs-calendar-day-popover",
          sx: { width: state?.width ?? 280, maxHeight: "calc(100vh - 32px)", overflowY: "auto", borderRadius: 2, boxShadow: 8, pb: 1 },
        } as any,
      }}
    >
      {state && head && (
        <>
          <Box sx={{ position: "relative", pt: 1.25, pb: 0.75, textAlign: "center" }}>
            <Typography sx={{ fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.06em", color: "text.secondary" }}>{head.weekday}</Typography>
            <Typography sx={{ fontSize: "1.75rem", lineHeight: 1.2, fontWeight: 400 }}>{head.day}</Typography>
            <IconButton size="small" aria-label="Close" onClick={onClose} sx={{ position: "absolute", top: 4, right: 4 }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box sx={{ px: 1, display: "flex", flexDirection: "column", gap: "3px" }}>
            {state.allDay.map((i) => (
              <Bar key={i.key} item={i} onPick={onPick} />
            ))}
            {state.timed.map((i) => (
              <Row key={i.key} item={i} onPick={onPick} />
            ))}
          </Box>
        </>
      )}
    </Popover>
  );
}
