"use client";
/*
 * Date range for the Filter drawer and the project / inventory forms
 * (guru 2026-11-21: "fix the UI of the date range").
 *
 * It used to open react-date-range in a dialog painted with the tertiary
 * colour: a green box, a white preset list with white text, "Early" /
 * "Continuous" placeholders, a calendar that ignored the theme. Now it is the
 * portal's own DateInput twice (From / To, dd/mm/yyyy, the same picker every
 * date field uses) plus one row of quick ranges as chips. No dialog; the value
 * is reported on every change, so the drawer's Apply still decides when it
 * takes effect. Same props as before, so every caller is unchanged.
 */
import React from "react";
import { Box, Button, Chip, InputLabel, Stack } from "@mui/material";
import DateInput from "@/components/DateInput";

type Range = { startDate: Date | null; endDate: Date | null };

interface Props {
  onConfirm?: (value: Range & { key: "selection" }) => void;
  value: { startDate: Date | null | undefined; endDate: Date | null | undefined } | any;
  label: string;
}

/** A Date, a moment, an ISO string or nothing → a Date at local midnight, or null. */
function toDate(v: any): Date | null {
  if (!v) return null;
  const d: Date = typeof v?.toDate === "function" ? v.toDate() : v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const pad = (n: number) => String(n).padStart(2, "0");
/** Date → "yyyy-mm-dd" for DateInput (its wire format), "" when empty. */
const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "");
/** "yyyy-mm-dd" → local-midnight Date, null when empty. */
const fromYmd = (s: string): Date | null => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
const sameDay = (a: Date | null, b: Date | null) => (!a && !b) || (!!a && !!b && a.getTime() === b.getTime());

/** The quick ranges, computed at click time. Weeks run Monday → Sunday. */
const PRESETS: { key: string; label: string; range: () => Range }[] = [
  { key: "today", label: "Today", range: () => { const t = today(); return { startDate: t, endDate: t }; } },
  { key: "yesterday", label: "Yesterday", range: () => { const t = addDays(today(), -1); return { startDate: t, endDate: t }; } },
  { key: "thisWeek", label: "This week", range: () => { const s = startOfWeek(today()); return { startDate: s, endDate: addDays(s, 6) }; } },
  { key: "lastWeek", label: "Last week", range: () => { const s = addDays(startOfWeek(today()), -7); return { startDate: s, endDate: addDays(s, 6) }; } },
  { key: "thisMonth", label: "This month", range: () => { const t = today(); return { startDate: new Date(t.getFullYear(), t.getMonth(), 1), endDate: new Date(t.getFullYear(), t.getMonth() + 1, 0) }; } },
  { key: "lastMonth", label: "Last month", range: () => { const t = today(); return { startDate: new Date(t.getFullYear(), t.getMonth() - 1, 1), endDate: new Date(t.getFullYear(), t.getMonth(), 0) }; } },
  { key: "thisYear", label: "This year", range: () => { const t = today(); return { startDate: new Date(t.getFullYear(), 0, 1), endDate: new Date(t.getFullYear(), 11, 31) }; } },
];
function today(): Date { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function addDays(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function startOfWeek(d: Date): Date { const dow = (d.getDay() + 6) % 7; return addDays(d, -dow); }

export default function DateRangePicker({ onConfirm, value, label }: Props) {
  const start = toDate(value?.startDate);
  const end = toDate(value?.endDate);

  const emit = (startDate: Date | null, endDate: Date | null) => onConfirm?.({ startDate, endDate, key: "selection" });

  const activePreset = PRESETS.find((p) => {
    const r = p.range();
    return sameDay(r.startDate, start) && sameDay(r.endDate, end);
  })?.key;

  return (
    <Box sx={{ width: "100%" }}>
      <InputLabel sx={{ color: "text.secondary", fontSize: "0.875rem", display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", mb: 0.75 }}>
        {label}
        <Button
          variant="text"
          onClick={() => emit(null, null)}
          disabled={!start && !end}
          sx={{ p: 0, minWidth: 0, textTransform: "none", fontSize: "0.8rem", color: "text.secondary", "&:hover": { color: "text.primary", backgroundColor: "transparent" } }}
        >
          Reset filter
        </Button>
      </InputLabel>

      <Stack direction="row" spacing={1.5} sx={{ width: "100%" }}>
        <DateInput
          label="From"
          fullWidth
          value={ymd(start)}
          onChange={(e) => {
            const s = fromYmd(e.target.value);
            // A start after the end drags the end along so the range never inverts.
            emit(s, s && end && s > end ? s : end);
          }}
          inputProps={end ? { max: ymd(end) } : undefined}
        />
        <DateInput
          label="To"
          fullWidth
          value={ymd(end)}
          onChange={(e) => {
            const en = fromYmd(e.target.value);
            emit(en && start && en < start ? en : start, en);
          }}
          inputProps={start ? { min: ymd(start) } : undefined}
        />
      </Stack>

      <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75} sx={{ mt: 1 }}>
        {PRESETS.map((p) => (
          <Chip
            key={p.key}
            size="small"
            label={p.label}
            clickable
            color={activePreset === p.key ? "primary" : "default"}
            variant={activePreset === p.key ? "filled" : "outlined"}
            onClick={() => {
              const r = p.range();
              emit(r.startDate, r.endDate);
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}
