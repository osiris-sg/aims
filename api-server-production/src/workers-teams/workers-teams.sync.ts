/**
 * Workers & Teams: SiteClock -> AIMS sync plan (WCT 2026-11-20, flag enableWorkersTeams). Pure: it takes what SiteClock
 * returned (GET /v1/workers?active=all[&include=phone], GET /v1/teams) and what AIMS holds, and says what a sync would
 * do. The service runs it for the preview (nothing written) and for the apply (the same plan, written).
 *
 * Rules
 *  - Idempotent on the SiteClock id (Worker.siteclockId / WorkerTeam.siteclockId). A SiteClock worker with no AIMS row
 *    first links an AIMS worker added by hand with the same phone, else the same name (one only); else a new row.
 *  - Never overwrite an AIMS edit silently (three-way): siteclockData keeps the values last imported. A field changes
 *    only when AIMS still has the last imported value (SiteClock changed it) or AIMS has nothing; otherwise the
 *    difference is reported and AIMS keeps its value.
 *  - A worker / team missing from SiteClock counts as inactive there (same rule: hidden only if AIMS did not change it).
 *  - Memberships: SiteClock's are added with source "siteclock"; one AIMS removed by hand after an import is not put
 *    back (reported); a "siteclock" membership SiteClock dropped is removed; memberships added by hand are untouched.
 *  - The AIMS login (userId) is filled only when empty: profile link (siteclockUserId), then the SiteClock Clerk id,
 *    then phone (last 8 digits), then the exact name (one member only). A login already linked to another worker is
 *    never reused. SiteClock's /v1 has no email, so email is not used.
 *  - Nothing else from SiteClock is kept: no employee / ID / passport / work-permit numbers.
 * Tested by workers-teams.sync.spec.ts.
 */

export interface ScWorker {
  id: string;
  name: string;
  role?: string | null;
  active: boolean;
  clerkUserId?: string | null;
  phone?: string | null;
  teamIds?: string[];
}
export interface ScTeam {
  id: string;
  name: string;
  members: Array<{ id: string; name?: string }>;
}
export interface AimsWorker {
  id: string;
  name: string;
  phone: string | null;
  role: string | null;
  active: boolean;
  siteclockId: string | null;
  siteclockData: any;
  userId: string | null;
}
export interface AimsTeam {
  id: string;
  name: string;
  active: boolean;
  siteclockId: string | null;
  siteclockData: any;
}
export interface AimsMember {
  teamId: string;
  workerId: string;
  source: string;
}
/** An active member of the org a worker may be (the AIMS login). */
export interface Candidate {
  userId: string;
  name: string | null;
  phones: string[];
  clerkId: string | null;
  siteclockUserId: string | null;
}

export type WorkerField = 'name' | 'phone' | 'role' | 'active';
export interface FieldDiff {
  field: WorkerField | 'teamName' | 'teamActive';
  aims: unknown;
  siteclock: unknown;
}

export interface WorkerPlan {
  siteclockId: string;
  name: string;
  /** create = new row; link = an AIMS worker added by hand gets this SiteClock id; update / same = already linked. */
  action: 'create' | 'link' | 'update' | 'same';
  aimsId: string | null;
  data: { name: string; phone: string | null; role: string | null; active: boolean };
  changes: Partial<Record<WorkerField, { from: unknown; to: unknown }>>;
  differences: FieldDiff[];
  snapshot: { name: string; phone?: string | null; role: string | null; active: boolean };
  user: { userId: string; name: string | null; by: 'profile' | 'clerk' | 'phone' | 'name' } | null;
  /** The worker's AIMS login stays empty: why (no match, or the match is taken). */
  userNote: string | null;
}
export interface TeamPlan {
  siteclockId: string;
  name: string;
  action: 'create' | 'update' | 'same' | 'hide';
  aimsId: string | null;
  changes: { name?: { from: string; to: string }; active?: { from: boolean; to: boolean } };
  differences: FieldDiff[];
  snapshot: { name: string; memberIds: string[]; active: boolean };
}
export interface MemberPlan {
  team: string;
  teamSiteclockId: string;
  worker: string;
  workerSiteclockId: string;
}
export interface SyncPlan {
  source: { workers: number; activeWorkers: number; teams: number; memberships: number; phones: boolean };
  workers: WorkerPlan[];
  teams: TeamPlan[];
  memberships: { add: MemberPlan[]; remove: MemberPlan[]; keptRemoved: MemberPlan[] };
  counts: {
    workersCreate: number;
    workersLink: number;
    workersUpdate: number;
    workersSame: number;
    workersHidden: number;
    differences: number;
    teamsCreate: number;
    teamsUpdate: number;
    teamsHide: number;
    membershipsAdd: number;
    membershipsRemove: number;
    loginsMatched: number;
    loginsUnmatched: number;
  };
}

