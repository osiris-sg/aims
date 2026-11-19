/**
 * Custom access (WCT group, Elroy 2026-11-19; per-org flag features.enableCustomAccess, default OFF).
 *
 * Access is given per TAB of the app, each at No access / View / Edit:
 *   - a custom role (Org Settings > Roles) is a real Role row whose tab map lives in CustomAccess
 *     (kind ROLE); its permissions + allowedModules are derived from the map when it is saved, so
 *     the role picker, the nav and multi-role (union) work as for any role;
 *   - a person's own Custom access (Add / Edit User, kind USER) supersedes their roles.
 *
 * The server enforces it in ClerkAuthGuard (src/access/custom-access.ts): for a custom-access user
 * every request is checked against the tab map, by PATH (the controllers behind each tab, GET =
 * view, any other method = edit; this also covers routes that carry no @Permissions) and, for
 * @Permissions routes, by the resource:action patterns the map grants. Paths not listed below are
 * shared by several screens (look-ups, pickers, the editor's tax rates…) and stay permission-only.
 *
 * Presets (src/roles/role-presets.ts) keep their own permissions. PRESET_TAB_ACCESS is the same
 * table written per tab (the audit's "final preset table"); it is only enforced by path when the
 * org also has features.enforcePresetTabs (default OFF).
 */
import { matchesPattern } from '../roles/role-presets';

export type AccessLevel = 'none' | 'view' | 'edit';
export const ACCESS_LEVELS: AccessLevel[] = ['none', 'view', 'edit'];

export type TabKey =
  | 'dashboard'
  | 'sales'
  | 'orders'
  | 'jobs'
  | 'serviceReports'
  | 'assets'
  | 'inventory'
  | 'accounting'
  | 'orgSettings'
  | 'reports'
  | 'salesReport'
  | 'calendar';

export type TabAccessMap = Record<TabKey, AccessLevel>;

export interface AccessTab {
  key: TabKey;
  label: string;
  /** The levels this tab offers (a read-only screen has no Edit). */
  levels: AccessLevel[];
  /** Nav modules the tab opens at View or above. */
  modules: string[];
  /** Extra modules opened only at Edit. */
  editModules?: string[];
  /** Permission patterns ("res:act", * allowed) granted at View. */
  view: string[];
  /** Patterns added at Edit (View's are included). */
  edit: string[];
}

const DOC_READ = ['documents:read', 'documents:read-*', 'documents:generate-pdf', 'documents:payment-summary', 'documentTemplates:read', 'documentTemplates:read-one'];
const CUSTOMER_READ = ['customers:read', 'customers:read-one', 'customer-info:read'];
const STOCK_READ = ['inventories:read', 'inventories:read-*', 'categories:read', 'categories:read-one', 'assets:read', 'assets:read-*', 'assets:check-sku'];
const TIMELINE_READ = ['timeline-items:read-*'];

