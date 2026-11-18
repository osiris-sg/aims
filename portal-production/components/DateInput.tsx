"use client";
/**
 * The ONE date field of the portal — every date is typed and shown as
 * dd/mm/yyyy, for every org (guru 2026-11-18).
 *
 * Why not <TextField type="date">: the browser decides how a native date input
 * reads, and Chrome on an en-US machine renders it 11/17/2026 no matter what
 * `lang` says. So this wraps the MUI DatePicker with a fixed DD/MM/YYYY mask
 * while keeping the native input's CONTRACT, so it is a drop-in swap:
 *   - `value` is the ISO day string the native input used ("2026-11-17" or "")
 *   - `onChange(e)` receives an event-like object whose `e.target.value` is the
 *     same ISO day string ("" once the field is cleared)
 *   - `inputProps.min` / `inputProps.max` still bound the pickable range
 * A half-typed date never reaches `onChange` (the native input handed over
 * "0016-11-30" for a typed "16" and autosaving editors wrote it); the caller
 * only hears whole, in-range dates and the explicit clear.
 */
import * as React from "react";
import dayjs, { Dayjs } from "dayjs";
import "dayjs/locale/en-gb";
import type { TextFieldProps } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { walkField } from "@/helpers/enterAdvance";

export const DATE_DISPLAY_FORMAT = "DD/MM/YYYY";

type Props = Omit<TextFieldProps, "type" | "value" | "onChange" | "select" | "multiline"> & {
  value?: string | null;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Where the calendar button sits; the document editor wants it on the left. */
  iconPosition?: "start" | "end";
};

const toDay = (v: string | null | undefined): Dayjs | null => {
  if (!v) return null;
  const d = dayjs(String(v).slice(0, 10));
  return d.isValid() ? d : null;
};

export default function DateInput({ value, onChange, name, disabled, inputProps, iconPosition = "end", InputLabelProps, ...textField }: Props) {
  const { min, max, ...restInputProps } = (inputProps || {}) as { min?: string; max?: string; [k: string]: unknown };
  const parsed = React.useMemo(() => toDay(value), [value]);

  const emit = React.useCallback(
    (iso: string) => {
      if (!onChange) return;
      const target = { name, value: iso, type: "date" } as unknown as HTMLInputElement;
      onChange({ target, currentTarget: target, persist() {}, preventDefault() {}, stopPropagation() {} } as unknown as React.ChangeEvent<HTMLInputElement>);
    },
    [onChange, name],
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="en-gb">
      <DatePicker
        value={parsed}
        format={DATE_DISPLAY_FORMAT}
        disabled={disabled}
        minDate={min ? dayjs(min) : undefined}
        maxDate={max ? dayjs(max) : undefined}
        onChange={(d, ctx) => {
          if (d === null) {
            emit("");
            return;
          }
          // Still being typed (16/11/____) or out of range: the caller keeps
          // the last good date.
          if (!d.isValid() || ctx.validationError) return;
          const iso = d.format("YYYY-MM-DD");
          if (iso !== (value ? String(value).slice(0, 10) : "")) emit(iso);
        }}
        slotProps={{
          inputAdornment: { position: iconPosition },
          field: { clearable: false },
          textField: {
            ...(textField as object),
            // ↑↓ walk the form like every other box (guru 2026-11-18) instead
            // of stepping the day/month/year: caught on the way down, before the
            // picker's own handler. Outside a form / dialog / editor the picker
            // keeps its stepping.
            onKeyDownCapture: (e: React.KeyboardEvent<HTMLElement>) => {
              if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
              const el = e.target as HTMLElement;
              if (!(el instanceof HTMLInputElement)) return;
              if (walkField(el, e.key === "ArrowUp" ? -1 : 1)) {
                e.preventDefault();
                e.stopPropagation();
              }
            },
            name,
            inputProps: restInputProps,
            InputLabelProps: { shrink: true, ...(InputLabelProps || {}) },
          },
        }}
      />
    </LocalizationProvider>
  );
}
