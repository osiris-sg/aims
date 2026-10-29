"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Autocomplete, Box, CircularProgress, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { request } from "@/helpers/request";

// ─────────────────────────────────────────────────────────────────────────────
// SiteClock link (WCT 2026-10-30, flag enableSiteClockLink): the schedule form's
// "Duration" + "SiteClock worker" row. Picking a worker puts the run on that
// worker's SiteClock schedule (the job is created/moved/cancelled by the
// backend after the save; the form never talks to SiteClock itself — workers
// come through GET /deliveries/siteclock/workers so the key stays server-side).
// ─────────────────────────────────────────────────────────────────────────────

export interface SiteClockPick {
  workerId: string | null;
  workerName: string | null;
  durationMin: number | null;
}

interface WorkerOption {
  id: string;
  name: string;
  employeeNo: string | null;
  group: string;
}

const DURATIONS = [30, 60, 90, 120];

const label = (min: number) => (min % 60 === 0 ? `${min / 60} h` : min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

function addMinutes(hhmm: string, min: number) {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  const t = (h * 60 + m + min) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export default function SiteClockSchedulePicker({
  open,
  value,
  onChange,
  onEnabled,
  scheduleTime,
}: {
  open: boolean;
  value: SiteClockPick;
  onChange: (v: SiteClockPick) => void;
  /** Reports whether the link is live for this org (connection enabled), so the form only sends the fields then. */
  onEnabled: (enabled: boolean) => void;
  scheduleTime: string;
}) {
  const { getToken } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [options, setOptions] = useState<WorkerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const token = await getToken();
        if (!token) return;
        const cfg: any = await request({ path: "/deliveries/siteclock/config", method: "GET" }, {}, token);
        const c = cfg?.data ?? cfg;
        if (cancelled) return;
        setEnabled(!!c?.enabled);
        onEnabled(!!c?.enabled);
        if (!c?.enabled) return;
        setDefaultDuration(c.defaultDurationMin ?? 60);
        const res: any = await request({ path: "/deliveries/siteclock/workers", method: "GET" }, {}, token);
        const d = res?.data ?? res;
        if (cancelled) return;
        const seen = new Set<string>();
        const opts: WorkerOption[] = [];
        for (const t of d?.teams ?? []) {
          for (const w of t.workers ?? []) {
            if (seen.has(w.id)) continue;
            seen.add(w.id);
            opts.push({ id: w.id, name: w.name, employeeNo: w.employeeNo ?? null, group: t.name });
          }
        }
        for (const w of d?.others ?? []) {
          if (seen.has(w.id)) continue;
          seen.add(w.id);
          opts.push({ id: w.id, name: w.name, employeeNo: w.employeeNo ?? null, group: "Not in a team" });
        }
        setOptions(opts);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || "Couldn't load SiteClock workers");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, getToken]);

  const duration = value.durationMin ?? defaultDuration;
  useEffect(() => {
    if (open) setCustom(!DURATIONS.includes(duration));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The saved worker stays selectable even if SiteClock no longer lists them.
  const selected = useMemo<WorkerOption | null>(() => {
    if (!value.workerId) return null;
    return options.find((o) => o.id === value.workerId) ?? { id: value.workerId, name: value.workerName ?? "Unknown worker", employeeNo: null, group: "Current" };
  }, [value.workerId, value.workerName, options]);

  if (!enabled) return null;

  const end = scheduleTime ? addMinutes(scheduleTime, duration) : "";
  const helper = value.workerId
    ? scheduleTime
      ? `Shows in ${value.workerName ?? "the worker"}'s SiteClock app, ${scheduleTime} to ${end}`
      : `Shows in ${value.workerName ?? "the worker"}'s SiteClock app once the date and time are set`
    : "Optional. Pick a worker to put this job on their SiteClock schedule.";

  return (
    <Box sx={{ mt: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: { xs: "wrap", sm: "nowrap" }, rowGap: 1.5 }}>
        <TextField
          select
          label="Duration"
          size="small"
          value={custom ? "custom" : String(duration)}
          onChange={(e) => {
            if (e.target.value === "custom") {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange({ ...value, durationMin: Number(e.target.value) });
          }}
          sx={{ width: 140, flexShrink: 0 }}
          InputLabelProps={{ shrink: true }}
        >
          {DURATIONS.map((m) => (
            <MenuItem key={m} value={String(m)}>
              {label(m)}
            </MenuItem>
          ))}
          <MenuItem value="custom">Custom…</MenuItem>
        </TextField>
        {custom && (
          <TextField
            label="Minutes"
            size="small"
            value={String(duration)}
            onChange={(e) => {
              const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
              onChange({ ...value, durationMin: Number.isNaN(n) ? null : Math.min(1440, n) });
            }}
            sx={{ width: 110, flexShrink: 0 }}
            InputLabelProps={{ shrink: true }}
            inputProps={{ inputMode: "numeric" }}
          />
        )}
        <Autocomplete
          fullWidth
          size="small"
          options={options}
          groupBy={(o) => o.group}
          value={selected}
          loading={loading}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          getOptionLabel={(o) => (o.employeeNo ? `${o.name} (${o.employeeNo})` : o.name)}
          onChange={(_e, o) => onChange({ ...value, workerId: o?.id ?? null, workerName: o?.name ?? null })}
          renderInput={(params) => (
            <TextField
              {...params}
              label="SiteClock worker"
              placeholder="None"
              InputLabelProps={{ shrink: true }}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
      </Stack>
      {loadError ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {loadError}
        </Alert>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
          {helper}
        </Typography>
      )}
    </Box>
  );
}
