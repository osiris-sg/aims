/**
 * Canonical catalog of every module the app knows about. Single source of truth
 * for which modules exist app-wide — the mirror image of FEATURE_FLAG_DEFAULTS on
 * the frontend (portal-production/app/portal/hooks/useOrganizationFeatures.ts).
 *
 * Modules are stored per-org as rows in OrganizationModule, but an org only ever
 * sees a module if a row exists for it. To make a new module appear for EVERY org,
 * add it here and it will surface (via mergeModulesWithCatalog) in every org's
 * admin panel — no per-org backfill scripts needed. The stored row, when present,
 * overrides the catalog so each org keeps its own enabled/customisations.
 *
 * `defaultEnabled` is the on/off value used for orgs that have never configured the
 * module (no DB row yet). NEW modules should be `false` (opt-in): they show up
 * disabled everywhere, and each org's admin turns them on from the Modules tab.
 */
export interface CatalogModule {
  moduleCode: string;
  displayName: string;
  icon: string;
  sortOrder: number;
  defaultEnabled: boolean;
  config: Record<string, any>;
}

export const MODULE_CATALOG: CatalogModule[] = [
  {
    moduleCode: 'DASHBOARD',
    displayName: 'Dashboard',
    icon: 'Dashboard',
    sortOrder: 0,
    defaultEnabled: true,
    config: { route: '/portal' },
  },
  {
    moduleCode: 'INVENTORY',
    displayName: 'Inventory',
    icon: 'Inventory',
    sortOrder: 1,
    defaultEnabled: true,
    config: {
      route: '/portal/inventory',
      subMenus: [
        { key: 'products', label: 'Products' },
        { key: 'purchases', label: 'Purchases' },
        { key: 'purchases-return', label: 'Purchases Return' },
        { key: 'adjustment-in', label: 'Stock Adjustment In' },
        { key: 'adjustment-out', label: 'Stock Adjustment Out' },
        { key: 'reports', label: 'Reports' },
        { key: 'stock-card', label: 'Stock Card' },
      ],
    },
  },
  {
    moduleCode: 'SALES',
    displayName: 'Sales',
    icon: 'ShoppingCart',
    sortOrder: 2,
    defaultEnabled: true,
    config: {
      route: '/portal/sales',
      subMenus: [
        { key: 'quotations', label: 'Quotation' },
        { key: 'sales-orders', label: 'Sales Order' },
        { key: 'delivery-orders', label: 'Delivery Order' },
        { key: 'invoices', label: 'Invoice' },
        { key: 'debit-notes', label: 'Debit Note' },
        { key: 'credit-notes', label: 'Credit Note' },
        { key: 'stock-card', label: 'Stock Card' },
      ],
    },
  },
  {
    moduleCode: 'CUSTOMERS',
    displayName: 'Customers',
    icon: 'PeopleRounded',
    sortOrder: 3,
    defaultEnabled: true,
    config: { route: '/portal/customers' },
  },
  {
    moduleCode: 'PROJECTS',
    displayName: 'Projects',
    icon: 'AccountTree',
    sortOrder: 4,
    defaultEnabled: true,
    config: { route: '/portal/projects' },
  },
  {
    moduleCode: 'ORDERS',
    displayName: 'Orders',
    icon: 'Receipt',
    sortOrder: 5,
    defaultEnabled: true,
    config: { route: '/portal/orders' },
  },
  {
    moduleCode: 'DOCUMENTS',
    displayName: 'Documents',
    icon: 'Description',
    sortOrder: 6,
    defaultEnabled: true,
    config: {
      route: '/portal/documents',
      subMenus: ['templates', 'extraction'],
    },
  },
  {
    moduleCode: 'INVOICES',
    displayName: 'Invoices',
    icon: 'AssignmentRounded',
    sortOrder: 7,
    defaultEnabled: true,
    config: { route: '/portal/invoices' },
  },
  {
    moduleCode: 'USER_MANAGEMENT',
    displayName: 'User Management',
    icon: 'PeopleRounded',
    sortOrder: 8,
    defaultEnabled: true,
    config: {
      route: '/portal/user-management',
      subMenus: ['users', 'roles'],
    },
  },
  {
    moduleCode: 'AUDIT',
    displayName: 'Audit',
    icon: 'AnalyticsRounded',
    sortOrder: 9,
    defaultEnabled: true,
    config: { route: '/portal/audit' },
  },
  {
    moduleCode: 'ACCOUNTING',
    displayName: 'Accounting',
    icon: 'AccountBalance',
    sortOrder: 10,
    defaultEnabled: true,
    config: {
      route: '/portal/accounting',
      subMenus: [
        // Collapsed from 8 legacy report pages → 3 focused entries. The Reports
        // sub-page hosts the old GL / TB / P&L / BS / GST / Audit pages as tabs
        // so they remain reachable but don't pollute the nav.
        { key: 'list', label: 'Dashboard' },
        { key: 'ledger', label: 'General Ledger' },
        { key: 'receivables', label: 'Accounts Receivable' },
        { key: 'payables', label: 'Accounts Payable' },
        { key: 'reports', label: 'Reports' },
        { key: 'setup', label: 'Setup', href: '/portal/settings/accounting-setup' },
      ],
    },
  },
  // Optional / opt-in modules — off until an org enables them.
  {
    moduleCode: 'ASSETS',
    displayName: 'Assets',
    icon: 'AnalyticsRounded',
    sortOrder: 11,
    defaultEnabled: false,
    config: { route: '/portal/assets' },
  },
  {
    moduleCode: 'ANALYTICS',
    displayName: 'Analytics',
    icon: 'Analytics',
    sortOrder: 12,
    defaultEnabled: false,
    config: { route: '/portal/analytics' },
  },
  {
    moduleCode: 'INTEGRATIONS',
    displayName: 'Integrations',
    icon: 'Extension',
    sortOrder: 13,
    defaultEnabled: false,
    config: { route: '/portal/integrations' },
  },
  {
    moduleCode: 'CRM',
    displayName: 'CRM',
    icon: 'SupportAgent',
    sortOrder: 14,
    defaultEnabled: false,
    config: {
      route: '/portal/crm',
      subMenus: [
        { key: 'whatsapp', label: 'WhatsApp' },
        { key: 'agent', label: 'AI Agent' },
        { key: 'suggestions', label: 'Suggestions' },
      ],
    },
  },
  {
    moduleCode: 'ADMIN',
    displayName: 'Admin Panel',
    icon: 'AdminPanelSettings',
    sortOrder: 100,
    defaultEnabled: true,
    config: {
      route: '/portal/admin',
      permissions: ['admin:access', 'configuration:read', 'configuration:write'],
    },
  },
];

