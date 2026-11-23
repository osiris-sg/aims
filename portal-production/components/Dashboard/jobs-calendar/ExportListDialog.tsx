"use client";

// Jobs calendar "Export list" (round 36, WCT group, calendar style orgs): the WhatsApp schedule for a day (default
// tomorrow) or a range, from the jobs the filters and the people list keep. Cancelled and on-hold jobs are left out
// unless ticked. A text preview and Copy. The header line comes from Settings > Job fields (default below).

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, Stack, TextField } from "@mui/material";
import { toast } from "react-toastify";
import DateInput from "@/components/DateInput";
import type { CalendarEvent } from "./calendarModel";
import { DEFAULT_EXPORT_HEADER, exportText, tomorrowSgt, type ExportNote } from "./calendarPanel";

/** At most this many days at a time (the calendar API reads 62). */
const MAX_DAYS = 31;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default function ExportListDialog({
  open,
  onClose,
  loadEvents,
  loadHeader,
}: {
  open: boolean;
  onClose: () => void;
  /** The jobs (and all-day notes) from..to as the calendar shows them (filters and people list applied). */
  loadEvents: (from: string, to: string) => Promise<{ events: CalendarEvent[]; notes: ExportNote[] }>;
  loadHeader?: () => Promise<string | null>;
}) {
  const [mode, setMode] = useState<"day" | "range">("day");
  const [from, setFrom] = useState(tomorrowSgt());
  const [to, setTo] = useState(tomorrowSgt());
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [includeOnHold, setIncludeOnHold] = useState(false);
  const [header, setHeader] = useState(DEFAULT_EXPORT_HEADER);
  const [events, setEvents] = useState<{ events: CalendarEvent[]; notes: ExportNote[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode("day");
    setFrom(tomorrowSgt());
    setTo(tomorrowSgt());
    if (loadHeader) void loadHeader().then((h) => setHeader(h ?? DEFAULT_EXPORT_HEADER));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const end = mode === "day" ? from : to;
  const rangeError = !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(end) ? "Pick the dates" : end < from ? "The end is before the start" : end > addDays(from, MAX_DAYS - 1) ? `At most ${MAX_DAYS} days at a time` : "";
  useEffect(() => {
    if (!open || rangeError) return;
    let live = true;
    setEvents(null);
    setError("");
    loadEvents(from, end)
      .then((list) => live && setEvents(list))
      .catch((e: any) => live && setError(e?.message || "Couldn't load the jobs"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, from, end, rangeError]);

  const text = useMemo(() => (events ? exportText(events.events, { from, to: end, header, includeCancelled, includeOnHold }, events.notes) : ""), [events, from, end, header, includeCancelled, includeOnHold]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it instead.");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" data-tour="jobs-calendar-export-dialog">
      <DialogTitle>Export list</DialogTitle>
      <DialogContent>
        <RadioGroup row value={mode} onChange={(e) => setMode(e.target.value as "day" | "range")} sx={{ mb: 1 }}>
          <FormControlLabel value="day" control={<Radio size="small" />} label="One day" />
          <FormControlLabel value="range" control={<Radio size="small" />} label="Date range" />
        </RadioGroup>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 1 }}>
          <DateInput label={mode === "day" ? "Date" : "From"} size="small" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
          {mode === "range" && <DateInput label="To" size="small" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />}
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
          <FormControlLabel control={<Checkbox size="small" checked={includeCancelled} onChange={(e) => setIncludeCancelled(e.target.checked)} />} label="Include cancelled" />
          <FormControlLabel control={<Checkbox size="small" checked={includeOnHold} onChange={(e) => setIncludeOnHold(e.target.checked)} />} label="Include on hold" />
        </Stack>
        {rangeError ? (
          <Alert severity="info">{rangeError}</Alert>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : events === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : !text ? (
          <Alert severity="info">No jobs on these dates with the filters on screen.</Alert>
        ) : (
          <TextField
            value={text}
            multiline
            fullWidth
            minRows={8}
            maxRows={18}
            InputProps={{ readOnly: true, sx: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.82rem" } }}
            inputProps={{ "aria-label": "WhatsApp text" }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disableElevation disabled={!text} onClick={() => void copy()}>
          Copy
        </Button>
      </DialogActions>
    </Dialog>
  );
}