export const ACCESS_TABS: AccessTab[] = [
  { key: 'dashboard', label: 'Dashboard', levels: ['none', 'view'], modules: ['DASHBOARD'], view: ['dashboard:read'], edit: [] },
  {
    key: 'sales',
    label: 'Sales',
    levels: ACCESS_LEVELS,
    modules: ['SALES', 'CUSTOMERS'],
    // dashboard:read: the Sales main page's figures (GET /dashboard/role-home).
    view: [...DOC_READ, ...CUSTOMER_READ, ...STOCK_READ, ...TIMELINE_READ, 'payments:read', 'projects:read', 'projects:read-one', 'document-extraction:read-types', 'dashboard:read'],
    edit: ['documents:*', 'document-extraction:*', 'customers:*', 'customer-info:*', 'timeline-items:*', 'uploads:upload-image'],
  },
  {
    key: 'orders',
    label: 'Orders',
    levels: ACCESS_LEVELS,
    modules: ['ORDERS'],
    view: ['orders:read', 'maintenance-reports:read', ...DOC_READ, ...CUSTOMER_READ, ...TIMELINE_READ],
    // Cancel order is an update; hard delete (orders:delete) stays with Admin.
    edit: ['orders:read', 'orders:create', 'orders:update', 'documents:create-basic', 'documents:update', 'documents:create-revision', 'documents:send-email', 'customers:create-by-name', 'uploads:upload-image'],
  },
  {
    key: 'jobs',
    label: 'Jobs',
    levels: ACCESS_LEVELS,
    modules: ['DELIVERIES'],
    view: ['maintenance-reports:read', 'documents:read', 'documents:read-*', 'documents:generate-pdf', ...CUSTOMER_READ, ...STOCK_READ, 'projects:read', 'projects:read-one'],
    // Job cancel / delete / assign use maintenance-reports:create on the API; the path check keeps
    // a Jobs-only user out of the service report screens' own routes.
    edit: ['maintenance-reports:create', 'documents:create-basic', 'documents:update', 'timeline-items:create', 'customers:create-by-name', 'projects:create-by-name', 'projects:add-assignments', 'uploads:upload-image'],
  },
  {
    key: 'serviceReports',
    label: 'Service Reports',
    levels: ACCESS_LEVELS,
    modules: ['MAINTENANCE'],
    view: ['maintenance-reports:read', 'documents:read', 'documents:read-*', ...CUSTOMER_READ],
    edit: ['maintenance-reports:*', 'uploads:upload-image'],
  },
  {
    key: 'assets',
    label: 'Assets',
    levels: ACCESS_LEVELS,
    modules: ['ASSETS'],
    view: ['vehicles:read', 'assets:read', 'assets:read-*'],
    // Repair approve / unlock (vehicles:approve) stays with Admin.
    edit: ['vehicles:update', 'assets:create', 'assets:update', 'assets:create-basic', 'assets:create-child', 'assets:check-sku', 'uploads:upload-image'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    levels: ACCESS_LEVELS,
    modules: ['INVENTORY'],
    view: [...STOCK_READ, 'suppliers:read', 'suppliers:read-one', 'dashboard:read'],
    edit: ['inventories:*', 'categories:*', 'uploads:upload-image'],
  },
  {
    key: 'accounting',
    label: 'Accounting',
    levels: ACCESS_LEVELS,
    modules: ['ACCOUNTING', 'SUPPLIERS'],
    view: ['accounting:read', 'journal:read', 'bills:read', 'bankrec:read', 'payments:read', 'statements:read', 'transactions:read', 'xerosync:read', ...DOC_READ, ...CUSTOMER_READ, 'suppliers:read', 'suppliers:read-one', ...TIMELINE_READ],
    edit: ['accounting:*', 'journal:*', 'bills:*', 'bankrec:*', 'payments:*', 'transactions:*', 'xerosync:*', 'suppliers:*', 'customers:update', 'documents:update', 'documents:send-email', 'documents:create-revision', 'uploads:upload-image'],
  },
  {
    key: 'orgSettings',
    label: 'Org Settings',
    levels: ACCESS_LEVELS,
    modules: ['MASTERFILES'],
    editModules: ['USER_MANAGEMENT', 'AUDIT'],
    view: ['organizations:read', 'organizations:read-one', 'organizations:read-user', 'users:read', 'users:read-roles', 'roles:read', 'audit:read', ...CUSTOMER_READ, 'suppliers:read', 'suppliers:read-one', 'categories:read', 'categories:read-one', 'documentTemplates:read', 'documentTemplates:read-one'],
    // Edit is Admin-only (ORG_SETTINGS_EDIT_NEEDS_ADMIN). Role / permission editing is never granted
    // (the Admin preset excludes it too); custom roles are managed through /access.
    edit: ['organizations:update', 'configuration:write', 'users:*', 'customers:*', 'suppliers:*', 'categories:*', 'documentTemplates:*', 'audit:read'],
  },
  { key: 'reports', label: 'Reports', levels: ['none', 'view'], modules: ['REPORTS'], view: ['statements:read', 'documents:read', 'documents:read-*', ...CUSTOMER_READ, 'inventories:read', 'inventories:read-*'], edit: [] },
  // Sales report: View = the person's own quotations, Edit = everyone's (the report itself is read-only).
  { key: 'salesReport', label: 'Sales report', levels: ACCESS_LEVELS, modules: ['SALES'], view: ['documents:read', 'documents:read-*'], edit: [] },
  {
    key: 'calendar',
    label: 'Calendar',
    levels: ACCESS_LEVELS,
    // The calendar opens from Jobs > Calendar (and the Sales main page).
    modules: ['DELIVERIES'],
    view: ['dashboard:read', 'maintenance-reports:read', 'documents:read', 'documents:read-*', ...CUSTOMER_READ],
    edit: ['documents:create-basic', 'customers:create-by-name'],
  },
];

export const TAB_KEYS: TabKey[] = ACCESS_TABS.map((t) => t.key);
const TAB = new Map<TabKey, AccessTab>(ACCESS_TABS.map((t) => [t.key, t]));
export const tabOf = (key: TabKey) => TAB.get(key)!;

/** Patterns never granted through custom access (Admin preset's exclusions). */
export const NEVER_GRANTED = ['permissions:*', 'roles:create', 'roles:update', 'roles:delete', 'organizations:create', 'organizations:delete', 'vehicles:approve', 'orders:delete'];

export const ORG_SETTINGS_EDIT_NEEDS_ADMIN = 'Only an Admin can have Org Settings edit';

export const rank = (l: AccessLevel | undefined | null) => (l === 'edit' ? 2 : l === 'view' ? 1 : 0);
const atLeast = (l: AccessLevel | undefined, need: 'view' | 'edit') => rank(l) >= rank(need);

export const noAccess = (): TabAccessMap => Object.fromEntries(TAB_KEYS.map((k) => [k, 'none'])) as TabAccessMap;
export const fullAccess = (): TabAccessMap => Object.fromEntries(ACCESS_TABS.map((t) => [t.key, t.levels[t.levels.length - 1]])) as TabAccessMap;

/**
 * A clean map from user input: every tab present, unknown keys dropped, a level the tab does not
 * offer lowered to its highest one. Org Settings Edit only when allowed (an Admin), else an error.
 */
export function normalizeTabAccess(raw: unknown, opts: { allowOrgSettingsEdit?: boolean } = {}): TabAccessMap {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = noAccess();
  for (const t of ACCESS_TABS) {
    const v = String(src[t.key] ?? 'none') as AccessLevel;
    if (!ACCESS_LEVELS.includes(v)) throw new Error(`${t.label}: "${v}" is not No access, View or Edit`);
    out[t.key] = t.levels.includes(v) ? v : t.levels[t.levels.length - 1];
  }
  if (out.orgSettings === 'edit' && !opts.allowOrgSettingsEdit) throw new Error(ORG_SETTINGS_EDIT_NEEDS_ADMIN);
  return out;
}

/** A stored map read back (never throws; anything odd reads as No access). */
export function readTabAccess(raw: unknown): TabAccessMap {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = noAccess();
  for (const t of ACCESS_TABS) {
    const v = src[t.key] as AccessLevel;
    out[t.key] = t.levels.includes(v) ? v : 'none';
  }
  return out;
}

/** Multi-role = union: each tab at the highest level any map gives. */
export function unionTabAccess(maps: TabAccessMap[]): TabAccessMap {
  const out = noAccess();
  for (const m of maps) for (const k of TAB_KEYS) if (rank(m[k]) > rank(out[k])) out[k] = m[k];
  return out;
}

/** The permission patterns a map grants. */
export function patternsFor(map: TabAccessMap): string[] {
  const out = new Set<string>();
  for (const t of ACCESS_TABS) {
    if (atLeast(map[t.key], 'view')) t.view.forEach((p) => out.add(p));
    if (map[t.key] === 'edit') t.edit.forEach((p) => out.add(p));
  }
  return [...out];
}

const neverGranted = (name: string) => NEVER_GRANTED.some((p) => matchesPattern(p, name));

/** Does the map grant every required permission ("res:act")? */
export function tabAccessGrants(map: TabAccessMap, required: string[]): boolean {
  const pats = patternsFor(map);
  return required.every((r) => !neverGranted(r) && pats.some((p) => matchesPattern(p, r)));
}

/** The org's permission names the map grants (what a custom role row carries). */
export function permissionsFor(map: TabAccessMap, catalogue: readonly string[]): string[] {
  const pats = patternsFor(map);
  return catalogue.filter((n) => !neverGranted(n) && pats.some((p) => matchesPattern(p, n))).sort();
}

/** Nav modules the map opens (a custom role's allowedModules; never [] = "all"). */
export function modulesFor(map: TabAccessMap): string[] {
  const out = new Set<string>();
  for (const t of ACCESS_TABS) {
    if (atLeast(map[t.key], 'view')) t.modules.forEach((m) => out.add(m));
    if (map[t.key] === 'edit') (t.editModules ?? []).forEach((m) => out.add(m));
  }
  return [...out];
}

/** A role row's allowedModules: never [] (that reads as "every module"); no access = ['NONE']. */
export function roleModulesFor(map: TabAccessMap): string[] {
  const mods = modulesFor(map);
  return mods.length ? mods : ['NONE'];
}

/** What changed between two maps, for the Activity Log ({ Orders: "view -> edit" }). */
export function tabChanges(before: TabAccessMap | null, after: TabAccessMap | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of ACCESS_TABS) {
    const a = before ? before[t.key] : 'none';
    const b = after ? after[t.key] : 'none';
    if (a !== b) out[t.label] = `${a} -> ${b}`;
  }
  return out;
}

