"use client";

// Money box (guru 2026-11-14: "make all decimal 2 dp"): a browser number
// input drops trailing zeros (21.20 shows as 21.2), so amounts are keyed in a
// text box that shows the stored value to two decimals when not focused, lets
// the user type freely while focused, and commits "21.20" (or "" when
// cleared) on blur / Enter. The handlers keep receiving strings, as before.
import * as React from "react";
import { TextField, type SxProps, type Theme } from "@mui/material";

type Props = {
  value: any;
  onCommit: (v: string) => void;
  disabled?: boolean;
  fullWidth?: boolean;
  title?: string;
  placeholder?: string;
  /** Clamp to this amount (an allocation can't exceed the outstanding). */
  max?: number;
  /** Negative amounts allowed (a credit line on a voucher). */
  allowNegative?: boolean;
  sx?: SxProps<Theme>;
};

export const formatMoney2 = (v: any): string => (v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "");

export default function MoneyInput({ value, onCommit, disabled, fullWidth, title, placeholder, max, allowNegative, sx }: Props) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    let n = parseFloat(draft.replace(/,/g, ""));
    if (!Number.isFinite(n)) onCommit("");
    else {
      if (!allowNegative && n < 0) n = 0;
      if (max !== undefined && n > max) n = max;
      onCommit(n.toFixed(2));
    }
    setDraft(null);
  };
  return (
    <TextField
      size="small"
      fullWidth={fullWidth}
      title={title}
      placeholder={placeholder}
      disabled={disabled}
      value={draft ?? formatMoney2(value)}
      onFocus={() => setDraft(formatMoney2(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      inputProps={{ inputMode: "decimal", style: { textAlign: "right" } }}
      sx={sx}
    />
  );
}
