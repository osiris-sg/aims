// Field phase 6 (Payroll): pure helpers (SiteClock web Payroll.tsx @62b7d9d).

export const money = (cents: number | null | undefined) => (cents == null ? "" : `$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const hours = (min: number) => (min / 60).toFixed(2);
export const PAY_TYPE_LABEL: Record<string, string> = { MONTHLY: "Monthly salary", DAILY: "Daily rate", HOURLY: "Hourly rate" };
export const PREMIUM_LABEL: Record<string, string> = { DOUBLE_DAY: "Extra day's pay (MOM)", OT_RATE: "Hours at the OT rate", FIXED_HOURLY: "Hours at a fixed rate" };

/** "$12.50" -> 1250; "" -> null. */
export function toCents(v: string): number | null {
  const s = v.replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** The profile form -> the API body (cents, nulls for blank overrides). */
export function profileBody(f: Record<string, any>) {
  const c = (k: string) => toCents(String(f[k] ?? "")) ?? 0;
  return {
    payType: f.payType,
    basicMonthlyCents: c("basicMonthly"),
    hourlyRateCents: c("hourlyRate"),
    fixedAllowanceCents: c("fixedAllowance"),
    deductHousingCents: c("deductHousing"),
    deductOtherCents: c("deductOther"),
    workDaysPerWeek: Number(f.workDaysPerWeek) || 6,
    restDays: f.restDays,
    premiumMode: f.premiumMode,
    premiumRateCents: c("premiumRate"),
    weekdayOt: !!f.weekdayOt,
    otRateCentsOverride: toCents(String(f.otRateOverride ?? "")),
    dailyRateCentsOverride: toCents(String(f.dailyRateOverride ?? "")),
  };
}

/** The profile from the API -> the form (dollars as text). */
export function profileForm(p: Record<string, any>) {
  const d = (c: number | null | undefined) => (c == null ? "" : String(c / 100));
  return {
    payType: p.payType ?? "MONTHLY",
    basicMonthly: d(p.basicMonthlyCents),
    hourlyRate: d(p.hourlyRateCents),
    fixedAllowance: d(p.fixedAllowanceCents),
    deductHousing: d(p.deductHousingCents),
    deductOther: d(p.deductOtherCents),
    workDaysPerWeek: String(p.workDaysPerWeek ?? 6),
    restDays: p.restDays ?? [],
    premiumMode: p.premiumMode ?? "DOUBLE_DAY",
    premiumRate: d(p.premiumRateCents),
    weekdayOt: p.weekdayOt ?? true,
    otRateOverride: d(p.otRateCentsOverride),
    dailyRateOverride: d(p.dailyRateCentsOverride),
  };
}