// ── Server routes behind each tab ────────────────────────────────────────────────────────────

/** A path rule: the tabs that open it for reads (GET) and for writes (any other method).
 *  'open' = shared, left to the route's own permission. First matching rule wins. */
type Tabs = TabKey[] | 'open';
interface PathRule {
  re: RegExp;
  read: Tabs;
  write: Tabs;
}
const r = (re: RegExp, read: Tabs, write: Tabs = read): PathRule => ({ re, read, write });

const ACCOUNTING_ONLY = /^\/(journal|journal-vouchers|bank-rec|bank-transactions|payables|payment-vouchers|recurring-journals|budgets|cost-centers|fixed-assets|close|posting-queue|contra|xero-sync|transactions|advances|airwallex|bills-inbound)(\/|$)/;

export const PATH_RULES: PathRule[] = [
  // Own account, the access endpoints (they check Admin themselves), field-app routes.
  r(/^\/access(\/|$)/, 'open'),
  r(/^\/users\/me(\/|$)/, 'open'),
  r(/^\/maintenance-reports\/(scan-context|unit|do-view|do-skip-install)(\/|$)/, 'open'),
  r(/^\/configuration\/custom-fields\/values(\/|$)/, 'open'),
  r(/^\/organizations\/(points-balance|salesmen)(\/|$)/, 'open'),
  // Org Settings
  r(/^\/(users|roles|permissions|action-log|admin|import)(\/|$)/, ['orgSettings']),
  r(/^\/(teams|org-rules|organizations|configuration|documentTemplates|job-fields)(\/|$)/, 'open', ['orgSettings']),
  r(/^\/dashboard\/calendar-style(\/|$)/, 'open', ['orgSettings']),
  r(/^\/document-numbering(\/|$)/, 'open', ['orgSettings', 'accounting']),
  // Calendar, Dashboard
  r(/^\/dashboard\/jobs-calendar(\/|$)/, ['calendar']),
  r(/^\/dashboard\/role-home(\/|$)/, ['dashboard', 'sales', 'inventory']),
  r(/^\/dashboard(\/|$)/, ['dashboard']),
  // Sales report
  r(/^\/sales-report(\/|$)/, ['salesReport']),
  r(/^\/quotation-categories(\/|$)/, ['salesReport', 'sales', 'orders', 'orgSettings'], ['orgSettings']),
  // Sales
  r(/^\/(quotation-templates|leads)(\/|$)/, ['sales']),
  r(/^\/customer-info(\/|$)/, ['sales', 'orders']),
  r(/^\/recurring-invoices(\/|$)/, ['sales', 'accounting']),
  r(/^\/documents(\/|$)/, 'open', ['sales', 'orders', 'jobs', 'accounting']),
  r(/^\/customers(\/|$)/, 'open', ['sales', 'orders', 'jobs', 'accounting', 'orgSettings']),
  // Orders (the list is Orders only; one order is also read from the jobs / calendar / report screens)
  r(/^\/orders$/, ['orders']),
  r(/^\/orders\/[^/]+\/job-photos$/, ['orders', 'jobs', 'serviceReports']),
  r(/^\/orders(\/|$)/, ['orders', 'sales', 'jobs', 'calendar', 'serviceReports', 'accounting'], ['orders']),
  // Jobs
  r(/^\/deliveries$/, ['jobs']),
  r(/^\/deliveries\/verification(\/|$)/, ['jobs']),
  r(/^\/deliveries\/order-jobs(\/|$)/, ['jobs', 'orders']),
  r(/^\/deliveries\/(order|order-dos)(\/|$)/, ['orders', 'jobs']),
  r(/^\/deliveries\/(quick-job|scheduled|scheduled-open|job-category|siteclock)(\/|$)/, ['jobs', 'calendar']),
  r(/^\/deliveries\/[^/]+\/(style|ptw|link-order|link)$/, ['jobs', 'calendar']),
  r(/^\/deliveries\/[^/]+\/job-photos$/, ['jobs', 'orders', 'serviceReports']),
  r(/^\/deliveries(\/|$)/, ['jobs', 'calendar', 'orders', 'serviceReports'], ['jobs']),
  r(/^\/job-photos(\/|$)/, ['jobs', 'orders', 'serviceReports']),
  // Service Reports (also read from the order and job pages)
  r(/^\/(maintenance-reports|maintenance-schedules)(\/|$)/, ['serviceReports', 'orders', 'jobs'], ['serviceReports']),
  // Assets, Inventory
  r(/^\/vehicles(\/|$)/, ['assets']),
  r(/^\/assets(\/|$)/, 'open', ['assets', 'inventory', 'jobs']),
  r(/^\/(inventories|price-history)(\/|$)/, 'open', ['inventory']),
  r(/^\/categories(\/|$)/, 'open', ['inventory', 'orgSettings']),
  r(/^\/suppliers(\/|$)/, 'open', ['accounting', 'inventory', 'orgSettings']),
  // Accounting (+ Reports: the statement of account)
  r(ACCOUNTING_ONLY, ['accounting']),
  r(/^\/bills(\/|$)/, ['accounting', 'inventory']),
  r(/^\/receipts(\/|$)/, ['accounting', 'sales'], ['accounting']),
  r(/^\/statements(\/|$)/, ['accounting', 'reports', 'sales']),
  r(/^\/(payments|accounting)(\/|$)/, 'open', ['accounting']),
];

