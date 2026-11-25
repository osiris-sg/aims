"use client";

// People list beside the jobs calendar (WCT group, 2026-11-19, calendar style orgs), like Google Calendar's "Other
// calendars": one row per person who made jobs / notes (plus the Sales people), "Unknown" for items with no creator
// recorded, and a row per sister company on the group calendar. Ticked = shown. The rules live in calendarModel.ts
// (peopleRows / filterByPeople); this is the list itself. Round 39: the icon legend sits below it, one per row.

import React from "react";
import { Box, Button, Checkbox, Divider, FormControlLabel, Stack, Typography } from "@mui/material";
import type { PeopleRow } from "./calendarModel";

export default function PeoplePanel({
  rows,
  onToggle,
  onAll,
  onNone,
  legend = [],
}: {
  rows: PeopleRow[];
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
  /** The calendar's icon legend (emoji + label). */
  legend?: Array<{ icon: string; label: string }>;
}) {
  const people = rows.filter((r) => r.kind !== "company");
  const companies = rows.filter((r) => r.kind === "company");
  const row = (r: PeopleRow) => (
    <FormControlLabel
      key={r.id}
      sx={{ mx: 0, width: "100%", alignItems: "center", "& .MuiFormControlLabel-label": { minWidth: 0, flex: 1 } }}
      control={
        <Checkbox
          size="small"
          checked={r.checked}
          onChange={() => onToggle(r.id)}
          sx={{ p: 0.5, mr: 0.5, color: r.colour, "&.Mui-checked": { color: r.colour } }}
        />
      }
      label={
        <Typography variant="body2" sx={{ wordBreak: "break-word", fontStyle: r.kind === "unknown" ? "italic" : "normal" }}>
          {r.label}
        </Typography>
      }
    />
  );
  return (
    <Box
      data-tour="jobs-calendar-people"
      sx={{ width: { xs: "100%", md: 220 }, flexShrink: 0, border: 1, borderColor: "divider", borderRadius: 1, p: 1.25, bgcolor: "background.paper" }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        People
      </Typography>
      <Stack direction="row" spacing={0.5} sx={{ mb: 0.5 }}>
        <Button size="small" onClick={onAll} sx={{ minWidth: 0, px: 0.75, textTransform: "none" }}>
          Select all
        </Button>
        <Button size="small" onClick={onNone} sx={{ minWidth: 0, px: 0.75, textTransform: "none" }}>
          None
        </Button>
      </Stack>
      <Stack>{people.map(row)}</Stack>
      {companies.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Organisations
          </Typography>
          <Stack>{companies.map(row)}</Stack>
        </>
      )}
      {legend.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Legend
          </Typography>
          <Stack spacing={0.25} data-tour="jobs-calendar-legend">
            {legend.map((l) => (
              <Typography key={l.label} variant="body2" sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
                <Box component="span" sx={{ width: 22, flexShrink: 0, textAlign: "center" }}>
                  {l.icon}
                </Box>
                {l.label}
              </Typography>
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
