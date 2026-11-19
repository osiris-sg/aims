/**
 * ROLE PRESETS (guru 2026-10-27, piloted on WCT, meant for every org).
 *
 * A client never sees permissions. Each org gets the same handful of roles
 * with built-in permissions; User Management only asks "which role". The
 * presets are materialised into the org's Role rows by
 * scripts/apply-role-presets.ts (idempotent — re-run after the permission
 * catalogue grows), and the portal hides the Roles / Permissions editor when
 * the org's `enableRolePresets` flag is on.
 *
 * Permission patterns are resolved against the org's catalogue at apply time:
 *   "customers:*"        every action on the resource
 *   "documents:read-*"   every action starting with read-
 *   "journal:post"       one exact permission
 * A pattern that matches nothing is skipped (the catalogue differs per env).
 *
 * The role NAME is what the app keys on ('field-tech' is checked by name in
 * the field guard and push service, so it keeps its name); `label` is what
 * the client sees. `description` is stored on the row with the "Preset · "
 * prefix — that prefix is how the portal tells a preset from a hand-made role.
 */
export interface RolePreset {
  /** Role.name — stable, matched case-sensitively. */
  name: string;
  /** What the client sees in the role picker. */
  label: string;
  /** One line on what the role can do. */
  summary: string;
  /** Nav modules the role may see; [] = every module the org has on. */
  allowedModules: string[];
  /** Permission patterns (see the file header). */
  permissions: string[];
  /** Patterns removed AFTER the includes resolve (Admin minus role editing). */
  exclude?: string[];
}

export const PRESET_PREFIX = 'Preset · ';

/** Everything that reads. */
const READ_ALL = ['*:read', '*:read-*', 'dashboard:read', 'statements:read'];

export const ROLE_PRESETS: RolePreset[] = [
  {
    name: 'Admin',
    label: 'Admin',
    summary: 'Runs the whole system: every page, every document, users and settings. Cannot change roles.',
    allowedModules: [],
    permissions: ['*:*'],
    exclude: ['permissions:*', 'roles:create', 'roles:update', 'roles:delete', 'organizations:create', 'organizations:delete'],
  },
  {
    name: 'Sales',
    label: 'Sales',
    summary: 'Customers, quotations, delivery orders and invoices. No accounting.',
    allowedModules: ['DASHBOARD', 'SALES', 'ORDERS', 'CUSTOMERS', 'MASTERFILES', 'INVENTORY', 'DELIVERIES', 'MAINTENANCE'],
    permissions: [
      'dashboard:read',
      // Round 25 (Elroy 19 Nov): Orders edit, Jobs edit (job cancel / delete / assign need
      // maintenance-reports:create, which the API shares with service report writes).
      'orders:read',
      'orders:create',
      'orders:update',
      'maintenance-reports:create',
      'customers:*',
      'customer-info:*',
      'documents:*',
      'document-extraction:*',
      'documentTemplates:read',
      'documentTemplates:read-one',
      'assets:read',
      'assets:read-*',
      'assets:check-sku',
      'inventories:read',
      'inventories:read-*',
      'categories:read',
      'categories:read-one',
      'projects:read',
      'projects:read-one',
      'maintenance-reports:read',
      'payments:read',
      'timeline-items:read-*',
      'uploads:upload-image',
    ],
  },
  {
    name: 'Accounting',
    label: 'Accounting',
    summary: 'Ledger, receivables, payables, bills, bank reconciliation and reports. Reads sales documents.',
    allowedModules: ['DASHBOARD', 'ACCOUNTING', 'SALES', 'ORDERS', 'CUSTOMERS', 'SUPPLIERS', 'MASTERFILES'],
    permissions: [
      'dashboard:read',
      // Round 25: Orders view (the order page lists its service reports).
      'orders:read',
      'maintenance-reports:read',
      'accounting:*',
      'journal:*',
      'bills:*',
      'bankrec:*',
      'payments:*',
      'statements:read',
      'transactions:*',
      'xerosync:*',
      'documents:read',
      'documents:read-*',
      'documents:update',
      'documents:send-email',
      'documents:payment-summary',
      'documents:generate-pdf',
      'documents:create-revision',
      'documentTemplates:read',
      'documentTemplates:read-one',
      'customers:read',
      'customers:read-one',
      'customers:update',
      'suppliers:*',
      'timeline-items:read-*',
      'uploads:upload-image',
    ],
  },
  {
    name: 'Operations',
    label: 'Operations',
    summary: 'Schedules deliveries and service jobs, sees stock and service reports.',
    // CALENDAR (round 30): the Jobs > Calendar tab for a role without Sales (enableCustomAccess orgs).
    allowedModules: ['DASHBOARD', 'ORDERS', 'DELIVERIES', 'MAINTENANCE', 'INVENTORY', 'CUSTOMERS', 'MASTERFILES', 'CALENDAR'],
    permissions: [
      'dashboard:read',
      // Round 25: Orders view. Round 30 (Elroy 20 Nov): Jobs edit = update on jobs and DOs only
      // (deliveries:update: complete / verify / reject a job, complete / save a DO, its sign link;
      // the routes take it through @AltPermissions), never documents:update for every document type.
      'orders:read',
      'deliveries:update',
      'field-scan:access',
      'maintenance-reports:*',
      'assets:create-basic',
      'assets:create-child',
      'customers:create-by-name',
      'projects:create-by-name',
      'projects:add-assignments',
      'documents:read',
      'documents:read-*',
      'documents:create-basic',
      'documents:generate-pdf',
      'assets:read',
      'assets:read-*',
      'assets:check-sku',
      'assets:bind-nfc-tag',
      'inventories:read',
      'inventories:read-*',
      'customers:read',
      'customers:read-one',
      'customer-info:read',
      'projects:read',
      'projects:read-one',
      'categories:read',
      'categories:read-one',
      'timeline-items:create',
      'timeline-items:read-*',
      'uploads:upload-image',
    ],
  },
  {
    name: 'field-tech',
    label: 'Technician (field app)',
    summary: 'Uses the SiteJobs field app only: deliveries, service jobs and service reports.',
    allowedModules: [],
    permissions: [
      'field-scan:access',
      'maintenance-reports:*',
      // The field app's ad-hoc flows create a basic asset / child unit, a
      // customer by name and a project assignment on the spot.
      'assets:create-basic',
      'assets:create-child',
      'customers:create-by-name',
      'projects:create-by-name',
      'projects:add-assignments',
      'assets:read',
      'assets:read-*',
      'assets:check-sku',
      'assets:bind-nfc-tag',
      'customers:read',
      'customers:read-one',
      'customer-info:read',
      'categories:read',
      'categories:read-one',
      'projects:read',
      'projects:read-one',
      'uploads:upload-image',
    ],
  },
  {
    name: 'Viewer',
    label: 'Viewer',
    summary: 'Read-only across the system. Cannot create or change anything.',
    // Round 25: view all (Orders added; no edit anywhere).
    allowedModules: ['DASHBOARD', 'SALES', 'ORDERS', 'INVENTORY', 'DELIVERIES', 'MAINTENANCE', 'ACCOUNTING', 'CUSTOMERS', 'SUPPLIERS', 'MASTERFILES', 'ASSETS', 'REPORTS'],
    permissions: READ_ALL,
  },
];

