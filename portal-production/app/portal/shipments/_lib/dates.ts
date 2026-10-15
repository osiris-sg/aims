/* eslint-disable @typescript-eslint/no-explicit-any */
// Trade dates are in 2000–2100. A browser date input lets the year run to 5+
// digits (a stray keystroke gave "72026-08-20", which the PDF printed as
// typed), so every date / month field gets min / max and shows an error while
// the year is out of range; the API refuses such values too (shipments.rules
// tradeDateError — keep the two in step).

export const TRADE_YEAR_MIN = 2000;
export const TRADE_YEAR_MAX = 2100;

/** Why a "YYYY-MM-DD" / "YYYY-MM" value is not acceptable, or null (blank is fine). */
export function tradeDateError(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const m = /^(\d+)-(\d{2})(?:-(\d{2}))?(?:$|T)/.exec(String(value).trim());
  if (!m) return "Enter a valid date";
  const year = Number(m[1]);
  if (m[1].length !== 4 || year < TRADE_YEAR_MIN || year > TRADE_YEAR_MAX) return `Year must be ${TRADE_YEAR_MIN}–${TRADE_YEAR_MAX}`;
  return null;
}

/**
 * Extra props for a TextField: for type "date" / "month" adds min / max and,
 * while the value's year is out of range, error + helperText (an existing
 * error / helperText is kept otherwise). Other types pass through unchanged.
 */
export function guardDate<T extends Record<string, any>>(extra: T, value: unknown): T {
  const type = extra?.type;
  if (type !== "date" && type !== "month") return extra;
  const err = tradeDateError(value);
  const bounds = type === "date" ? { min: `${TRADE_YEAR_MIN}-01-01`, max: `${TRADE_YEAR_MAX}-12-31` } : { min: `${TRADE_YEAR_MIN}-01`, max: `${TRADE_YEAR_MAX}-12` };
  return {
    ...extra,
    inputProps: { ...bounds, ...(extra.inputProps ?? {}) },
    error: !!err || !!extra.error,
    helperText: err ?? extra.helperText,
  };
}

/** True when any of the values is a date with an out-of-range year. */
export const anyDateError = (...values: unknown[]) => values.some((v) => tradeDateError(v) !== null);
