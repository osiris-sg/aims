// Repeating jobs and notes (WCT group, 2026-11-25): the "Repeat" choices of the job and note forms, Google Calendar
// style, as RRULE text (the server expands it: api-server-production/src/dashboard/recurrence.ts). Pure helpers.

export const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WD_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORD = ["first", "second", "third", "fourth", "fifth"];

export type RepeatPreset = "none" | "daily" | "weekly" | "monthlyNth" | "monthlyLast" | "monthlyDate" | "yearly" | "weekdays" | "custom";

export interface CustomRepeat {
  interval: number;
  unit: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  /** Weekly: the weekdays (0 = Sunday). */
  weekdays: number[];
  ends: "never" | "on" | "after";
  until: string; // yyyy-MM-dd
  count: number;
}

const dayOf = (date: string) => new Date(`${date}T00:00:00Z`);
const weekday = (date: string) => dayOf(date).getUTCDay();
const nth = (date: string) => Math.ceil(dayOf(date).getUTCDate() / 7);
const isLastWeek = (date: string) => {
  const d = dayOf(date);
  return d.getUTCDate() + 7 > new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};

/** The menu for a start date: Google's list (the 5th weekday of a month offers "last" instead). */
export function repeatOptions(date: string): Array<{ value: RepeatPreset; label: string; rrule: string | null }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [{ value: "none", label: "Does not repeat", rrule: null }];
  const wd = weekday(date);
  const d = dayOf(date);
  const n = nth(date);
  const out: Array<{ value: RepeatPreset; label: string; rrule: string | null }> = [
    { value: "none", label: "Does not repeat", rrule: null },
    { value: "daily", label: "Daily", rrule: "FREQ=DAILY" },
    { value: "weekly", label: `Weekly on ${WD_LONG[wd]}`, rrule: `FREQ=WEEKLY;BYDAY=${WD[wd]}` },
  ];
  if (n <= 4) out.push({ value: "monthlyNth", label: `Monthly on the ${ORD[n - 1]} ${WD_LONG[wd]}`, rrule: `FREQ=MONTHLY;BYDAY=${n}${WD[wd]}` });
  if (isLastWeek(date)) out.push({ value: "monthlyLast", label: `Monthly on the last ${WD_LONG[wd]}`, rrule: `FREQ=MONTHLY;BYDAY=-1${WD[wd]}` });
  out.push(
    { value: "monthlyDate", label: `Monthly on day ${d.getUTCDate()}`, rrule: `FREQ=MONTHLY;BYMONTHDAY=${d.getUTCDate()}` },
    { value: "yearly", label: `Annually on ${d.getUTCDate()} ${MONTH_LONG[d.getUTCMonth()]}`, rrule: "FREQ=YEARLY" },
    { value: "weekdays", label: "Every weekday (Monday to Friday)", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { value: "custom", label: "Custom", rrule: null },
  );
  return out;
}

export const defaultCustom = (date: string): CustomRepeat => ({ interval: 1, unit: "WEEKLY", weekdays: [/^\d{4}-\d{2}-\d{2}$/.test(date) ? weekday(date) : 1], ends: "never", until: "", count: 10 });

/** Custom -> RRULE. */
export function customRule(c: CustomRepeat): string {
  const parts = [`FREQ=${c.unit}`];
  const interval = Math.max(1, Math.min(999, Math.round(Number(c.interval) || 1)));
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (c.unit === "WEEKLY" && c.weekdays.length) parts.push(`BYDAY=${[...new Set(c.weekdays)].sort().map((w) => WD[w]).join(",")}`);
  if (c.ends === "on" && /^\d{4}-\d{2}-\d{2}$/.test(c.until)) parts.push(`UNTIL=${c.until.replace(/-/g, "")}`);
  if (c.ends === "after") parts.push(`COUNT=${Math.max(1, Math.min(5000, Math.round(Number(c.count) || 1)))}`);
  return parts.join(";");
}

/** A stored rule back to the menu: a preset when it is one for that date, else Custom (filled when it fits). */
export function pickerOf(rrule: string | null | undefined, date: string): { preset: RepeatPreset; custom: CustomRepeat } {
  const custom = defaultCustom(date);
  const r = String(rrule ?? "").replace(/^RRULE:/i, "").trim();
  if (!r) return { preset: "none", custom };
  const hit = repeatOptions(date).find((o) => o.rrule && o.rrule === r);
  if (hit) return { preset: hit.value, custom };
  const p: Record<string, string> = {};
  for (const x of r.split(";")) {
    const [k, v] = x.split("=");
    if (k && v) p[k.toUpperCase()] = v.toUpperCase();
  }
  if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(p.FREQ)) custom.unit = p.FREQ as CustomRepeat["unit"];
  custom.interval = Number(p.INTERVAL) || 1;
  if (p.BYDAY && custom.unit === "WEEKLY") custom.weekdays = p.BYDAY.split(",").map((x) => WD.indexOf(x.replace(/^[+-]?\d+/, "") as any)).filter((x) => x >= 0);
  if (p.UNTIL) {
    custom.ends = "on";
    custom.until = `${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}`;
  } else if (p.COUNT) {
    custom.ends = "after";
    custom.count = Number(p.COUNT) || 1;
  }
  return { preset: "custom", custom };
}

/** The rule the form saves: a preset's, or the custom one; null = does not repeat. Keeps a stored rule untouched
 * when it was not changed (an imported Google rule is never rewritten). */
export function ruleOf(preset: RepeatPreset, date: string, custom: CustomRepeat): string | null {
  if (preset === "none") return null;
  if (preset === "custom") return customRule(custom);
  return repeatOptions(date).find((o) => o.value === preset)?.rrule ?? null;
}

/** A repeating job's occurrence id ("<templateId>~<yyyyMMdd>", jobs prefixed "aims:"): its template and day. */
export function occurrenceOf(id: string | null | undefined): { templateId: string; date: string } | null {
  const m = String(id ?? "").replace(/^aims:/, "").match(/^(.+)~(\d{4})(\d{2})(\d{2})$/);
  return m ? { templateId: m[1], date: `${m[2]}-${m[3]}-${m[4]}` } : null;
}

/** An API path naming an occurrence ("/deliveries/<id>~20261118/ptw"): the occurrence id in it, else null. */
export function occurrenceInPath(path: string): string | null {
  const m = String(path).match(/\/([0-9a-f-]{8,}~\d{8})(?=\/|$|\?)/i);
  return m ? m[1] : null;
}

/** "All events" of a note opened on one occurrence: the template's dates, moved by what was changed on the form. */
export function shiftToAnchor(formStart: string, formEnd: string, occurrenceDate: string, anchorDate: string): { startDate: string; endDate: string } {
  const delta = Math.round((dayOf(anchorDate).getTime() - dayOf(occurrenceDate).getTime()) / 86_400_000);
  const add = (s: string) => {
    const d = dayOf(s);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };
  return { startDate: add(formStart), endDate: add(formEnd) };
}

export type RepeatScope = "this" | "following" | "all";
export const SCOPE_LABEL: Record<RepeatScope, string> = { this: "This event", following: "This and following events", all: "All events" };
