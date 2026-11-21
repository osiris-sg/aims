/**
 * Shadow import from SiteClock, attendance slice (FIELD_PLAN.md §5.2): OT and break rules, time entries (every
 * status, with SiteClock's computed numbers kept as they are: the parity run recomputes and compares), punches.
 * Same rules as people-plan.ts. Selfies stay "siteclock:<path>" until the files are copied. workedFor company ids
 * become AIMS org ids through the orgs' FieldSettings.siteclockCompanyId (unknown ones are kept as "siteclock:<id>").
 */
import type { PeoplePlan, Upsert } from './people-plan';
import { scFileKey } from './people-plan';

export interface ScAttendance {
  overtimeRules: Array<Record<string, any>>;
  breakRules: Array<Record<string, any>>;
  entries: Array<Record<string, any>>;
  punches: Array<Record<string, any>>;
}

const ENTRY_KEEP = [
  'workDate', 'clockInAt', 'clockOutAt', 'status', 'grossMinutes', 'breakMinutes', 'nlbClaimed', 'nlb', 'regularMinutes', 'otMinutes', 'otMultiplier',
  'lateMinutes', 'earlyMinutes', 'leftEarlyMinutes', 'editedAt', 'editNote', 'origClockInAt', 'origClockOutAt', 'approvedAt', 'paidFromAt', 'paidToAt',
  'crewFirstInAt', 'crewLastOutAt', 'needsReview', 'crewNote', 'createdAt',
];
const PUNCH_KEEP = [
  'type', 'serverTime', 'originalTime', 'deviceTime', 'lat', 'lng', 'accuracyM', 'distanceM', 'insideFence', 'address', 'faceScore', 'faceResult', 'mockedFlag',
  'rootedFlag', 'offlineSynced', 'deviceId', 'idempotencyKey', 'workerNote', 'nlbClaimed', 'reviewNote', 'status', 'flagReason', 'reviewedAt', 'endsDay',
  'qrScanned', 'autoLeft', 'createdAt',
];

export function planAttendance(
  sc: ScAttendance,
  aims: { workers: Array<{ id: string; siteclockId: string | null }>; orgOfCompany: Map<string, string> },
  organizationId: string,
): PeoplePlan {
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
  const pick = (row: Record<string, any>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
  const sc$ = (id: string | null | undefined) => (id ? `siteclock:${id}` : null);

  for (const r of sc.overtimeRules)
    put('fieldOvertimeRule', r.id, { siteId: ref('fieldSite', r.siteId), dailyThresholdMin: r.dailyThresholdMin, otMultiplier: r.otMultiplier, weeklyCapOtMin: r.weeklyCapOtMin ?? null, countEarlyAsWork: !!r.countEarlyAsWork, earlyMode: r.earlyMode ?? null });
  for (const r of sc.breakRules) put('fieldBreakRule', r.id, { siteId: ref('fieldSite', r.siteId), deductMinutes: r.deductMinutes, minShiftMinutes: r.minShiftMinutes, nlbCreditMinutes: r.nlbCreditMinutes });

  for (const e of sc.entries) {
    const w = worker.get(e.userId);
    if (!w) {
      skip('fieldTimeEntry', e.id, 'worker not matched');
      continue;
    }
    const workedFor = e.workedFor && typeof e.workedFor === 'object'
      ? Object.fromEntries(Object.entries(e.workedFor as Record<string, number>).map(([co, min]) => [aims.orgOfCompany.get(co) ?? `siteclock:${co}`, min]))
      : null;
    put('fieldTimeEntry', e.id, {
      ...pick(e, ENTRY_KEEP),
      workerId: w,
      siteId: ref('fieldSite', e.siteId),
      clockOutSiteId: ref('fieldSite', e.clockOutSiteId),
      shiftAssignmentId: ref('fieldShiftAssignment', e.shiftAssignmentId),
      editedById: sc$(e.editedById),
      approvedById: sc$(e.approvedById),
      workedFor,
    });
  }
  for (const p of sc.punches) {
    const w = worker.get(p.userId);
    if (!w) {
      skip('fieldPunch', p.id, 'worker not matched');
      continue;
    }
    put('fieldPunch', p.id, {
      ...pick(p, PUNCH_KEEP),
      workerId: w,
      siteId: ref('fieldSite', p.siteId),
      jobId: ref('fieldJob', p.jobId),
      timeEntryId: ref('fieldTimeEntry', p.timeEntryId),
      photoKey: scFileKey(p.photoPath),
      reviewedById: sc$(p.reviewedById),
      recordedByWorkerId: p.recordedById ? worker.get(p.recordedById) ?? null : null,
    });
  }
  return { upserts, skipped, counts };
}
