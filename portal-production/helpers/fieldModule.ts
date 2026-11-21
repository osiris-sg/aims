// Field module (FIELD_PLAN.md, 2026-11-21): SiteClock's office side, native in AIMS. Pure helpers for the
// flags, the "Field" nav group and the caller's access (mirrors api src/field/common/field-flags.ts and
// field-access.ts; helpers/fieldModule.test.mjs keeps the two in step).

export type FieldArea = "people" | "jobs" | "punches" | "timesheets" | "leave" | "payroll" | "reports";
export const FIELD_AREAS: FieldArea[] = ["people", "jobs", "punches", "timesheets", "leave", "payroll", "reports"];
export const FIELD_MODULE_FLAG = "enableFieldModule";
export const FIELD_AREA_FLAGS: Record<FieldArea, string> = {
  people: "enableFieldPeople",
  jobs: "enableFieldJobs",
  punches: "enableFieldPunches",
  timesheets: "enableFieldTimesheets",
  leave: "enableFieldLeave",
  payroll: "enableFieldPayroll",
  reports: "enableFieldReports",
};

/** The areas that are on: none unless enableFieldModule is true. */
export function fieldAreasOn(features: Record<string, unknown> | null | undefined): FieldArea[] {
  const f = features || {};
  if (f[FIELD_MODULE_FLAG] !== true) return [];
  return FIELD_AREAS.filter((a) => f[FIELD_AREA_FLAGS[a]] === true);
}

export type FieldLevel = "none" | "view" | "edit" | "approve";
const RANK: Record<FieldLevel, number> = { none: 0, view: 1, edit: 2, approve: 3 };
export const fieldAtLeast = (have: FieldLevel | undefined, need: FieldLevel) => RANK[have ?? "none"] >= RANK[need];

export interface FieldAccess {
  levels: Record<FieldArea, FieldLevel>;
  scoped: Record<FieldArea, boolean>;
  admin: boolean;
}

export const FIELD_BASE = "/portal/field";

/** The Field pages, in nav order, with the area each one belongs to. */
export const FIELD_PAGES: Array<{ key: string; label: string; area: FieldArea; path: string }> = [
  { key: "workers", label: "Workers", area: "people", path: `${FIELD_BASE}/workers` },
  { key: "teams", label: "Teams", area: "people", path: `${FIELD_BASE}/teams` },
  { key: "sites", label: "Sites", area: "people", path: `${FIELD_BASE}/sites` },
  { key: "invites", label: "Invites", area: "people", path: `${FIELD_BASE}/invites` },
  { key: "plan", label: "Plan", area: "jobs", path: `${FIELD_BASE}/plan` },
  { key: "working-hours", label: "Working hours", area: "jobs", path: `${FIELD_BASE}/working-hours` },
  { key: "clock-ins", label: "Clock-ins", area: "punches", path: `${FIELD_BASE}/clock-ins` },
  { key: "settings", label: "Field settings", area: "people", path: `${FIELD_BASE}/settings` },
];

/** The pages this person may open: area on and access at least View. */
export function fieldPagesFor(areas: FieldArea[], access: FieldAccess | null | undefined) {
  if (!access) return [];
  return FIELD_PAGES.filter((p) => areas.includes(p.area) && fieldAtLeast(access.levels[p.area], "view"));
}

/** The "Field" nav group (a synthetic module, like Assets for vehicles); null when nothing is open. */
export function fieldNavModule(areas: FieldArea[], access: FieldAccess | null | undefined, sortOrder = 75) {
  const pages = fieldPagesFor(areas, access);
  if (!pages.length) return null;
  return {
    moduleCode: "FIELD",
    displayName: "Field",
    enabled: true,
    icon: "Engineering",
    sortOrder,
    config: { route: pages[0].path, subMenus: pages.map((p) => ({ key: p.key, label: p.label, href: p.path })) },
  };
}

/** Masked phone for lists: +65 9123 4567 -> +65 ****4567. */
export const maskPhone = (p: string | null | undefined) => (p ? `${p.slice(0, Math.max(0, p.length - 8))}****${p.slice(-4)}` : "");