/** POST endpoints that are list / read queries (house convention "POST / = list"). */
export const READ_POSTS =
  /^\/(documents(\/paginated|\/stats)?|assets|inventories(\/by-status|\/by-ids)?|customers(\/lookup)?|suppliers|projects|documentTemplates|users\/list|payments\/summary|statements\/(soa|supplier-soa)|posting-preview|maintenance-reports\/bulk-pdf|deliveries\/order-dos\/[^/]+\/lines-check)$/;

/** The tabs that open a request, and the level it needs; null = not a tab route (permission only). */
export function tabsForRequest(method: string, path: string): { tabs: TabKey[]; need: 'view' | 'edit' } | null {
  const m = String(method || 'GET').toUpperCase();
  const p = (String(path || '').split('?')[0] || '/').replace(/\/+$/, '') || '/';
  const read = m === 'GET' || m === 'HEAD' || (m === 'POST' && READ_POSTS.test(p));
  for (const rule of PATH_RULES) {
    if (!rule.re.test(p)) continue;
    const tabs = read ? rule.read : rule.write;
    return tabs === 'open' ? null : { tabs, need: read ? 'view' : 'edit' };
  }
  return null;
}

/** May a user with this map make the request? (Paths outside the rules: yes, by permission.) */
export function tabAccessAllowsRequest(map: TabAccessMap, method: string, path: string): boolean {
  const hit = tabsForRequest(method, path);
  if (!hit) return true;
  return hit.tabs.some((t) => atLeast(map[t], hit.need));
}

