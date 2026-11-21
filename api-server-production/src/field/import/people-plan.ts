/**
 * Shadow import from SiteClock, people slice (FIELD_PLAN.md §5.2). Pure: it takes the SiteClock rows of one
 * company (read through a read-only connection) and what AIMS already has, and returns the Field rows to
 * upsert, keyed by (organizationId, siteclockId) so a re-run changes nothing.
 *
 * Safety rules (no effect on any screen that exists today):
 *   - never creates or edits Worker / WorkerTeam / WorkerTeamMember (the live Workers & Teams page and the
 *     job crew picker read them). SiteClock people / teams are matched to the rows the round 39 sync made
 *     (Worker.siteclockId / WorkerTeam.siteclockId); anything not matched is reported, not created;
 *   - only Field* tables are written.
 */

export interface ScUser {
  id: string; companyId: string; phone: string; name: string; role: string; employeeNo: string | null;
  deviceId: string | null; deviceBoundAt: Date | null; deviceVerified: boolean; lastBindPhotoPath: string | null; faceDescriptor: unknown;
  verifyRequested: boolean; active: boolean; termsAcceptedVersion: number | null; termsAcceptedAt: Date | null;
  attendanceExempt: boolean; payslipVisible: boolean; jobClocking: string | null; offSiteClocking: string | null; selfiePolicy: string | null;
  baseClocking: string | null; payFollowsCrew: boolean; crewMarginBeforeMin: number | null; crewMarginAfterMin: number | null;
  sharedWithLinked: boolean; companyRoleName: string | null; createdAt: Date;
}
export interface ScPeople {
  company: Record<string, any>;
  users: ScUser[];
  teams: Array<{ id: string; name: string; active: boolean }>;
  memberships: Array<{ id: string; teamId: string; userId: string; startDate: string; endDate: string | null }>;
  teamSupervisors: Array<{ id: string; teamId: string; userId: string }>;
  sites: Array<Record<string, any>>;
  siteAssignments: Array<{ id: string; userId: string; siteId: string; isSupervisor: boolean }>;
  trades: Array<{ id: string; name: string }>;
  userTrades: Array<{ userId: string; tradeId: string }>;
  invites: Array<Record<string, any>>;
  registrations: Array<Record<string, any>>;
  photoUpdates: Array<Record<string, any>>;
}
export interface AimsPeople {
  workers: Array<{ id: string; siteclockId: string | null }>;
  teams: Array<{ id: string; siteclockId: string | null }>;
  /** Field rows already there, by table: siteclockId -> AIMS id (sites, trades, shift templates, invites…). */
  existing: Record<string, Map<string, string>>;
}

export type Upsert = { table: string; siteclockId: string; data: Record<string, unknown> };
export interface PeoplePlan {
  upserts: Upsert[];
  skipped: Array<{ table: string; siteclockId: string; reason: string }>;
  counts: Record<string, { source: number; upsert: number; skipped: number }>;
}

const SETTINGS_KEYS = [
  'timezone', 'fraudPolicy', 'unassignedSelfie', 'supervisorsApproveTimesheets', 'notifyRoster', 'supervisorsManageJobs', 'termsText',
  'termsVersion', 'termsUpdatedAt', 'selfiePolicy', 'jobClocking', 'groupJobClocking', 'photoAtFirstLogin', 'offSiteReview', 'missedClockOut',
  'groupClockBy', 'crewMarginBeforeMin', 'crewMarginAfterMin', 'baseClocking', 'shareWorkers',
];

/** SiteClock file paths are kept as "siteclock:<path>" until the files are copied to S3. */
export const scFileKey = (p: string | null | undefined) => (p ? `siteclock:${p}` : null);