/** Look up a catalog entry by module code. */
export function getCatalogModule(moduleCode: string): CatalogModule | undefined {
  return MODULE_CATALOG.find((m) => m.moduleCode === moduleCode);
}

/**
 * Merge an org's persisted OrganizationModule rows over the canonical catalog so
 * the org sees every known module. A stored row wins over the catalog entry
 * (preserving per-org enabled/displayName/icon/config); catalog modules with no
 * row appear as virtual entries using `defaultEnabled`. Rows whose moduleCode is
 * not in the catalog (custom per-org modules) are kept as-is. The shape matches
 * the frontend ModuleConfig so it drops straight into /configuration/complete.
 */
export function mergeModulesWithCatalog<
  T extends { moduleCode: string; sortOrder?: number | null }
>(dbRows: T[]): Array<T | (CatalogModule & { id: string; enabled: boolean; isCatalogDefault: true })> {
  const byCode = new Map(dbRows.map((r) => [r.moduleCode, r] as [string, T]));
  const merged: Array<any> = [];

  for (const cat of MODULE_CATALOG) {
    const row = byCode.get(cat.moduleCode);
    if (row) {
      merged.push(row);
      byCode.delete(cat.moduleCode);
    } else {
      merged.push({
        id: `catalog:${cat.moduleCode}`,
        moduleCode: cat.moduleCode,
        enabled: cat.defaultEnabled,
        displayName: cat.displayName,
        icon: cat.icon,
        sortOrder: cat.sortOrder,
        config: cat.config,
        // Flags an entry that has no stored row yet (visible everywhere, not
        // yet persisted). Toggling it in the admin panel creates the real row.
        isCatalogDefault: true,
      });
    }
  }

  // Keep any custom per-org modules that aren't part of the catalog.
  for (const row of byCode.values()) merged.push(row);

  merged.sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.moduleCode.localeCompare(b.moduleCode)
  );

  return merged;
}
