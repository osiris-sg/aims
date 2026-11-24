// Custom access (features.enableCustomAccess, WCT group 2026-11-19). The API side is
// api-server-production/src/access/tab-access.ts (the tab list below mirrors ACCESS_TABS there;
// helpers/customAccess.test.mjs checks the keys match). Access is per tab: No access / View / Edit;
// the HR tabs (2026-11-24, the Field module) sit under an "HR" heading and some also offer Approve.
// The server enforces it; these helpers only shape the menus and the editors.

export type AccessLevel = "none" | "view" | "edit" | "approve";
export type TabKey =
  | "dashboard"
  | "sales"
  | "orders"
  | "jobs"
  | "serviceReports"
  | "assets"
  | "inventory"
  | "accounting"
  | "orgSettings"
  | "reports"
  | "salesReport"
  | "calendar"
  | "hrPeople"
  | "hrJobs"
  | "hrPunches"
  | "hrTimesheets"
  | "hrLeave"
  | "hrPayroll"
  | "hrReports";
export type TabAccessMap = Record<TabKey, AccessLevel>;

export const ACCESS_TABS: Array<{ key: TabKey; label: string; levels: AccessLevel[]; group?: string }> = [
  { key: "dashboard", label: "Dashboard", levels: ["none", "view"] },
  { key: "sales", label: "Sales", levels: ["none", "view", "edit"] },
  { key: "orders", label: "Orders", levels: ["none", "view", "edit"] },
  { key: "jobs", label: "Jobs", levels: ["none", "view", "edit"] },
  { key: "serviceReports", label: "Service Reports", levels: ["none", "view", "edit"] },
  { key: "assets", label: "Assets", levels: ["none", "view", "edit"] },
  { key: "inventory", label: "Inventory", levels: ["none", "view", "edit"] },
  { key: "accounting", label: "Accounting", levels: ["none", "view", "edit"] },
  { key: "orgSettings", label: "Org Settings", levels: ["none", "view", "edit"] },
  { key: "reports", label: "Reports", levels: ["none", "view"] },
  { key: "salesReport", label: "Sales report", levels: ["none", "view", "edit"] },
  { key: "calendar", label: "Calendar", levels: ["none", "view", "edit"] },
  { key: "hrPeople", label: "People", group: "HR", levels: ["none", "view", "edit"] },
  { key: "hrJobs", label: "Job plan", group: "HR", levels: ["none", "view", "edit"] },
  { key: "hrPunches", label: "Clock-ins", group: "HR", levels: ["none", "view", "approve"] },
  { key: "hrTimesheets", label: "Timesheets", group: "HR", levels: ["none", "view", "edit", "approve"] },
  { key: "hrLeave", label: "Leave", group: "HR", levels: ["none", "view", "approve"] },
  { key: "hrPayroll", label: "Payroll", group: "HR", levels: ["none", "view", "edit"] },
  { key: "hrReports", label: "Reports", group: "HR", levels: ["none", "view"] },
];

/** The HR rows are offered only where the org has the HR (Field) module on. */
export const isHrTab = (key: TabKey) => key.startsWith("hr");
/** A map with the HR rows at No access (what an org without HR saves and copies). */
export function withoutHr(map: TabAccessMap): TabAccessMap {
  const out = { ...map };
  for (const t of ACCESS_TABS) if (isHrTab(t.key)) out[t.key] = "none";
  return out;
}
/** "HR · People" for an HR tab, the plain label otherwise. */
export const tabTitle = (t: { label: string; group?: string }) => (t.group ? `${t.group} · ${t.label}` : t.label);

/** What each level reads as on a tab (the Sales report's View / Edit are own / everyone's quotations). */
export function levelLabel(tab: TabKey, level: AccessLevel): string {
  if (level === "none") return "No access";
  if (tab === "salesReport") return level === "view" ? "Own" : "All";
  return level === "view" ? "View" : level === "approve" ? "Approve" : "Edit";
}

export const CUSTOM_PREFIX = "Custom · ";
export const CUSTOM_ACCESS_ROLE_ID = "custom-access";

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, approve: 3 };
export const atLeast = (l: AccessLevel | undefined | null, need: "view" | "edit") => RANK[l ?? "none"] >= RANK[need];

export function noAccess(): TabAccessMap {
  return Object.fromEntries(ACCESS_TABS.map((t) => [t.key, "none"])) as TabAccessMap;
}

