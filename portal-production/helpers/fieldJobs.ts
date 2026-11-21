// Field phase 2 (Plan, Working hours): pure helpers for the pages (SiteClock web Roster.tsx / Schedules.tsx @62b7d9d).

export const CLOCKING_LABEL: Record<string, string> = { OFF: "Clock in at the first job, out at the last", ARRIVE: "Clock in at the job", ARRIVE_LEAVE: "Clock in and out at the job" };
export const STATUS_LABEL: Record<string, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", DONE: "Done" };
export const ATTENDANCE_LABEL: Record<string, string> = { CLOCKED_IN: "On the job", DONE: "Done", ON_LEAVE: "On leave", NOT_ARRIVED: "Not arrived" };
export const ROSTER_LABEL: Record<string, string> = { ON_LEAVE: "On leave", ABSENT: "Absent", PRESENT: "Clocked in", LATE: "Late", LEFT_EARLY: "Left early", ON_TIME: "On time" };
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon to Fri", "Mon, Wed, Sat", "Every day". */
export function daysText(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return "Every day";
  const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (run) return `${DAY_NAMES[d[0] - 1]} to ${DAY_NAMES[d[d.length - 1] - 1]}`;
  return d.map((x) => DAY_NAMES[x - 1]).join(", ");
}

/** The Monday of the week holding `date` (yyyy-MM-dd). */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "3 of 4 told" for a crew. */
export function toldText(crew: Array<{ notifiedAt: string | null }>): string {
  if (!crew.length) return "No crew";
  const n = crew.filter((c) => c.notifiedAt).length;
  return n === crew.length ? "All told" : n === 0 ? "Not told" : `${n} of ${crew.length} told`;
}

// ── Phase 3 (Clock-ins) ─────────────────────────────────────────────────────

/** SiteClock's 13 flag reasons (FlagReason) in plain words. */
export const FLAG_LABEL: Record<string, string> = {
  FACE_MISMATCH: "Face does not match",
  VERIFY_REQUESTED: "Asked to verify",
  OUTSIDE_FENCE: "Outside the site",
  MOCKED: "Fake location app",
  ROOTED: "Rooted phone",
  NEW_DEVICE: "New phone",
  OFFLINE: "Sent late (offline)",
  TIME_DRIFT: "Phone clock wrong",
  OUT_WITHOUT_IN: "Clock-out with no clock-in",
  AUTO_CLOSE_OVERRIDE: "Still working after auto-close",
  NOT_ASSIGNED: "Not assigned to this site",
  POOR_ACCURACY: "Poor GPS",
  QR_MISSING: "Job QR not scanned",
};

/** A local "yyyy-MM-ddTHH:mm" for a datetime-local field, from an ISO instant (browser time zone). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The approve body: only the times that were given (a corrected time is sent only when it moved). */
export function approveBody(f: { clockInAt: string; punchAt: string; note: string }, recorded: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.clockInAt) out.clockInAt = new Date(f.clockInAt).toISOString();
  if (f.punchAt && toLocalInput(recorded) !== f.punchAt) out.punchAt = new Date(f.punchAt).toISOString();
  if (f.note.trim()) out.note = f.note.trim().slice(0, 300);
  return out;
}
