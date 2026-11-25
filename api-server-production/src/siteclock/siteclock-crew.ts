/**
 * Crew sync (enableSiteClockCrewSync, 2026-11-25): who a job's picked teams and workers are in SiteClock.
 *
 * Matching is by id, never by name: Worker.siteclockId / WorkerTeam.siteclockId, filled by Settings > Workers & Teams >
 * Sync from SiteClock. A team pick gives its CURRENT active members in AIMS (AIMS's member list decides) and, as a
 * label, the team's own SiteClock id. A pick with no SiteClock id (added by hand, not in SiteClock) cannot be sent:
 * it is returned in `unsent` and stays a name in the job's notes.
 *
 * Pure on the caller's Prisma (run it inside runAsOrg). Tested by siteclock-crew.spec.ts.
 */
import type { CrewPick } from '../deliveries/job-style';

export interface CrewForSiteClock {
  /** SiteClock worker ids, in pick order (a team's members by name), no repeats. */
  ids: string[];
  /** SiteClock ids of the teams picked. */
  teamIds: string[];
  /** SiteClock worker id -> the name AIMS shows. */
  names: Map<string, string>;
  /** Names of picked people that are not in SiteClock. */
  unsent: string[];
}

export async function crewSiteClockIds(
  prisma: any,
  organizationId: string,
  picks: CrewPick[],
  /** Extra SiteClock workers already stored on the job by SiteClock id (Delivery.crewWorkers). */
  extra: Array<{ id: string; name: string }> = [],
): Promise<CrewForSiteClock> {
  const out: CrewForSiteClock = { ids: [], teamIds: [], names: new Map(), unsent: [] };
  const add = (w: { name: string; siteclockId: string | null; active?: boolean }) => {
    if (w.active === false) return;
    if (!w.siteclockId) {
      if (!out.unsent.includes(w.name)) out.unsent.push(w.name);
      return;
    }
    if (!out.names.has(w.siteclockId)) {
      out.ids.push(w.siteclockId);
      out.names.set(w.siteclockId, w.name);
    }
  };
  const teamIds = picks.filter((p) => p.kind === 'team').map((p) => p.id);
  const workerIds = picks.filter((p) => p.kind === 'worker').map((p) => p.id);
  const [teams, workers] = await Promise.all([
    teamIds.length
      ? prisma.workerTeam.findMany({
          where: { organizationId, id: { in: teamIds }, active: true },
          select: { id: true, siteclockId: true, members: { select: { worker: { select: { name: true, siteclockId: true, active: true } } } } },
        })
      : Promise.resolve([]),
    workerIds.length ? prisma.worker.findMany({ where: { organizationId, id: { in: workerIds } }, select: { id: true, name: true, siteclockId: true, active: true } }) : Promise.resolve([]),
  ]);
  const teamById = new Map<string, any>((teams as any[]).map((t) => [t.id, t]));
  const workerById = new Map<string, any>((workers as any[]).map((w) => [w.id, w]));
  for (const p of picks) {
    if (p.kind === 'team') {
      const t = teamById.get(p.id);
      if (!t) continue;
      if (t.siteclockId && !out.teamIds.includes(t.siteclockId)) out.teamIds.push(t.siteclockId);
      const members = (t.members as any[]).map((m) => m.worker).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      for (const w of members) add(w);
    } else {
      const w = workerById.get(p.id);
      if (w) add(w);
    }
  }
  for (const e of extra) add({ name: e.name, siteclockId: e.id });
  return out;
}
