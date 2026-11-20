import { isOrgFeatureEnabled } from '../common/org-features';
import type { CrewPick } from '../deliveries/job-style';

/** Same flag as workers-teams.service (kept here so the deliveries module does not load that service). */
const WORKERS_TEAMS_FLAG = 'enableWorkersTeams';

/**
 * Round 39 B4 (Workers & Teams, WCT (S)): a job's picked teams / workers checked against the org's own tables,
 * each with its current name; unknown ids (or another org's) are dropped. Orgs without Workers & Teams: none kept.
 */
export async function resolveCrew(prisma: any, organizationId: string, picks: CrewPick[]): Promise<CrewPick[]> {
  if (!picks.length) return [];
  if (!(await isOrgFeatureEnabled(prisma, organizationId, WORKERS_TEAMS_FLAG))) return [];
  const teamIds = picks.filter((p) => p.kind === 'team').map((p) => p.id);
  const workerIds = picks.filter((p) => p.kind === 'worker').map((p) => p.id);
  const [teams, workers] = await Promise.all([
    teamIds.length ? prisma.workerTeam.findMany({ where: { organizationId, id: { in: teamIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    workerIds.length ? prisma.worker.findMany({ where: { organizationId, id: { in: workerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const name = new Map<string, string>([...(teams as any[]).map((t) => [`team:${t.id}`, t.name] as const), ...(workers as any[]).map((w) => [`worker:${w.id}`, w.name] as const)]);
  return picks.filter((p) => name.has(`${p.kind}:${p.id}`)).map((p) => ({ ...p, name: name.get(`${p.kind}:${p.id}`)! }));
}

/** The current names of the picks stored on jobs (a renamed team shows its new name); picks no longer found keep theirs. */
export async function currentCrewNames(prisma: any, organizationId: string, all: CrewPick[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!all.length) return out;
  try {
    const teamIds = [...new Set(all.filter((p) => p.kind === 'team').map((p) => p.id))];
    const workerIds = [...new Set(all.filter((p) => p.kind === 'worker').map((p) => p.id))];
    const [teams, workers] = await Promise.all([
      teamIds.length ? prisma.workerTeam.findMany({ where: { organizationId, id: { in: teamIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      workerIds.length ? prisma.worker.findMany({ where: { organizationId, id: { in: workerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    for (const t of teams as any[]) out.set(`team:${t.id}`, t.name);
    for (const w of workers as any[]) out.set(`worker:${w.id}`, w.name);
  } catch {
    // Names as stored on the jobs.
  }
  return out;
}
