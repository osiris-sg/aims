// Round AY part 2 — the order page's Overall process: cell text and the schedule line. Pure helpers.

export type DueCellLike = { state: "done" | "current" | "upcoming" | "overdue" | "na"; doneAt: string | null; due: string | null; daysLate: number | null; dueSource: "manual" | "rule" | null; ongoing?: boolean };
export type ScheduleLike = { etd: string | null; tsPort: string | null; tsEta: string | null; tsEtd: string | null; eta: string | null; arrived: string | null; deliveries: string[] };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-05" → "5 Oct" (the year only when it isn't this year's). */
export function shortDay(ymd: string | null | undefined, thisYear?: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${Number(d)} ${MON[Number(m) - 1]}${thisYear && y !== thisYear ? ` ${y}` : ""}`;
}

const L = {
  en: { done: "Done", now: "Now", due: "due", overdue: (n: number) => `${n}d overdue`, noDate: "no date yet", ongoing: "ongoing" },
  ja: { done: "完了", now: "対応中", due: "期限", overdue: (n: number) => `${n}日超過`, noDate: "日付未定", ongoing: "随時" },
};

/** What a cell shows: a headline, the date line and its colour. */
export function cellView(c: DueCellLike, lang: "en" | "ja", thisYear?: string): { head: string; sub: string; tone: "success" | "error" | "primary" | "default" } {
  const t = L[lang];
  if (c.state === "done") return { head: `✓ ${t.done}`, sub: shortDay(c.doneAt, thisYear), tone: "success" };
  if (c.ongoing) return { head: "", sub: t.ongoing, tone: "default" };
  const due = c.due ? `${t.due} ${shortDay(c.due, thisYear)}` : t.noDate;
  if (c.state === "overdue") return { head: t.overdue(c.daysLate ?? 0), sub: due, tone: "error" };
  if (c.state === "current") return { head: t.now, sub: due, tone: "primary" };
  return { head: "", sub: due, tone: "default" };
}

/** The schedule on one line: "ETD 12 Sep · T/S Singapore 20 → 22 Sep · ETA 5 Oct · Arrived 6 Oct · Delivery 10, 12 Oct". */
export function scheduleParts(s: ScheduleLike | null, lang: "en" | "ja", thisYear?: string): string[] {
  if (!s) return [];
  const ja = lang === "ja";
  const d = (x: string | null) => shortDay(x, thisYear);
  const ts = s.tsPort || s.tsEta || s.tsEtd ? `${ja ? "T/S" : "T/S"}${s.tsPort ? ` ${s.tsPort}` : ""} ${[d(s.tsEta), d(s.tsEtd)].filter(Boolean).join(" → ")}`.trim() : "";
  const dates = (s.deliveries ?? []).map((x) => (/^\d{4}-\d{2}-\d{2}/.test(x) ? d(x) : x));
  return [
    s.etd ? `ETD ${d(s.etd)}` : ja ? "ETD 未定" : "ETD —",
    ts,
    s.eta ? `ETA ${d(s.eta)}` : ja ? "ETA 未定" : "ETA —",
    s.arrived ? `${ja ? "到着" : "Arrived"} ${d(s.arrived)}` : "",
    dates.length ? `${ja ? "納入" : "Delivery"} ${dates.join(", ")}` : "",
  ].filter(Boolean);
}
