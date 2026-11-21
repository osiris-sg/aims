/**
 * Field module flags (FIELD_PLAN.md §2). Org feature enableFieldModule (default off) plus one flag per
 * area (default off); an area is on only when both are true. Off = no nav, every /field route 404s,
 * no cron registers work for the org. fieldEngineLive (default off) is the extra switch the ported
 * crons need, because shadow-imported OPEN entries must never be auto-closed while SiteClock is live.
 */
export const FIELD_MODULE_FLAG = 'enableFieldModule';
export const FIELD_ENGINE_LIVE = 'fieldEngineLive';

export type FieldArea = 'people' | 'jobs' | 'punches' | 'timesheets' | 'leave' | 'payroll' | 'reports';
export const FIELD_AREAS: FieldArea[] = ['people', 'jobs', 'punches', 'timesheets', 'leave', 'payroll', 'reports'];

export const FIELD_AREA_FLAGS: Record<FieldArea, string> = {
  people: 'enableFieldPeople',
  jobs: 'enableFieldJobs',
  punches: 'enableFieldPunches',
  timesheets: 'enableFieldTimesheets',
  leave: 'enableFieldLeave',
  payroll: 'enableFieldPayroll',
  reports: 'enableFieldReports',
};

/** Every Field flag key (module, areas, engine): all default false. */
export const ALL_FIELD_FLAGS: string[] = [FIELD_MODULE_FLAG, ...Object.values(FIELD_AREA_FLAGS), FIELD_ENGINE_LIVE];

export function fieldAreaOn(features: Record<string, unknown> | null | undefined, area: FieldArea): boolean {
  const f = features || {};
  return f[FIELD_MODULE_FLAG] === true && f[FIELD_AREA_FLAGS[area]] === true;
}

export function fieldModuleOn(features: Record<string, unknown> | null | undefined): boolean {
  return (features || {})[FIELD_MODULE_FLAG] === true;
}

export function fieldEngineLive(features: Record<string, unknown> | null | undefined): boolean {
  return fieldModuleOn(features) && (features || {})[FIELD_ENGINE_LIVE] === true;
}