/** A stored / API map read back: every tab present, anything odd = No access. */
export function readTabAccess(raw: unknown): TabAccessMap {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = noAccess();
  for (const t of ACCESS_TABS) {
    const v = src[t.key] as AccessLevel;
    out[t.key] = t.levels.includes(v) ? v : "none";
  }
  return out;
}

/** Union (multi-role): each tab at the highest level any map gives. */
export function unionTabAccess(maps: TabAccessMap[]): TabAccessMap {
  const out = noAccess();
  for (const m of maps) for (const t of ACCESS_TABS) if (RANK[m[t.key]] > RANK[out[t.key]]) out[t.key] = m[t.key];
  return out;
}

/** The map that governs the signed-in person (from GET /users/me/roles), or null = roles as before.
 *  Custom only when EVERY role carries a tabAccess (own Custom access, or custom roles only). */
export function effectiveTabAccess(roles: Array<{ tabAccess?: unknown }> | null | undefined): TabAccessMap | null {
  const list = roles || [];
  if (!list.length || !list.every((r) => r && r.tabAccess && typeof r.tabAccess === "object")) return null;
  return unionTabAccess(list.map((r) => readTabAccess(r.tabAccess)));
}

/** A custom role row (Org Settings > Roles), told apart by its stored description. */
export const isCustomRole = (r: { description?: string | null } | null | undefined) => String(r?.description ?? "").startsWith(CUSTOM_PREFIX);
/** A custom role's one-line summary ("Sales edit, Orders view"). */
export const customSummary = (r: { description?: string | null }) => String(r.description ?? "").slice(CUSTOM_PREFIX.length);

/** Org Settings pages a custom-access person sees: none at No access; at View everything but Roles. */
export function settingsAllowed(map: TabAccessMap | null, path: string): boolean {
  if (!map) return true;
  if (!atLeast(map.orgSettings, "view")) return false;
  if (path === "/portal/settings/roles") return false;
  return true;
}

/** Sales sub tabs for a custom-access person: the Sales report needs that tab, the rest need Sales. */
export function salesSubmenuAllowed(map: TabAccessMap | null, key: string): boolean {
  if (!map) return true;
  if (key === "sales-report") return atLeast(map.salesReport, "view");
  return atLeast(map.sales, "view");
}

/**
 * Jobs sub tabs (jobs calendar orgs, the WCT group): "Calendar" first, the default view when opening
 * Jobs (Elroy 2026-11-21), then "Jobs" (the list). A custom access person gets the ones their access opens.
 */
export const JOBS_LIST_TAB = { key: "list", label: "Jobs" };
export const JOBS_CALENDAR_TAB = { key: "calendar", label: "Calendar", href: "/portal/deliveries/calendar" };
export function jobsSubmenus(map: TabAccessMap | null): Array<{ key: string; label: string; href?: string }> {
  if (!map) return [JOBS_CALENDAR_TAB, JOBS_LIST_TAB];
  return [...(atLeast(map.calendar, "view") ? [JOBS_CALENDAR_TAB] : []), ...(atLeast(map.jobs, "view") ? [JOBS_LIST_TAB] : [])];
}

/** Can the person open the jobs calendar? (No custom map: as before.) */
export const calendarAllowed = (map: TabAccessMap | null) => !map || atLeast(map.calendar, "view");

/** "Sales edit, Orders view" for a map (the Roles list). hr = false leaves the HR rows out (orgs without HR). */
export function accessSummary(map: TabAccessMap, hr = true): string {
  const parts = ACCESS_TABS.filter((t) => map[t.key] !== "none" && (hr || !isHrTab(t.key))).map((t) => `${tabTitle(t)} ${levelLabel(t.key, map[t.key]).toLowerCase()}`);
  return parts.length ? parts.join(", ") : "No access";
}

/** Roles list row menu (2026-11-23): a built-in role is read only, so Duplicate only; a custom role Edit / Duplicate / Delete. */
export function roleMenuItems(builtIn: boolean): Array<{ key: "edit" | "duplicate" | "delete"; label: string }> {
  return builtIn
    ? [{ key: "duplicate", label: "Duplicate" }]
    : [
        { key: "edit", label: "Edit" },
        { key: "duplicate", label: "Duplicate" },
        { key: "delete", label: "Delete" },
      ];
}

/** A free name for a duplicated role: "Sales copy", then "Sales copy 2", … (names compare without case; max 40). */
export function copyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  const base = `${name.trim().slice(0, 35)} copy`;
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return base;
}