// ── Presets, per tab (the "final preset table") ──────────────────────────────────────────────

const preset = (m: Partial<TabAccessMap>): TabAccessMap => ({ ...noAccess(), ...m });

/**
 * The preset roles written per tab (Elroy 19 Nov: Sales = Orders edit, Jobs edit, Service
 * Reports view, Calendar; Accounting = Orders view, Accounting edit; Operations = Orders view,
 * Jobs + Service Reports + Calendar edit; Viewer = view all, no Accounting edit; the rest is the
 * presets' existing access). Admin, superadmin and field-tech are not path-checked.
 */
export const PRESET_TAB_ACCESS: Record<string, TabAccessMap> = {
  Admin: fullAccess(),
  Sales: preset({ dashboard: 'view', sales: 'edit', orders: 'edit', jobs: 'edit', serviceReports: 'view', assets: 'view', inventory: 'view', orgSettings: 'view', salesReport: 'view', calendar: 'edit' }),
  Accounting: preset({ dashboard: 'view', sales: 'edit', orders: 'view', assets: 'view', accounting: 'edit', orgSettings: 'view', salesReport: 'edit', calendar: 'view' }),
  Operations: preset({ dashboard: 'view', orders: 'view', jobs: 'edit', serviceReports: 'edit', assets: 'edit', inventory: 'view', orgSettings: 'view', calendar: 'edit' }),
  Viewer: preset({ dashboard: 'view', sales: 'view', orders: 'view', jobs: 'view', serviceReports: 'view', assets: 'view', inventory: 'view', accounting: 'view', orgSettings: 'view', reports: 'view', salesReport: 'edit', calendar: 'view' }),
};

/** Roles that are never narrowed by a tab map (platform / owner / field app). */
export const UNRESTRICTED_ROLES = new Set(['superadmin', 'Admin', 'field-tech', 'osirisadmin']);
