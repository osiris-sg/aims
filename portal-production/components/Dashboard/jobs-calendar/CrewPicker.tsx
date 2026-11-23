"use client";

// Round 39 B4 (Workers & Teams, WCT (S), flag enableWorkersTeams): the jobs' "Team / crew" field. Pick teams and
// workers from Settings > Workers & Teams (several), or type anything (Enter or leaving the field keeps it as text).
// Rules in helpers/crewPicker.ts. Used by New / Edit job, the job page and the calendar side panel.

import React, { useEffect, useMemo, useState } from "react";
import { Autocomplete, Chip, TextField } from "@mui/material";
import { useCalendarApi } from "./calendarAddApi";
import { chipsToValue, crewChips, crewLabel, crewOptionList, sameCrew, sameValue, type CrewChip, type CrewOptions, type CrewPick } from "@/helpers/crewPicker";

/** The org's active teams and workers (GET /workers-teams/picker), read once per page. */
let cached: { at: number; org: string; data: CrewOptions } | null = null;
export function useCrewOptions(enabled: boolean): CrewOptions | null {
  const api = useCalendarApi();
  const [data, setData] = useState<CrewOptions | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let org = "";
    try {
      org = window.sessionStorage.getItem("aims-admin-active-org") || "";
    } catch {
      org = "";
    }
    if (cached && cached.org === org && Date.now() - cached.at < 60_000) {
      setData(cached.data);
      return;
    }
    let live = true;
    void api<CrewOptions>("GET", "/workers-teams/picker").then((res) => {
      if (!live || !res.ok || !res.data) return;
      cached = { at: Date.now(), org, data: res.data };
      setData(res.data);
    });
    return () => {
      live = false;
    };
  }, [enabled, api]);
  return data;
}

export default function CrewPicker({
  crew,
  team,
  onChange,
  label = "Team / crew",
  size = "small",
  fullWidth = true,
  hideLabel = false,
}: {
  crew: CrewPick[];
  team: string;
  onChange: (v: { crew: CrewPick[]; team: string }) => void;
  label?: string;
  size?: "small" | "medium";
  fullWidth?: boolean;
  hideLabel?: boolean;
}) {
  const options = useCrewOptions(true);
  const list = useMemo(() => crewOptionList(options), [options]);
  const value = useMemo(() => crewChips(crew, team), [crew, team]);
  const [input, setInput] = useState("");
  // 2026-11-24: duplicates (any case, or text equal to a pick's name) are dropped, and nothing is sent when the
  // field did not change, so a deleted chip is not saved back by a stale copy.
  const commit = (chips: CrewChip[]) => {
    const next = chipsToValue(chips);
    if (sameValue(next, chipsToValue(value))) return;
    onChange(next);
  };
  return (
    <Autocomplete<CrewChip, true, false, true>
      multiple
      freeSolo
      size={size}
      fullWidth={fullWidth}
      options={list}
      value={value}
      inputValue={input}
      onInputChange={(_, v, reason) => setInput(reason === "reset" ? "" : v)}
      onChange={(_, v) => commit(v)}
      // Typed text not picked from the list is kept as text when the field is left.
      onBlur={() => {
        const t = input.trim();
        if (t) commit([...value, t]);
        setInput("");
      }}
      groupBy={(o) => (typeof o === "string" ? "" : o.kind === "team" ? "Teams" : "Workers")}
      getOptionLabel={crewLabel}
      isOptionEqualToValue={sameCrew}
      filterSelectedOptions
      renderTags={(chips, getTagProps) =>
        chips.map((c, i) => {
          const { key, ...rest } = getTagProps({ index: i });
          return <Chip key={key} size="small" label={crewLabel(c)} variant={typeof c === "string" ? "outlined" : "filled"} {...rest} />;
        })
      }
      renderInput={(params) => <TextField {...params} label={hideLabel ? undefined : label} InputLabelProps={{ shrink: true }} inputProps={{ ...params.inputProps, maxLength: 120, "aria-label": label }} />}
      data-tour="job-team"
    />
  );
}
