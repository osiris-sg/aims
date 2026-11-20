"use client";

// Calendar style job fields (WCT group, 2026-11-18, enableCalendarStyle): Salesperson (the chip's fill), PTW
// applicant (the chip's left bar), COD, Generate sticker (📌, 2026-11-19), and on the job page Postponed. Used by the New / Edit job form and the job
// page. Rendered only when the org has the calendar style.

import React from "react";
import { Autocomplete, Box, Checkbox, FormControlLabel, Stack, TextField } from "@mui/material";
import type { StylePerson } from "./calendarAddApi";
import { applicantOptionLabel } from "./calendarModel";
import CrewPicker from "./CrewPicker";
import type { CrewPick } from "@/helpers/crewPicker";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export interface JobStyleValue {
  salesperson: StylePerson | null;
  ptwApplicant: StylePerson | null;
  cod: boolean;
  postponed?: boolean;
  /** "Generate sticker" (2026-11-19): the job shows 📌 on the calendar. */
  sticker?: boolean;
  /** "Team / crew" (round 36, 2026-11-20): free text, e.g. "Team A + Guru"; absent = not offered on this form. */
  team?: string;
  /** Round 39 B4 (Workers & Teams on): the picked teams / workers (team then holds the free text only). */
  crew?: CrewPick[];
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
  applicantsFromList = false,
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
  /** The applicants are the org's PTW applicants list (2026-11-19): only they are offered; a pick outside is marked. */
  applicantsFromList?: boolean;
}) {
  // Round 39 B4: Workers & Teams orgs pick teams / workers; everyone else types as before.
  const { isWorkersTeamsEnabled } = useOrganizationFeatures();
  const crewOn = !!isWorkersTeamsEnabled;
  return (
    // Round 41: the row wraps when narrow (the job dialogs' left column) instead of pushing the form sideways.
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap flexWrap="wrap" alignItems={{ sm: "center" }} data-tour="job-style-fields">
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
          getOptionLabel={(o) => applicantOptionLabel(o, applicants, applicantsFromList)}
          renderOption={({ key, ...props }: any, o) => (
            <li key={key ?? o.id} {...props}>
              {o.colour && <Box component="span" sx={{ width: 12, height: 12, borderRadius: "3px", bgcolor: o.colour, mr: 1, flexShrink: 0 }} />}
              {applicantOptionLabel(o, applicants, applicantsFromList)}
            </li>
          )}
          sx={{ flex: 1, minWidth: 180 }}
          renderInput={(params) => <TextField {...params} label="PTW applicant" />}
        />
      )}
      <FormControlLabel control={<Checkbox size="small" checked={value.cod} onChange={(e) => onChange({ cod: e.target.checked })} />} label="COD" sx={{ mr: 0, flexShrink: 0 }} />
      <FormControlLabel
        control={<Checkbox size="small" checked={!!value.sticker} onChange={(e) => onChange({ sticker: e.target.checked })} />}
        label="Generate sticker"
        sx={{ mr: 0, flexShrink: 0 }}
        data-tour="job-sticker"
      />
      {value.team !== undefined && crewOn && (
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <CrewPicker crew={value.crew ?? []} team={value.team} onChange={(v) => onChange({ crew: v.crew, team: v.team })} />
        </Box>
      )}
      {value.team !== undefined && !crewOn && (
        <TextField
          size="small"
          label="Team / crew"
          value={value.team}
          onChange={(e) => onChange({ team: e.target.value })}
          inputProps={{ maxLength: 120 }}
          InputLabelProps={{ shrink: true }}
          sx={{ flex: 1, minWidth: 160 }}
          data-tour="job-team"
        />
      )}
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