export function planPeople(sc: ScPeople, aims: AimsPeople, organizationId: string): PeoplePlan {
  const upserts: Upsert[] = [];
  const skipped: PeoplePlan['skipped'] = [];
  const counts: PeoplePlan['counts'] = {};
  const count = (t: string, k: 'source' | 'upsert' | 'skipped') => {
    counts[t] = counts[t] ?? { source: 0, upsert: 0, skipped: 0 };
    counts[t][k]++;
  };
  const put = (table: string, siteclockId: string, data: Record<string, unknown>) => {
    count(table, 'source');
    count(table, 'upsert');
    upserts.push({ table, siteclockId, data: { organizationId, siteclockId, ...data } });
  };
  const skip = (table: string, siteclockId: string, reason: string) => {
    count(table, 'source');
    count(table, 'skipped');
    skipped.push({ table, siteclockId, reason });
  };

  const workerOf = new Map(aims.workers.filter((w) => w.siteclockId).map((w) => [w.siteclockId as string, w.id]));
  const teamOf = new Map(aims.teams.filter((t) => t.siteclockId).map((t) => [t.siteclockId as string, t.id]));
  // Field ids for rows made in this same run: deterministic per siteclockId so later references resolve.
  const ids: Record<string, Map<string, string>> = {};
  const fieldId = (table: string, scId: string) => {
    ids[table] = ids[table] ?? new Map(aims.existing[table] ?? []);
    if (!ids[table].has(scId)) ids[table].set(scId, `new:${table}:${scId}`);
    return ids[table].get(scId)!;
  };

  // Settings (one row, keyed by the org; siteclockId = the company id).
  const settings: Record<string, unknown> = { siteclockCompanyId: sc.company.id };
  for (const k of SETTINGS_KEYS) if (sc.company[k] !== undefined) settings[k] = sc.company[k];
  settings.jobClockingTeamIds = (sc.company.jobClockingTeamIds ?? []).map((t: string) => teamOf.get(t)).filter(Boolean);
  put('fieldSettings', sc.company.id, settings);

  // Workers -> FieldWorkerProfile (matched only).
  for (const u of sc.users) {
    if (u.role === 'SUPERADMIN') continue;
    const workerId = workerOf.get(u.id);
    if (!workerId) {
      skip('fieldWorkerProfile', u.id, `${u.name}: not in Workers & Teams yet (run the SiteClock sync first)`);
      continue;
    }
    put('fieldWorkerProfile', u.id, {
      workerId, tier: u.role, siteclockRoleName: u.companyRoleName, employeeNo: u.employeeNo, deviceId: u.deviceId, deviceBoundAt: u.deviceBoundAt,
      deviceVerified: u.deviceVerified, photoKey: scFileKey(u.lastBindPhotoPath), faceDescriptor: u.faceDescriptor ?? null, verifyRequested: u.verifyRequested,
      termsAcceptedVersion: u.termsAcceptedVersion, termsAcceptedAt: u.termsAcceptedAt, attendanceExempt: u.attendanceExempt, payslipVisible: u.payslipVisible,
      jobClocking: u.jobClocking, offSiteClocking: u.offSiteClocking, selfiePolicy: u.selfiePolicy, baseClocking: u.baseClocking, payFollowsCrew: u.payFollowsCrew,
      crewMarginBeforeMin: u.crewMarginBeforeMin, crewMarginAfterMin: u.crewMarginAfterMin, sharedWithLinked: u.sharedWithLinked, siteclockCreatedAt: u.createdAt,
    });
  }

  for (const t of sc.teams) if (!teamOf.get(t.id)) skip('team', t.id, `${t.name}: not in Workers & Teams yet (run the SiteClock sync first)`);
  for (const m of sc.memberships) {
    const teamId = teamOf.get(m.teamId);
    const workerId = workerOf.get(m.userId);
    if (!teamId || !workerId) skip('fieldTeamStint', m.id, !teamId ? 'team not matched' : 'worker not matched');
    else put('fieldTeamStint', m.id, { teamId, workerId, startDate: m.startDate, endDate: m.endDate });
  }
  for (const s of sc.teamSupervisors) {
    const teamId = teamOf.get(s.teamId);
    const workerId = workerOf.get(s.userId);
    if (!teamId || !workerId) skip('fieldTeamSupervisor', s.id, !teamId ? 'team not matched' : 'worker not matched');
    else put('fieldTeamSupervisor', s.id, { teamId, workerId });
  }

  for (const s of sc.sites) {
    put('fieldSite', s.id, {
      id: fieldId('fieldSite', s.id), name: s.name, address: s.address ?? null, lat: s.lat, lng: s.lng, radiusM: s.radiusM, timezone: s.timezone,
      maxAccuracyM: s.maxAccuracyM, autoCloseAfterH: s.autoCloseAfterH, active: s.active, kind: s.kind, allWorkers: s.allWorkers, externalRef: s.externalRef ?? null,
    });
  }
  for (const a of sc.siteAssignments) {
    const workerId = workerOf.get(a.userId);
    if (!workerId) skip('fieldSiteAssignment', a.id, 'worker not matched');
    else put('fieldSiteAssignment', a.id, { siteId: fieldId('fieldSite', a.siteId), workerId, isSupervisor: a.isSupervisor });
  }

  for (const t of sc.trades) put('fieldTrade', t.id, { id: fieldId('fieldTrade', t.id), name: t.name });
  for (const ut of sc.userTrades) {
    const workerId = workerOf.get(ut.userId);
    if (!workerId) skip('fieldWorkerTrade', `${ut.userId}:${ut.tradeId}`, 'worker not matched');
    else put('fieldWorkerTrade', `${ut.userId}:${ut.tradeId}`, { workerId, tradeId: fieldId('fieldTrade', ut.tradeId) });
  }

  for (const i of sc.invites) {
    put('fieldInvite', i.id, {
      id: fieldId('fieldInvite', i.id), token: i.token, label: i.label ?? null, siteId: i.siteId ? fieldId('fieldSite', i.siteId) : null,
      templateId: i.templateId ? fieldId('fieldShiftTemplate', i.templateId) : null, role: i.role ?? null,
      templateIds: (i.templateIds ?? []).map((t: string) => fieldId('fieldShiftTemplate', t)), leaveDays: i.leaveDays ?? null, active: i.active,
      expiresAt: i.expiresAt ?? null, maxUses: i.maxUses ?? null, uses: i.uses ?? 0, createdById: i.createdById ? `siteclock:${i.createdById}` : null, createdAt: i.createdAt,
    });
  }
  for (const r of sc.registrations) {
    put('fieldRegistration', r.id, {
      inviteId: fieldId('fieldInvite', r.inviteId), phone: r.phone, name: r.name, employeeNo: r.employeeNo ?? null, photoKey: scFileKey(r.photoPath),
      status: r.status, reviewedById: r.reviewedById ? `siteclock:${r.reviewedById}` : null, reviewedAt: r.reviewedAt ?? null, createdAt: r.createdAt,
    });
  }
  for (const p of sc.photoUpdates) {
    const workerId = workerOf.get(p.userId);
    if (!workerId) {
      skip('fieldPhotoUpdate', p.id, 'worker not matched');
      continue;
    }
    put('fieldPhotoUpdate', p.id, {
      workerId, status: p.status, photoKey: scFileKey(p.photoPath), requestedById: p.requestedById ? `siteclock:${p.requestedById}` : null, auto: p.auto,
      setVerify: p.setVerify, reviewedById: p.reviewedById ? `siteclock:${p.reviewedById}` : null, reviewedAt: p.reviewedAt ?? null, note: p.note ?? null,
      submittedAt: p.submittedAt ?? null, createdAt: p.createdAt,
    });
  }
  return { upserts, skipped, counts };
}
