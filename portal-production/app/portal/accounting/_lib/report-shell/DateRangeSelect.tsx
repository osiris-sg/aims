"use client";

// Xero-style date controls.
// <DateRangeSelect>  — from/to pair + preset menu (This month / quarter / FY,
//                      Last …, Month-to-date …, custom).
// <AsAtDateSelect>   — single as-at date + preset menu (end of this/last month…).
// Fiscal year boundaries default to the org's AccountingSetting
// (fiscalYearEndDay/Month) when provided, else 31 Dec.

import React, { useEffect, useMemo, useState } from "react";
import {
  Box, Button, Divider, IconButton, Menu, MenuItem, ListItemText, Stack, TextField, Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { useAccountingApi } from "../api";
import { onReportDate } from "./reportDate";
import DateInput from "@/components/DateInput";

/**
 * The default period for a listing report: THIS MONTH, first to last day.
 * Every listing opens on the current month (guru 2026-11-18: "we alr added
 * this for all date range to default to start of current month why this one
 * nvr") — the Journal Voucher Listing was still opening on the legacy
 * dialog's 01/01/2018 → today, so it dragged every journal the org has ever
 * posted into the browser before anyone had asked for anything.
 */
export const monthRange = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};


// The org's Financial Year End (Accounting Setup → Financial Settings) drives
// the "This financial year" / "Year to date" presets. Fetched once per page
// load and shared by every picker on it.
let fyCache: { day: number; month: number } | null = null;
let fyPromise: Promise<{ day: number; month: number }> | null = null;

function useFiscalYearEnd(): { day: number; month: number } {
  const { request } = useAccountingApi();
  const [fy, setFy] = useState(fyCache ?? { day: 31, month: 12 });
  useEffect(() => {
    if (fyCache) return;
    fyPromise =
      fyPromise ||
      request<any>("/accounting/settings")
        .then((res: any) => {
          const s = res?.data ?? res;
          fyCache = { day: s?.fiscalYearEndDay ?? 31, month: s?.fiscalYearEndMonth ?? 12 };
          return fyCache;
        })
        .catch(() => ({ day: 31, month: 12 }));
    fyPromise.then((v) => setFy(v));
  }, [request]);
  return fy;
}

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }); // dd/mm/yyyy (guru 2026-11-18)

function fyStart(now: Date, fyEndMonth: number, fyEndDay: number): Date {
  // FY ends on (fyEndDay, fyEndMonth); the FY containing `now` starts the day after the previous end.
  const endThisYear = new Date(now.getFullYear(), fyEndMonth - 1, fyEndDay, 23, 59, 59);
  const end = now <= endThisYear ? endThisYear : new Date(now.getFullYear() + 1, fyEndMonth - 1, fyEndDay, 23, 59, 59);
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  return start;
}

export interface RangePreset { label: string; range: () => { from: Date; to: Date } }

export function buildRangePresets(fyEndMonth = 12, fyEndDay = 31): RangePreset[][] {
  const now = new Date();
  const som = (off = 0) => new Date(now.getFullYear(), now.getMonth() + off, 1);
  const eom = (off = 0) => new Date(now.getFullYear(), now.getMonth() + 1 + off, 0);
  const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const soq = (off = 0) => new Date(now.getFullYear(), qStartMonth + off * 3, 1);
  const eoq = (off = 0) => new Date(now.getFullYear(), qStartMonth + 3 + off * 3, 0);
  const fs = fyStart(now, fyEndMonth, fyEndDay);
  const fe = new Date(fs.getFullYear() + 1, fs.getMonth(), fs.getDate() - 1);
  const lfs = new Date(fs); lfs.setFullYear(fs.getFullYear() - 1);
  const lfe = new Date(fs); lfe.setDate(fs.getDate() - 1);
  return [
    [
      { label: "This month", range: () => ({ from: som(), to: eom() }) },
      { label: "This quarter", range: () => ({ from: soq(), to: eoq() }) },
      { label: "This financial year", range: () => ({ from: fs, to: fe }) },
    ],
    [
      { label: "Last month", range: () => ({ from: som(-1), to: eom(-1) }) },
      { label: "Last quarter", range: () => ({ from: soq(-1), to: eoq(-1) }) },
      { label: "Last financial year", range: () => ({ from: lfs, to: lfe }) },
    ],
    [
      { label: "Month to date", range: () => ({ from: som(), to: now }) },
      { label: "Quarter to date", range: () => ({ from: soq(), to: now }) },
      { label: "Year to date", range: () => ({ from: fs, to: now }) },
    ],
  ];
}

/**
 * "This financial year" as a visible button (guru 2026-11-18: "a button to see
 * this year financial period, then the date range will change accordingly") —
 * on every report with a From / To: the DateRangeSelect renders it itself, the
 * drill-down dialogs and the older From/To pages place it after their To box.
 * The year comes from Accounting Setup → Financial Year End.
 */
