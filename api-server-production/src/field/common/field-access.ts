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
};

/** SiteClock's built-in Supervisor (live, flagged view + review, timesheets view / edit / export, workers view, jobs view, schedules assign, leave view / approve, attendance report). */
export const SUPERVISOR_GRANT: FieldGrant = { people: 'view', jobs: 'view', punches: 'approve', timesheets: 'edit', leave: 'approve', reports: 'view' };

export const ADMIN_ROLE_NAMES = ['admin', 'superadmin', 'osirisadmin', 'osiris-admin'];

export interface FieldAccess {
  levels: Record<FieldArea, FieldLevel>;
  /** Areas the caller reaches only as a supervisor (own sites + teams). */
  scoped: Record<FieldArea, boolean>;
  admin: boolean;
}

export function computeFieldAccess(input: { isOsirisAdmin: boolean; roleNames: string[]; supervises: boolean }): FieldAccess {
  const names = input.roleNames.map((n) => String(n || '').trim().toLowerCase());
  const admin = input.isOsirisAdmin || names.length === 0 || names.some((n) => ADMIN_ROLE_NAMES.includes(n));
  const levels = {} as Record<FieldArea, FieldLevel>;
  const scoped = {} as Record<FieldArea, boolean>;
  for (const area of FIELD_AREAS) {
    let company: FieldLevel = admin ? 'approve' : 'none';
    for (const n of names) company = max(company, FIELD_PRESETS[n]?.[area] ?? 'none');
    const sup: FieldLevel = input.supervises ? SUPERVISOR_GRANT[area] ?? 'none' : 'none';
    levels[area] = max(company, sup);
    scoped[area] = company === 'none' && sup !== 'none';
  }
  return { levels, scoped, admin };
}
