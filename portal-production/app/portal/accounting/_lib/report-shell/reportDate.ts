// A report date filter that is still being TYPED must not re-run the report
// (guru 2026-11-18).
//
// Reports lost their Update button on 2026-11-16 — every filter change re-runs
// them — and a native <input type="date"> fires onChange on each segment. Type
// the "16" of 16/11/2026 and the browser hands over "0016-11-30"; the Debtor
// Statement then built a statement for the year 16, kept only its prior-month
// aged rows, printed an Ageing Analysis headed "NOV 1900" and dropped the
// month's credit note. It reads exactly like missing data, and the user has no
// idea their own half-typed date caused it.
//
// So a date is accepted only once it is a WHOLE, PLAUSIBLE day. Until then the
// field keeps showing what is being typed (the browser owns the segments) while
// the report stays on the last good date.
const MIN_YEAR = 1990;

export function isUsableReportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < MIN_YEAR || y > new Date().getFullYear() + 10) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Rejects 31 Feb and friends: the roll-over changes the month back.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Commit a date filter only when it is whole; "" (cleared) is passed through
 *  for the range pickers, where clearing one end is a real choice. */
export const onReportDate = (apply: (v: string) => void, allowEmpty = false) =>
  (e: { target: { value: string } }) => {
    const v = e.target.value;
    if (allowEmpty && v === "") { apply(v); return; }
    if (isUsableReportDate(v)) apply(v);
  };
