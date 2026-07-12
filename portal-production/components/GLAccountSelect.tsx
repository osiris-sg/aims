"use client";

import React, { useMemo } from "react";
import { Autocomplete, TextField } from "@mui/material";

// Shared searchable GL-account picker. Accepts the grouped shape used across
// the app ([{ label, accounts: [{ code, name }] }]) — type-to-filter across
// code + name, grouped by account type, popup height capped so long charts of
// accounts scroll instead of sprawling over the dialog.
interface GLAccountSelectProps {
  value: string;
  accounts: any[]; // [{ label, accounts: [{ code, name }] }]
  onChange: (code: string) => void;
  label?: string;
  helperText?: string;
  size?: "small" | "medium";
  disabled?: boolean;
}

export default function GLAccountSelect({ value, accounts, onChange, label, helperText, size = "small", disabled }: GLAccountSelectProps) {
  const options = useMemo(
    () => (accounts || []).flatMap((g: any) => (g.accounts || []).map((a: any) => ({ code: String(a.code), name: a.name, group: g.label }))),
    [accounts]
  );
  const selected = options.find((o) => o.code === String(value ?? "")) ?? null;
  return (
    <Autocomplete
      size={size}
      fullWidth
      disabled={disabled}
      options={options}
      groupBy={(o) => o.group}
      getOptionLabel={(o) => `${o.code} — ${o.name}`}
      isOptionEqualToValue={(o, v) => o.code === v.code}
      value={selected}
      onChange={(_, o) => onChange(o ? o.code : "")}
      renderOption={(optionProps, o) => (
        <li {...optionProps} key={o.code}>
          {o.code} — {o.name}
        </li>
      )}
      ListboxProps={{ sx: { maxHeight: 320 } }}
      renderInput={(params) => <TextField {...params} label={label} placeholder="Search account..." helperText={helperText} />}
      noOptionsText="No matching accounts"
      autoHighlight
      clearOnEscape
    />
  );
}
