/**
 * Shadow import from SiteClock, jobs slice (FIELD_PLAN.md §5.2): jobs (SiteClock-made ones and the AIMS-pushed
 * "external" ones, both as history without a calendar job), crews, needs, day notes, shift templates and
 * assignments, manning presets. Same rules as people-plan.ts: Field* tables only, keyed by siteclockId,
 * people matched through Worker.siteclockId, never created.
 */
import type { PeoplePlan, Upsert } from './people-plan';

export interface ScJobs {
  jobs: Array<Record<string, any>>;
  crews: Array<{ id: string; jobId: string; userId: string; teamId: string | null; tradeId: string | null; notifiedAt: Date | null }>;
  needs: Array<{ id: string; jobId: string; tradeId: string; qty: number }>;
  dayNotes: Array<{ id: string; date: string; text: string }>;
  templates: Array<Record<string, any>>;
  assignments: Array<{ id: string; templateId: string; userId: string; startDate: string; endDate: string | null }>;
  presets: Array<{ id: string; name: string; items: Array<{ tradeId: string; qty: number }> }>;
}

export function planJobs(sc: ScJobs, aims: { workers: Array<{ id: string; siteclockId: string | null }>; teams: Array<{ id: string; siteclockId: string | null }> }, organizationId: string): PeoplePlan {
  const upserts: Upsert[] = [];
  const skipped: PeoplePlan['skipped'] = [];
  const counts: PeoplePlan['counts'] = {};
  const bump = (t: string, k: 'source' | 'upsert' | 'skipped') => ((counts[t] = counts[t] ?? { source: 0, upsert: 0, skipped: 0 }), counts[t][k]++);
  const put = (table: string, siteclockId: string, data: Record<string, unknown>) => {
    bump(table, 'source');
    bump(table, 'upsert');
    upserts.push({ table, siteclockId, data: { organizationId, siteclockId, ...data } });
  };
  const skip = (table: string, siteclockId: string, reason: string) => {
    bump(table, 'source');
    bump(table, 'skipped');
    skipped.push({ table, siteclockId, reason });
  };
  const worker = new Map(aims.workers.filter((w) => w.siteclockId).map((w) => [w.siteclockId as string, w.id]));
  const team = new Map(aims.teams.filter((t) => t.siteclockId).map((t) => [t.siteclockId as string, t.id]));
  const ref = (table: string, id: string | null | undefined) => (id ? `new:${table}:${id}` : null);

  for (const t of sc.templates) {
    put('fieldShiftTemplate', t.id, {
      name: t.name, startTime: t.startTime, endTime: t.endTime, daysOfWeek: t.daysOfWeek, graceLateMin: t.graceLateMin, payEarly: t.payEarly ?? null,
      earlyMode: t.earlyMode ?? null, active: t.active, siteId: ref('fieldSite', t.siteId), siteIds: (t.siteIds ?? []).map((s: string) => ref('fieldSite', s)),
    });
  }
  for (const a of sc.assignments) {
    const w = worker.get(a.userId);
    if (!w) skip('fieldShiftAssignment', a.id, 'worker not matched');
    else put('fieldShiftAssignment', a.id, { templateId: ref('fieldShiftTemplate', a.templateId), workerId: w, startDate: a.startDate, endDate: a.endDate });
  }
  for (const p of sc.presets) put('fieldManningPreset', p.id, { name: p.name, items: p.items.map((i) => ({ tradeId: ref('fieldTrade', i.tradeId), qty: i.qty })) });
  for (const n of sc.dayNotes) put('fieldDayNote', n.id, { date: n.date, text: n.text });
  for (const j of sc.jobs) {
    put('fieldJob', j.id, {
      source: j.externalSource ? 'siteclock-external' : 'siteclock',
      date: j.date, startTime: j.startTime ?? null, allDay: !!j.allDay, title: j.title, location: j.location, siteId: ref('fieldSite', j.siteId),
      description: j.description ?? null, instructions: j.instructions ?? null,
      teamIds: (j.teamIds ?? []).map((t: string) => team.get(t)).filter(Boolean),
      exceptWorkerIds: (j.exceptUserIds ?? []).map((u: string) => worker.get(u)).filter(Boolean),
      expectedMinutes: j.expectedMinutes ?? null, clocking: j.clocking ?? null, qrRequired: !!j.qrRequired, qrToken: j.qrToken ?? null,
      createdById: j.createdById ? `siteclock:${j.createdById}` : null, externalRef: j.externalRef ?? null, startAt: j.startAt ?? null, endAt: j.endAt ?? null,
      timezone: j.timezone ?? null, status: j.status ?? null, startedAt: j.startedAt ?? null, completedAt: j.completedAt ?? null,
      cancelledAt: j.cancelledAt ?? null, cancelReason: j.cancelReason ?? null, createdAt: j.createdAt,
    });
  }
  for (const c of sc.crews) {
    const w = worker.get(c.userId);
    if (!w) skip('fieldJobCrew', c.id, 'worker not matched (a shared worker from a linked company?)');
    else put('fieldJobCrew', c.id, { jobId: ref('fieldJob', c.jobId), workerId: w, teamId: c.teamId ? team.get(c.teamId) ?? null : null, tradeId: ref('fieldTrade', c.tradeId), notifiedAt: c.notifiedAt });
  }
  for (const n of sc.needs) put('fieldJobNeed', n.id, { jobId: ref('fieldJob', n.jobId), tradeId: ref('fieldTrade', n.tradeId), qty: n.qty });
  return { upserts, skipped, counts };
}
