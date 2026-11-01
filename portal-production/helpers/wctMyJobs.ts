// WCT worker logins (2026-11-01, flag enableWctMyJobs). Pure helpers for the
// field app's Pending tab ("My jobs" / All) and the "planned for someone else"
// check; tested by helpers/wctMyJobs.test.mjs.

export type JobsScope = "mine" | "all";

export interface PlannedRider {
  userId: string | null;
  name: string | null;
  isMe: boolean;
}

/** "My jobs" = the jobs planned for the signed-in user; All = every scheduled job. */
export function scopeJobs<T extends { plannedRider?: PlannedRider | null }>(runs: T[], scope: JobsScope): T[] {
  return scope === "mine" ? runs.filter((r) => r.plannedRider?.isMe === true) : runs;
}

/** The question to ask before starting a job planned for someone else, or null to start straight away. */
export function startConfirmText(run: { plannedRider?: PlannedRider | null }): string | null {
  const p = run.plannedRider;
  if (!p || p.isMe || !p.userId) return null;
  return `This job is planned for ${p.name || "another worker"}. Start it anyway?`;
}

/** The small "Planned for …" line on a job card (null when nobody is planned). */
export function plannedLine(run: { plannedRider?: PlannedRider | null }): string | null {
  const p = run.plannedRider;
  if (!p || (!p.name && !p.isMe)) return null;
  return p.isMe ? "Your job" : `Planned for ${p.name}`;
}
