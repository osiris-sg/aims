/**
 * Shadow import from SiteClock, leave and payroll slices (FIELD_PLAN.md §5.2): leave types, entitlements,
 * requests (documents stay "siteclock:<path>" until copied), pay profiles, public holidays, and SiteClock's own
 * audit history (read-only, for the Field audit viewer). Same rules as people-plan.ts.
 */
import type { PeoplePlan, Upsert } from './people-plan';
import { scFileKey } from './people-plan';

export interface ScLeavePay {
  leaveTypes: Array<Record<string, any>>;
  entitlements: Array<Record<string, any>>;
  requests: Array<Record<string, any>>;
  payProfiles: Array<Record<string, any>>;
  holidays: Array<Record<string, any>>;
  audit: Array<Record<string, any>>;
  userNames: Map<string, string>;
}

const PROFILE_KEYS = ['payType', 'hourlyRateCents', 'restDays', 'premiumMode', 'premiumRateCents', 'weekdayOt', 'basicMonthlyCents', 'fixedAllowanceCents', 'deductHousingCents', 'deductOtherCents', 'workDaysPerWeek', 'otRateCentsOverride', 'dailyRateCentsOverride'];

export function planLeavePay(sc: ScLeavePay, aims: { workers: Array<{ id: string; siteclockId: string | null }> }, organizationId: string): PeoplePlan {
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
  const ref = (table: string, id: string | null | undefined) => (id ? `new:${table}:${id}` : null);
  const sc$ = (id: string | null | undefined) => (id ? `siteclock:${id}` : null);

  for (const t of sc.leaveTypes) put('fieldLeaveType', t.id, { name: t.name, paid: t.paid, defaultDays: t.defaultDays ?? null, requiresDocument: !!t.requiresDocument, archived: !!t.archived });
  for (const e of sc.entitlements) {
    const w = worker.get(e.userId);
    if (!w) skip('fieldLeaveEntitlement', e.id, 'worker not matched');
    else put('fieldLeaveEntitlement', e.id, { workerId: w, typeId: ref('fieldLeaveType', e.typeId), days: e.days });
  }
  for (const r of sc.requests) {
    const w = worker.get(r.userId);
    if (!w) {
      skip('fieldLeaveRequest', r.id, 'worker not matched');
      continue;
    }
    put('fieldLeaveRequest', r.id, {
      workerId: w, typeId: ref('fieldLeaveType', r.typeId), startDate: r.startDate, endDate: r.endDate, halfDay: !!r.halfDay, reason: r.reason ?? null,
      documentKeys: (r.documentPaths ?? []).map((p: string) => scFileKey(p)), recordedById: sc$(r.recordedById), recordedByName: r.recordedById ? sc.userNames.get(r.recordedById) ?? null : null,
      status: r.status, decidedById: sc$(r.decidedById), decidedByName: r.decidedById ? sc.userNames.get(r.decidedById) ?? null : null, decidedAt: r.decidedAt ?? null, createdAt: r.createdAt,
    });
  }
  for (const p of sc.payProfiles) {
    const w = worker.get(p.userId);
    if (!w) skip('fieldPayProfile', p.id, 'worker not matched');
    else put('fieldPayProfile', p.id, { workerId: w, ...Object.fromEntries(PROFILE_KEYS.map((k) => [k, p[k] ?? null])) });
  }
  for (const h of sc.holidays) put('fieldPublicHoliday', h.id, { date: h.date, name: h.name });
  for (const a of sc.audit) {
    put('fieldAuditImport', a.id, { actorSiteclockId: a.actorId ?? null, actorName: a.actorId ? sc.userNames.get(a.actorId) ?? null : null, action: a.action, entity: a.entity, entityId: a.entityId ?? null, before: a.before ?? null, after: a.after ?? null, createdAt: a.createdAt });
  }
  return { upserts, skipped, counts };
}