export const digits = (v: unknown): string => String(v ?? '').replace(/\D+/g, '');
/** Phones compare on their last 8 digits (SG numbers with or without +65). */
export const samePhone = (a: unknown, b: unknown): boolean => {
  const x = digits(a);
  const y = digits(b);
  return x.length >= 8 && y.length >= 8 && x.slice(-8) === y.slice(-8);
};
const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};
const eq = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const empty = (v: unknown) => v === null || v === undefined || v === '';

/** One field, three ways: what AIMS should hold after the sync, or a reported difference. */
function threeWay<T>(aims: T, last: T | undefined, sc: T, same: (a: unknown, b: unknown) => boolean = eq): { set?: T; diff?: boolean } {
  if (same(aims, sc)) return {};
  if (last !== undefined && same(aims, last)) return { set: sc };
  if (last === undefined && empty(aims)) return { set: sc };
  return { diff: true };
}

export function matchLogin(w: ScWorker, candidates: Candidate[], taken: Set<string>): { pick: Candidate; by: 'profile' | 'clerk' | 'phone' | 'name' } | { none: string } {
  const free = (c: Candidate) => !taken.has(c.userId);
  const tries: Array<['profile' | 'clerk' | 'phone' | 'name', Candidate[]]> = [
    ['profile', candidates.filter((c) => c.siteclockUserId && c.siteclockUserId === w.id)],
    ['clerk', w.clerkUserId ? candidates.filter((c) => c.clerkId && c.clerkId === w.clerkUserId) : []],
    ['phone', w.phone ? candidates.filter((c) => c.phones.some((p) => samePhone(p, w.phone))) : []],
    ['name', candidates.filter((c) => c.name && norm(c.name) === norm(w.name))],
  ];
  let takenHit = false;
  for (const [by, list] of tries) {
    const ids = [...new Set(list.map((c) => c.userId))];
    if (ids.length !== 1) continue;
    const c = list[0];
    if (!free(c)) {
      takenHit = true;
      continue;
    }
    return { pick: c, by };
  }
  return { none: takenHit ? 'Its AIMS login is already linked to another worker' : 'No AIMS login matches' };
}

