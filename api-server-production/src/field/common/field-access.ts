/**
 * Who may do what in the Field module (FIELD_PLAN.md §3.4). Pure.
 *
 * Levels per area: none < view < edit < approve ("approve" also grants edit; used by Timesheets and
 * Leave, and by Punches for flag review). Sources, unioned:
 *   - Admin (osiris admin, superadmin, the org's Admin role, or no roles at all as AIMS treats it): every area at approve, company scope.
 *   - Role presets by role NAME (AIMS role presets): Operations and Accounting below.
 *   - Supervisor: an AIMS login linked to a Worker who supervises a site or a team (SiteClock's
 *     SUPERVISOR_DEFAULTS, lib/permissions.ts @62b7d9d), limited to their own sites and teams.
 * A company-scope grant for an area wins over the supervisor grant for that area.
 *
 * Custom access orgs (2026-11-24): when the person is governed by a tab map (their own Custom access,
 * custom roles, or enforced presets), the company levels come from the map's HR tabs and the role
 * names are not read, so the Roles grid is the one place HR access is set. A person with no roles in
 * such an org is NOT an Admin.
 */
import type { FieldArea } from './field-flags';
import { FIELD_AREAS } from './field-flags';

export type FieldLevel = 'none' | 'view' | 'edit' | 'approve';
const RANK: Record<FieldLevel, number> = { none: 0, view: 1, edit: 2, approve: 3 };
export const atLeast = (have: FieldLevel, need: FieldLevel) => RANK[have] >= RANK[need];
const max = (a: FieldLevel, b: FieldLevel): FieldLevel => (RANK[a] >= RANK[b] ? a : b);

export type FieldGrant = Partial<Record<FieldArea, FieldLevel>>;

/** Elroy 2026-11-21: Operations = punch review, timesheet and leave approval; Accounting = timesheets view, payroll. */
export const FIELD_PRESETS: Record<string, FieldGrant> = {
  operations: { people: 'view', jobs: 'edit', punches: 'approve', timesheets: 'approve', leave: 'approve', reports: 'view' },
  accounting: { people: 'view', timesheets: 'view', payroll: 'edit', reports: 'view' },
  viewer: { people: 'view', jobs: 'view', punches: 'view', timesheets: 'view', leave: 'view', reports: 'view' },
};

/** The HR tab (src/access/tab-access.ts) behind each area. */
export const HR_TAB_FOR_AREA: Record<FieldArea, string> = {
  people: 'hrPeople',
  jobs: 'hrJobs',
  punches: 'hrPunches',
  timesheets: 'hrTimesheets',
  leave: 'hrLeave',
  payroll: 'hrPayroll',
  reports: 'hrReports',
};

/** A tab map's HR levels as a company grant. */
export function grantFromTabMap(map: Record<string, unknown>): FieldGrant {
  const out: FieldGrant = {};
  for (const area of FIELD_AREAS) {
    const v = map[HR_TAB_FOR_AREA[area]];
    out[area] = v === 'view' || v === 'edit' || v === 'approve' ? v : 'none';
  }
  return out;
}

/** SiteClock's built-in Supervisor (live, flagged view + review, timesheets view / edit / export, workers view, jobs view, schedules assign, leave view / approve, attendance report). */
export const SUPERVISOR_GRANT: FieldGrant = { people: 'view', jobs: 'view', punches: 'approve', timesheets: 'edit', leave: 'approve', reports: 'view' };

export const ADMIN_ROLE_NAMES = ['admin', 'superadmin', 'osirisadmin', 'osiris-admin'];

export interface FieldAccess {
  levels: Record<FieldArea, FieldLevel>;
  /** Areas the caller reaches only as a supervisor (own sites + teams). */
  scoped: Record<FieldArea, boolean>;
  admin: boolean;
}

export function computeFieldAccess(input: {
  isOsirisAdmin: boolean;
  roleNames: string[];
  supervises: boolean;
  /** The company grant from the person's tab map; when set the role names are not read. */
  grant?: FieldGrant | null;
  /** Custom access org: a person with no roles is not an Admin. */
  customAccessOrg?: boolean;
}): FieldAccess {
  const mapped = !input.isOsirisAdmin && !!input.grant;
  const names = mapped ? [] : input.roleNames.map((n) => String(n || '').trim().toLowerCase());
  const admin = input.isOsirisAdmin || (!mapped && ((names.length === 0 && !input.customAccessOrg) || names.some((n) => ADMIN_ROLE_NAMES.includes(n))));
  const levels = {} as Record<FieldArea, FieldLevel>;
  const scoped = {} as Record<FieldArea, boolean>;
  for (const area of FIELD_AREAS) {
    let company: FieldLevel = admin ? 'approve' : mapped ? input.grant![area] ?? 'none' : 'none';
    for (const n of names) company = max(company, FIELD_PRESETS[n]?.[area] ?? 'none');
    const sup: FieldLevel = input.supervises ? SUPERVISOR_GRANT[area] ?? 'none' : 'none';
    levels[area] = max(company, sup);
    scoped[area] = company === 'none' && sup !== 'none';
  }
  return { levels, scoped, admin };
}
