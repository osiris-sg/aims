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
    allowedModules: ['DASHBOARD', 'SALES', 'CUSTOMERS', 'MASTERFILES', 'INVENTORY', 'DELIVERIES', 'MAINTENANCE'],
    permissions: [
      'dashboard:read',
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
    allowedModules: ['DASHBOARD', 'ACCOUNTING', 'SALES', 'CUSTOMERS', 'SUPPLIERS', 'MASTERFILES'],
    permissions: [
      'dashboard:read',
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
    allowedModules: ['DASHBOARD', 'DELIVERIES', 'MAINTENANCE', 'INVENTORY', 'CUSTOMERS', 'MASTERFILES'],
    permissions: [
      'dashboard:read',
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
    allowedModules: ['DASHBOARD', 'SALES', 'INVENTORY', 'DELIVERIES', 'MAINTENANCE', 'ACCOUNTING', 'CUSTOMERS', 'SUPPLIERS', 'MASTERFILES'],
    permissions: READ_ALL,
  },
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