export function FiscalYearButton({ from, to, onPick, sx }: { from?: string; to?: string; onPick: (from: string, to: string) => void; sx?: any }) {
  const fy = useFiscalYearEnd();
  const range = useMemo(() => {
    const fs = fyStart(new Date(), fy.month, fy.day);
    const fe = new Date(fs.getFullYear() + 1, fs.getMonth(), fs.getDate() - 1);
    return { from: iso(fs), to: iso(fe) };
  }, [fy]);
  // A toggle (guru 2026-11-18): once the range IS the financial year the
  // button reads "This month" and takes the report back to the current month.
  const onFy = from === range.from && to === range.to;
  const month = monthRange();
  return (
    <Button
      variant="outlined"
      size="small"
      onClick={() => (onFy ? onPick(month.from, month.to) : onPick(range.from, range.to))}
      title={onFy ? `${fmt(new Date(month.from))} - ${fmt(new Date(month.to))}` : `${fmt(new Date(range.from))} - ${fmt(new Date(range.to))}`}
      sx={{ height: 40, whiteSpace: "nowrap", textTransform: "none", ...sx }}
    >
      {onFy ? "This month" : "This financial year"}
    </Button>
  );
}

export function DateRangeSelect({
  label = "Date range", from, to, onChange, fyEndMonth, fyEndDay,
}: {
  label?: string;
  from: string; // ISO yyyy-mm-dd
  to: string;
  onChange: (from: string, to: string) => void;
  fyEndMonth?: number;
  fyEndDay?: number;
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const orgFy = useFiscalYearEnd();
  const groups = useMemo(
    () => buildRangePresets(fyEndMonth ?? orgFy.month, fyEndDay ?? orgFy.day),
    [fyEndMonth, fyEndDay, orgFy],
  );
  return (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.primary" }}>{label}</Typography>
      <Stack direction="row" alignItems="center" sx={{ mt: 0.25 }}>
        <DateInput size="small" value={from} onChange={onReportDate((v) => onChange(v, to), true)} sx={{ width: 150, "& fieldset": { borderTopRightRadius: 0, borderBottomRightRadius: 0 } }} />
        <DateInput size="small" value={to} onChange={onReportDate((v) => onChange(from, v), true)} sx={{ width: 150, "& fieldset": { borderRadius: 0, borderLeft: "none" } }} />
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderLeft: "none", borderRadius: "0 4px 4px 0", height: 40, width: 34 }}>
          <ArrowDropDownIcon />
        </IconButton>
        <FiscalYearButton from={from} to={to} onPick={onChange} sx={{ ml: 1 }} />
      </Stack>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {groups.map((g, gi) => [
          ...(gi > 0 ? [<Divider key={`d${gi}`} />] : []),
          ...g.map((p) => {
            const r = p.range();
            return (
              <MenuItem key={p.label} sx={{ minWidth: 320, justifyContent: "space-between" }}
                onClick={() => { onChange(iso(r.from), iso(r.to)); setAnchor(null); }}>
                <ListItemText primary={p.label} />
                <Typography variant="body2" color="text.secondary">{fmt(r.from)} - {fmt(r.to)}</Typography>
              </MenuItem>
            );
          }),
        ])}
      </Menu>
    </Box>
  );
}

export function AsAtDateSelect({
  label = "Date", value, onChange,
}: {
  label?: string;
  value: string; // ISO yyyy-mm-dd
  onChange: (v: string) => void;
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const now = new Date();
  const presets: { label: string; date: () => Date }[] = [
    { label: "End of this month", date: () => new Date(now.getFullYear(), now.getMonth() + 1, 0) },
    { label: "End of last month", date: () => new Date(now.getFullYear(), now.getMonth(), 0) },
    { label: "Today", date: () => now },
    { label: "End of this quarter", date: () => new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0) },
    { label: "End of last quarter", date: () => new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 0) },
    { label: "End of this year", date: () => new Date(now.getFullYear(), 12, 0) },
    { label: "End of last year", date: () => new Date(now.getFullYear() - 1, 12, 0) },
  ];
  return (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.primary" }}>{label}</Typography>
      <Stack direction="row" alignItems="center" sx={{ mt: 0.25 }}>
        <DateInput size="small" value={value} onChange={onReportDate(onChange, true)} sx={{ width: 165, "& fieldset": { borderTopRightRadius: 0, borderBottomRightRadius: 0 } }} />
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderLeft: "none", borderRadius: "0 4px 4px 0", height: 40, width: 34 }}>
          <ArrowDropDownIcon />
        </IconButton>
      </Stack>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {presets.map((p) => (
          <MenuItem key={p.label} sx={{ minWidth: 280, justifyContent: "space-between" }}
            onClick={() => { onChange(iso(p.date())); setAnchor(null); }}>
            <ListItemText primary={p.label} />
            <Typography variant="body2" color="text.secondary">{fmt(p.date())}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

// Small labelled select used across report filter bars.
export function FilterSelect({
  label, value, onChange, options, width = 180,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: number;
}) {
  return (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.primary" }}>{label}</Typography>
      <TextField
        select size="small" value={value} onChange={(e) => onChange(e.target.value)}
        sx={{ display: "block", mt: 0.25, width }}
        SelectProps={{ native: false }}
        fullWidth
      >
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </TextField>
    </Box>
  );
}