export function planSync(input: {
  scWorkers: ScWorker[];
  scTeams: ScTeam[];
  /** The key may read phones (workers:phone scope). Without it, phone is left as it is. */
  phones: boolean;
  workers: AimsWorker[];
  teams: AimsTeam[];
  members: AimsMember[];
  candidates: Candidate[];
}): SyncPlan {
  const { scWorkers, scTeams, phones } = input;
  const byScId = new Map(input.workers.filter((w) => w.siteclockId).map((w) => [w.siteclockId as string, w]));
  const unlinked = input.workers.filter((w) => !w.siteclockId);
  const usedUnlinked = new Set<string>();
  const taken = new Set(input.workers.map((w) => w.userId).filter(Boolean) as string[]);
  const plans: WorkerPlan[] = [];

  for (const sw of scWorkers) {
    const name = clean(sw.name, 120) ?? 'Unnamed';
    const role = clean(sw.role, 60);
    const phone = phones ? clean(sw.phone, 40) : undefined;
    const sc = { name, role, active: sw.active !== false, ...(phones ? { phone: phone ?? null } : {}) };
    let row = byScId.get(sw.id) ?? null;
    let action: WorkerPlan['action'] = row ? 'same' : 'create';
    if (!row) {
      // An AIMS worker added by hand: same phone, else the same name (exactly one, not yet used).
      const byPhone = phone ? unlinked.filter((w) => !usedUnlinked.has(w.id) && samePhone(w.phone, phone)) : [];
      const byName = unlinked.filter((w) => !usedUnlinked.has(w.id) && norm(w.name) === norm(name));
      const hit = byPhone.length === 1 ? byPhone[0] : byName.length === 1 ? byName[0] : null;
      if (hit) {
        row = hit;
        action = 'link';
        usedUnlinked.add(hit.id);
      }
    }
    const changes: WorkerPlan['changes'] = {};
    const differences: FieldDiff[] = [];
    const data = { name, phone: phone ?? null, role, active: sc.active };
    if (row) {
      const last: any = action === 'link' ? {} : row.siteclockData && typeof row.siteclockData === 'object' ? row.siteclockData : {};
      const fields: WorkerField[] = phones ? ['name', 'phone', 'role', 'active'] : ['name', 'role', 'active'];
      for (const f of fields) {
        const aimsVal = (row as any)[f];
        const scVal = (sc as any)[f];
        // Phones compare on their digits (+65 9123 4567 = 91234567).
        const r = threeWay(aimsVal, f in last ? last[f] : undefined, scVal, f === 'phone' ? (a, b) => eq(a, b) || samePhone(a, b) : eq);
        if (r.diff) differences.push({ field: f, aims: aimsVal, siteclock: scVal });
        else if ('set' in r) changes[f] = { from: aimsVal, to: r.set };
      }
      (data as any).name = row.name;
      (data as any).phone = row.phone;
      (data as any).role = row.role;
      (data as any).active = row.active;
      for (const [f, ch] of Object.entries(changes)) (data as any)[f] = (ch as any).to;
      if (action === 'same' && Object.keys(changes).length) action = 'update';
    }
    // The AIMS login: only filled when empty.
    let user: WorkerPlan['user'] = null;
    let userNote: string | null = null;
    if (!row?.userId) {
      const m = matchLogin({ ...sw, phone: sw.phone ?? null }, input.candidates, taken);
      if ('pick' in m) {
        user = { userId: m.pick.userId, name: m.pick.name, by: m.by };
        taken.add(m.pick.userId);
        if (action === 'same') action = 'update';
      } else userNote = m.none;
    }
    plans.push({ siteclockId: sw.id, name, action, aimsId: row?.id ?? null, data, changes, differences, snapshot: sc as any, user, userNote });
  }

  // Linked AIMS workers SiteClock no longer lists: inactive there.
  const seen = new Set(scWorkers.map((w) => w.id));
  for (const w of input.workers) {
    if (!w.siteclockId || seen.has(w.siteclockId)) continue;
    const last: any = w.siteclockData && typeof w.siteclockData === 'object' ? w.siteclockData : {};
    const r = threeWay(w.active, 'active' in last ? last.active : undefined, false);
    const changes: WorkerPlan['changes'] = {};
    const differences: FieldDiff[] = [];
    if (r.diff) differences.push({ field: 'active', aims: w.active, siteclock: false });
    else if ('set' in r) changes.active = { from: w.active, to: false };
    plans.push({
      siteclockId: w.siteclockId,
      name: w.name,
      action: Object.keys(changes).length ? 'update' : 'same',
      aimsId: w.id,
      data: { name: w.name, phone: w.phone, role: w.role, active: changes.active ? false : w.active },
      changes,
      differences,
      snapshot: { ...last, name: last.name ?? w.name, role: last.role ?? w.role, active: false },
      user: null,
      userNote: null,
    });
  }

  // Teams.
  const teamByScId = new Map(input.teams.filter((t) => t.siteclockId).map((t) => [t.siteclockId as string, t]));
  const teamPlans: TeamPlan[] = [];
  for (const st of scTeams) {
    const name = clean(st.name, 120) ?? 'Team';
    const memberIds = [...new Set((st.members ?? []).map((m) => m.id))];
    const row = teamByScId.get(st.id) ?? null;
    const changes: TeamPlan['changes'] = {};
    const differences: FieldDiff[] = [];
    if (row) {
      const last: any = row.siteclockData && typeof row.siteclockData === 'object' ? row.siteclockData : {};
      const n = threeWay(row.name, 'name' in last ? last.name : undefined, name);
      if (n.diff) differences.push({ field: 'teamName', aims: row.name, siteclock: name });
      else if ('set' in n) changes.name = { from: row.name, to: name };
      const a = threeWay(row.active, 'active' in last ? last.active : undefined, true);
      if (a.diff) differences.push({ field: 'teamActive', aims: row.active, siteclock: true });
      else if ('set' in a) changes.active = { from: row.active, to: true };
    }
    teamPlans.push({ siteclockId: st.id, name, action: !row ? 'create' : Object.keys(changes).length ? 'update' : 'same', aimsId: row?.id ?? null, changes, differences, snapshot: { name, memberIds, active: true } });
  }
  const seenTeams = new Set(scTeams.map((t) => t.id));
  for (const t of input.teams) {
    if (!t.siteclockId || seenTeams.has(t.siteclockId)) continue;
    const last: any = t.siteclockData && typeof t.siteclockData === 'object' ? t.siteclockData : {};
    const a = threeWay(t.active, 'active' in last ? last.active : undefined, false);
    const differences: FieldDiff[] = a.diff ? [{ field: 'teamActive', aims: t.active, siteclock: false }] : [];
    const hide = 'set' in a;
    teamPlans.push({
      siteclockId: t.siteclockId,
      name: t.name,
      action: hide ? 'hide' : 'same',
      aimsId: t.id,
      changes: hide ? { active: { from: t.active, to: false } } : {},
      differences,
      snapshot: { name: last.name ?? t.name, memberIds: [], active: false },
    });
  }

  // Memberships (only for workers / teams that exist or will exist after this sync).
  const workerAimsByScId = new Map(plans.map((p) => [p.siteclockId, p.aimsId]));
  const workerNameByScId = new Map(plans.map((p) => [p.siteclockId, p.data.name]));
  const scIdByAimsWorker = new Map(input.workers.filter((w) => w.siteclockId).map((w) => [w.id, w.siteclockId as string]));
  for (const p of plans) if (p.action === 'link' && p.aimsId) scIdByAimsWorker.set(p.aimsId, p.siteclockId);
  const add: MemberPlan[] = [];
  const remove: MemberPlan[] = [];
  const keptRemoved: MemberPlan[] = [];
  for (const tp of teamPlans) {
    const row = tp.aimsId ? input.teams.find((t) => t.id === tp.aimsId) ?? null : null;
    const lastIds: string[] = Array.isArray(row?.siteclockData?.memberIds) ? row!.siteclockData.memberIds : [];
    const current = input.members.filter((m) => row && m.teamId === row.id);
    const currentScIds = new Set(current.map((m) => scIdByAimsWorker.get(m.workerId)).filter(Boolean) as string[]);
    const st = scTeams.find((t) => t.id === tp.siteclockId);
    const want = new Set(st ? tp.snapshot.memberIds : []);
    for (const wid of want) {
      if (!workerAimsByScId.has(wid)) continue; // not a worker SiteClock listed
      if (currentScIds.has(wid)) continue;
      const mp = { team: tp.name, teamSiteclockId: tp.siteclockId, worker: workerNameByScId.get(wid) ?? wid, workerSiteclockId: wid };
      if (row && lastIds.includes(wid)) keptRemoved.push(mp);
      else add.push(mp);
    }
    for (const m of current) {
      const wid = scIdByAimsWorker.get(m.workerId);
      if (!wid || m.source !== 'siteclock' || want.has(wid)) continue;
      remove.push({ team: tp.name, teamSiteclockId: tp.siteclockId, worker: workerNameByScId.get(wid) ?? wid, workerSiteclockId: wid });
    }
  }

  const all = plans;
  return {
    source: {
      workers: scWorkers.length,
      activeWorkers: scWorkers.filter((w) => w.active !== false).length,
      teams: scTeams.length,
      memberships: scTeams.reduce((t, s) => t + new Set((s.members ?? []).map((m) => m.id)).size, 0),
      phones,
    },
    workers: all,
    teams: teamPlans,
    memberships: { add, remove, keptRemoved },
    counts: {
      workersCreate: all.filter((p) => p.action === 'create').length,
      workersLink: all.filter((p) => p.action === 'link').length,
      workersUpdate: all.filter((p) => p.action === 'update').length,
      workersSame: all.filter((p) => p.action === 'same').length,
      workersHidden: all.filter((p) => p.changes.active?.to === false).length,
      differences: all.reduce((t, p) => t + p.differences.length, 0) + teamPlans.reduce((t, p) => t + p.differences.length, 0) + keptRemoved.length,
      teamsCreate: teamPlans.filter((t) => t.action === 'create').length,
      teamsUpdate: teamPlans.filter((t) => t.action === 'update').length,
      teamsHide: teamPlans.filter((t) => t.action === 'hide').length,
      membershipsAdd: add.length,
      membershipsRemove: remove.length,
      loginsMatched: all.filter((p) => p.user).length,
      loginsUnmatched: all.filter((p) => !p.user && p.userNote && p.snapshot.active).length,
    },
  };
}
