"use client";

// Exchange-rate box, shared by every screen that keys a rate (guru 2026-11-11:
// rates carry SEVEN decimal places everywhere; 2026-11-14: "why is the rate
// not 7 decimal point" — a number input drops the trailing zeros, so this one
// shows the stored rate as 1.0000000, lets the user type freely while focused,
// and commits the number on blur / Enter). A blank or unparsable entry falls
// back to `fallback` (1 = at par; "" for a rate table row).
import * as React from "react";
import { TextField, type SxProps, type Theme } from "@mui/material";
import { sanitizeMoneyDraft } from "./MoneyInput";

type Props = {
  value: any;
  onCommit: (n: number | "") => void;
  fallback?: number | "";
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  title?: string;
  align?: "left" | "right";
  sx?: SxProps<Theme>;
};

export const formatRate = (v: any, fallback: number | "" = 1): string =>
  v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v).toFixed(7) : fallback === "" ? "" : Number(fallback).toFixed(7);

export default function RateInput({ value, onCommit, fallback = 1, disabled, label, placeholder, title, align = "right", sx }: Props) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    onCommit(Number.isFinite(n) && n > 0 ? n : fallback);
    setDraft(null);
  };
  return (
    <TextField
      size="small"
      label={label}
      placeholder={placeholder}
      title={title}
      disabled={disabled}
      value={draft ?? formatRate(value, fallback)}
      onFocus={() => setDraft(formatRate(value, fallback))}
      // Numbers only, like MoneyInput (guru 2026-11-18): digits and one point.
      onChange={(e) => setDraft(sanitizeMoneyDraft(e.target.value))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); return; }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !/[0-9.]/.test(e.key)) e.preventDefault();
      }}
      inputProps={{ inputMode: "decimal", autoComplete: "off", style: { textAlign: align } }}
      sx={sx}
    />
  );
}
