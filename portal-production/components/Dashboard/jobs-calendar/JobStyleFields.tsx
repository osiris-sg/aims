"use client";

// Calendar style job fields (WCT group, 2026-11-18, enableCalendarStyle): Salesperson (the chip's fill), PTW
// applicant (the chip's left bar), COD, and on the job page Postponed. Used by the New / Edit job form and the job
// page. Rendered only when the org has the calendar style.

import React from "react";
import { Autocomplete, Checkbox, FormControlLabel, Stack, TextField } from "@mui/material";
import type { StylePerson } from "./calendarAddApi";

export interface JobStyleValue {
  salesperson: StylePerson | null;
  ptwApplicant: StylePerson | null;
  cod: boolean;
  postponed?: boolean;
}

/** Options with the current pick kept (a person no longer listed still shows by name). */
const withPick = (list: StylePerson[], pick: StylePerson | null) => (pick && !list.some((p) => p.id === pick.id) ? [pick, ...list] : list);

export default function JobStyleFields({
  value,
  onChange,
  salespeople,
  applicants,
  showApplicant,
  showPostponed = false,
  salespersonPlaceholder,
}: {
  value: JobStyleValue;
  onChange: (patch: Partial<JobStyleValue>) => void;
  salespeople: StylePerson[];
  applicants: StylePerson[];
  /** The PTW applicant only matters when a PTW is needed. */
  showApplicant: boolean;
  showPostponed?: boolean;
  /** Order jobs: who fills the chip when no one is picked (the quotation's salesman). */
  salespersonPlaceholder?: string;
}) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} data-tour="job-style-fields">
      <Autocomplete
        size="small"
        options={withPick(salespeople, value.salesperson)}
        value={value.salesperson}
        onChange={(_e, v) => onChange({ salesperson: v ?? null })}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        getOptionLabel={(o) => o.name}
        sx={{ flex: 1, minWidth: 180 }}
        renderInput={(params) => <TextField {...params} label="Salesperson" placeholder={salespersonPlaceholder || "None"} InputLabelProps={{ shrink: true }} />}
      />
      {showApplicant && (
        <Autocomplete
          size="small"
          options={withPick(applicants, value.ptwApplicant)}
          value={value.ptwApplicant}
          onChange={(_e, v) => onChange({ ptwApplicant: v ?? null })}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          getOptionLabel={(o) => o.name}
          sx={{ flex: 1, minWidth: 180 }}
          renderInput={(params) => <TextField {...params} label="PTW applicant" />}
        />
      )}
      <FormControlLabel control={<Checkbox size="small" checked={value.cod} onChange={(e) => onChange({ cod: e.target.checked })} />} label="COD" sx={{ mr: 0, flexShrink: 0 }} />
      {showPostponed && (
        <FormControlLabel
          control={<Checkbox size="small" checked={!!value.postponed} onChange={(e) => onChange({ postponed: e.target.checked })} />}
          label="Postponed"
          sx={{ mr: 0, flexShrink: 0 }}
        />
      )}
    </Stack>
  );
}
