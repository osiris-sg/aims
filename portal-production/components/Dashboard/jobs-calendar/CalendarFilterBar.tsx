"use client";

// Jobs calendar filter bar (round 36, WCT group, calendar style orgs): DO generated / not, PTW (needed / pending /
// approved / rejected / not needed), PTW applicant, Cancelled, Postponed, COD, Sticker, Category, Company, and the
// "Export list" button. Filters only narrow the jobs on screen (notes stay); the people panel keeps working alongside.

import React from "react";
import { Box, Button, Checkbox, Chip, FormControl, InputLabel, ListItemText, MenuItem, OutlinedInput, Select, Stack } from "@mui/material";
import IosShareIcon from "@mui/icons-material/IosShare";
import { NO_APPLICANT, NO_FILTERS, filterCount, type CalendarFilters, type FlagFilter, type PtwFilter } from "./calendarPanel";

const PTW_OPTIONS: Array<{ value: PtwFilter; label: string }> = [
  { value: "needed", label: "PTW needed" },
  { value: "pending", label: "Pending ✋" },
  { value: "approved", label: "Approved 👍" },
  { value: "rejected", label: "Rejected 👎" },
  { value: "none", label: "Not needed" },
];
const FLAGS: Array<{ value: FlagFilter; label: string }> = [
  { value: "cancelled", label: "❌ Cancelled" },
  { value: "postponed", label: "⭕ Postponed" },
  { value: "cod", label: "🟫 COD" },
  { value: "sticker", label: "📌 Sticker" },
];

function Multi({ label, value, options, onChange, width = 150 }: { label: string; value: string[]; options: Array<{ value: string; label: string }>; onChange: (v: string[]) => void; width?: number }) {
  const id = `jc-filter-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <FormControl size="small" sx={{ minWidth: width }}>
      <InputLabel id={id}>{label}</InputLabel>
      <Select
        labelId={id}
        multiple
        value={value}
        onChange={(e) => onChange(typeof e.target.value === "string" ? e.target.value.split(",") : (e.target.value as string[]))}
        input={<OutlinedInput label={label} />}
        renderValue={(sel) => (sel.length === 1 ? options.find((o) => o.value === sel[0])?.label ?? sel[0] : `${sel.length} picked`)}
      >
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value} dense>
            <Checkbox size="small" checked={value.includes(o.value)} />
            <ListItemText primary={o.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export default function CalendarFilterBar({
  value,
  onChange,
  applicants,
  categories,
  companies,
  onExport,
}: {
  value: CalendarFilters;
  onChange: (f: CalendarFilters) => void;
  applicants: Array<{ id: string; name: string }>;
  categories: string[];
  /** Group calendar: the companies shown (none = no Company filter). */
  companies: Array<{ id: string; name: string }>;
  onExport?: () => void;
}) {
  const set = (patch: Partial<CalendarFilters>) => onChange({ ...value, ...patch });
  const n = filterCount(value);
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 1.5 }} data-tour="jobs-calendar-filters">
      <FormControl size="small" sx={{ minWidth: 140 }}>
        <InputLabel id="jc-filter-do">DO</InputLabel>
        <Select labelId="jc-filter-do" label="DO" value={value.doState} onChange={(e) => set({ doState: e.target.value as CalendarFilters["doState"] })}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="yes">✅ DO generated</MenuItem>
          <MenuItem value="no">No DO yet</MenuItem>
        </Select>
      </FormControl>
      <Multi label="PTW" value={value.ptw} options={PTW_OPTIONS} onChange={(v) => set({ ptw: v as PtwFilter[] })} width={130} />
      {applicants.length > 0 && (
        <Multi label="Applicant" value={value.applicants} options={[...applicants.map((a) => ({ value: a.id, label: a.name })), { value: NO_APPLICANT, label: "None" }]} onChange={(v) => set({ applicants: v })} width={140} />
      )}
      {categories.length > 0 && <Multi label="Category" value={value.categories} options={categories.map((c) => ({ value: c, label: c }))} onChange={(v) => set({ categories: v })} width={140} />}
      {companies.length > 1 && <Multi label="Company" value={value.companies} options={companies.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => set({ companies: v })} width={150} />}
      {FLAGS.map((f) => {
        const on = value.flags.includes(f.value);
        return (
          <Chip
            key={f.value}
            label={f.label}
            size="small"
            clickable
            color={on ? "primary" : "default"}
            variant={on ? "filled" : "outlined"}
            onClick={() => set({ flags: on ? value.flags.filter((x) => x !== f.value) : [...value.flags, f.value] })}
          />
        );
      })}
      {n > 0 && (
        <Button size="small" onClick={() => onChange(NO_FILTERS)}>
          {`Clear (${n})`}
        </Button>
      )}
      <Box sx={{ flex: 1 }} />
      {onExport && (
        <Button size="small" variant="outlined" startIcon={<IosShareIcon fontSize="small" />} onClick={onExport} data-tour="jobs-calendar-export">
          Export list
        </Button>
      )}
    </Stack>
  );
}