/**
 * Round 25 (Elroy 19 Nov) on EXISTING role rows: what scripts/wct-r25-preset-fix.ts adds to (or
 * removes from) each preset role, keeping the role's other access (some orgs narrowed a preset's
 * modules by hand, e.g. YMM's Accounting = [ACCOUNTING]; those narrowings stay). Modules the org
 * has switched off are not added.
 *   add       permission patterns to add
 *   modules   nav modules to add
 *   onlyReads Viewer: every read in the catalogue, and anything that is not a read is removed
 */
export interface PresetFix {
  add: string[];
  modules: string[];
  onlyReads?: boolean;
}
export const PRESET_FIXES: Record<string, PresetFix> = {
  Sales: { add: ['orders:read', 'orders:create', 'orders:update', 'maintenance-reports:create'], modules: ['ORDERS'] },
  Accounting: { add: ['orders:read', 'maintenance-reports:read'], modules: ['ORDERS'] },
  Operations: { add: ['orders:read', 'deliveries:update'], modules: ['ORDERS', 'CALENDAR'] },
  Viewer: { add: READ_ALL, modules: ['DASHBOARD', 'SALES', 'ORDERS', 'INVENTORY', 'DELIVERIES', 'MAINTENANCE', 'ACCOUNTING', 'CUSTOMERS', 'SUPPLIERS', 'MASTERFILES', 'ASSETS', 'REPORTS'], onlyReads: true },
};

/** A Viewer-safe permission: one READ_ALL matches. */
export const isReadPermission = (name: string) => READ_ALL.some((p) => matchesPattern(p, name));

/** The change a fix makes to one role row: permissions / modules added and removed. */
export function planPresetFix(
  fix: PresetFix,
  role: { permissions: string[]; allowedModules: string[] },
  catalogue: readonly string[],
  orgModulesOn: readonly string[],
): { addPerms: string[]; removePerms: string[]; addModules: string[] } {
  const have = new Set(role.permissions);
  const addPerms = catalogue.filter((n) => !have.has(n) && fix.add.some((p) => matchesPattern(p, n))).sort();
  const removePerms = fix.onlyReads ? role.permissions.filter((n) => !isReadPermission(n)).sort() : [];
  // [] = every module already: nothing to add.
  const mods = role.allowedModules ?? [];
  const addModules = mods.length === 0 ? [] : fix.modules.filter((m) => !mods.includes(m) && (orgModulesOn.includes(m) || PSEUDO_MODULES.has(m)));
  return { addPerms, removePerms, addModules };
}

/** Module codes that are no org module row, only a grant on the role (CALENDAR: Jobs > Calendar). */
export const PSEUDO_MODULES = new Set(['CALENDAR']);

/** Permissions a fix needs that may not be in an org's catalogue yet (created by the fix script). */
export const NEW_PERMISSIONS: Array<{ name: string; resource: string; action: string; description: string }> = [
  { name: 'deliveries:update', resource: 'deliveries', action: 'update', description: 'Update jobs and delivery orders only (complete, verify, reject, save a DO, its sign link)' },
];

/** Does `pattern` ("res:act", with * on either side) match a permission name? */
export function matchesPattern(pattern: string, name: string): boolean {
  const [pr, pa] = pattern.split(':');
  const [nr, na] = name.split(':');
  if (pr === undefined || pa === undefined || nr === undefined || na === undefined) return false;
  const part = (p: string, v: string) => (p === '*' ? true : p.endsWith('*') ? v.startsWith(p.slice(0, -1)) : p === v);
  return part(pr, nr) && part(pa, na);
}

/** The permission names a preset resolves to against a catalogue. */
export function resolvePresetPermissions(preset: RolePreset, catalogue: readonly string[]): string[] {
  const picked = new Set<string>();
  for (const name of catalogue) if (preset.permissions.some((p) => matchesPattern(p, name))) picked.add(name);
  for (const name of [...picked]) if ((preset.exclude ?? []).some((p) => matchesPattern(p, name))) picked.delete(name);
  return [...picked].sort();
}

export const presetDescription = (p: RolePreset) => `${PRESET_PREFIX}${p.label} — ${p.summary}`;
