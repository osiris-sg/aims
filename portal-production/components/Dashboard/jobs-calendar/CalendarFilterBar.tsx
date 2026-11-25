"use client";

// Jobs calendar filter bar (round 36, WCT group, calendar style orgs): DO generated / not, PTW (needed / required /
// pending / approved / rejected / not needed), PTW applicant, Company, then on the right the search box, "Export list" and
// "Settings" (Calendar colours, Org Settings edit only). Round 38: the Cancelled / Postponed / COD / Sticker chips are
// gone (Export list keeps its own Include cancelled / on hold ticks). 2026-11-25: the Category filter is gone for now
// and the search moved to the right end. Filters only narrow the jobs on screen (notes stay).

import React from "react";
import { Box, Button, Checkbox, FormControl, InputLabel, ListItemText, MenuItem, OutlinedInput, Select, Stack } from "@mui/material";
import IosShareIcon from "@mui/icons-material/IosShare";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { NO_APPLICANT, NO_FILTERS, PTW_ICON, filterCount, type CalendarFilters, type PtwFilter } from "./calendarPanel";

const PTW_OPTIONS: Array<{ value: PtwFilter; label: string }> = [
  { value: "needed", label: "PTW needed" },
  { value: "required", label: `Required ${PTW_ICON.REQUIRED}` },
  { value: "pending", label: `Pending ${PTW_ICON.SUBMITTED}` },
  { value: "approved", label: `Approved ${PTW_ICON.APPROVED}` },
  { value: "rejected", label: `Rejected ${PTW_ICON.REJECTED}` },
  { value: "none", label: "Not needed" },
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
  companies,
  onExport,
  onSettings,
  search,
}: {
  value: CalendarFilters;
  onChange: (f: CalendarFilters) => void;
  applicants: Array<{ id: string; name: string }>;
  /** Group calendar: the companies shown (none = no Company filter). */
  companies: Array<{ id: string; name: string }>;
  onExport?: () => void;
  /** Calendar colours (2026-11-25): only for Org Settings edit; absent = no button. */
  onSettings?: () => void;
  /** WCT group calendar (2026-11-23): the search box; 2026-11-25 at the right end, just left of "Export list". */
  search?: React.ReactNode;
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
      {companies.length > 1 && <Multi label="Organisation" value={value.companies} options={companies.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => set({ companies: v })} width={150} />}
      {n > 0 && (
        <Button size="small" onClick={() => onChange(NO_FILTERS)}>
          {`Clear (${n})`}
        </Button>
      )}
      <Box sx={{ flex: 1 }} />
      {search}
      {onExport && (
        <Button size="small" variant="outlined" startIcon={<IosShareIcon fontSize="small" />} onClick={onExport} data-tour="jobs-calendar-export">
          Export list
        </Button>
      )}
      {onSettings && (
        <Button size="small" variant="outlined" startIcon={<SettingsOutlinedIcon fontSize="small" />} onClick={onSettings} data-tour="jobs-calendar-settings">
          Settings
        </Button>
      )}
    </Stack>
  );
}
