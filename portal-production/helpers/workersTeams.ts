// Workers & Teams (WCT 2026-11-20, enableWorkersTeams): Settings > Workers & Teams. Pure helpers for the page and the
// SiteClock sync dialog (api src/workers-teams). Tested by helpers/workersTeams.test.mjs.

export interface WtWorker {
  id: string;
  name: string;
  phone: string | null;
  role: string | null;
  active: boolean;
  siteclockId: string | null;
  userId: string | null;
  userName: string | null;
  teamIds: string[];
}
export interface WtTeam {
  id: string;
  name: string;
  active: boolean;
  siteclockId: string | null;
  workerIds: string[];
}

/** Active first, then by name (hidden rows go last). */
export function sortRows<T extends { active: boolean; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** A worker's team names, comma separated (hidden teams left out). */
export function teamNames(worker: Pick<WtWorker, "teamIds">, teams: WtTeam[]): string {
  return teams
    .filter((t) => t.active && worker.teamIds.includes(t.id))
    .map((t) => t.name)
    .join(", ");
}

/** The team dialog's member picks against the team's current members: what to add and remove. */
export function memberChanges(current: string[], picked: string[]): { add: string[]; remove: string[] } {
  return { add: picked.filter((id) => !current.includes(id)), remove: current.filter((id) => !picked.includes(id)) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The sync dialog's summary lines (preview or applied), counts only. */
export function syncSummary(r: any): string[] {
  if (!r?.counts || !r?.source) return [];
  const c = r.counts;
  const s = r.source;
  const lines = [
    `SiteClock: ${plural(s.workers, "worker")} (${s.activeWorkers} active), ${plural(s.teams, "team")}, ${plural(s.memberships, "membership")}${s.phones ? "" : ", no phone numbers (the key may not read them)"}`,
    `Workers: ${c.workersCreate} new, ${c.workersLink} linked to one added by hand, ${c.workersUpdate} updated, ${c.workersHidden} hidden, ${c.workersSame} unchanged`,
    `Teams: ${c.teamsCreate} new, ${c.teamsUpdate} updated, ${c.teamsHide} hidden`,
    `Memberships: ${c.membershipsAdd} added, ${c.membershipsRemove} removed`,
    `AIMS logins: ${c.loginsMatched} matched, ${c.loginsUnmatched} without a login`,
  ];
  if (c.differences) lines.push(`${plural(c.differences, "difference")} kept as they are in AIMS`);
  return lines;
}

/** The differences the sync keeps (AIMS value kept), one line each. */
export function syncDifferences(r: any): string[] {
  const label: Record<string, string> = { name: "name", phone: "phone", role: "role", active: "status", teamName: "team name", teamActive: "team status" };
  const show = (v: unknown) => (v === true ? "active" : v === false ? "hidden" : v === null || v === undefined || v === "" ? "empty" : String(v));
  const out: string[] = [];
  for (const w of r?.workers ?? []) for (const d of w.differences ?? []) out.push(`${w.data?.name ?? w.name}: ${label[d.field] ?? d.field} is ${show(d.aims)} in AIMS, ${show(d.siteclock)} in SiteClock`);
  for (const t of r?.teams ?? []) for (const d of t.differences ?? []) out.push(`${t.name}: ${label[d.field] ?? d.field} is ${show(d.aims)} in AIMS, ${show(d.siteclock)} in SiteClock`);
  for (const m of r?.memberships?.keptRemoved ?? []) out.push(`${m.worker} stays out of ${m.team} (removed in AIMS)`);
  return out;
}

/** Active SiteClock workers the sync could not match to an AIMS login. */
export function unmatchedLogins(r: any): string[] {
  return (r?.workers ?? []).filter((w: any) => !w.user && w.userNote && w.snapshot?.active !== false).map((w: any) => `${w.data?.name ?? w.name}: ${w.userNote}`);
}
