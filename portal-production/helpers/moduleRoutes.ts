// Module route guard (round Y, 2026-10-22): which module a portal path belongs
// to, so a page an org does not have is never rendered under that org (a deep
// link to /portal/shipments/orders while "viewing as" Biofuel, an org switch
// made on an Accounting page, …). Pure — ModuleRouteGuard applies it; the
// tests are helpers/moduleRoutes.test.mjs.

export interface RoutedModule {
  moduleCode: string;
  enabled: boolean;
  config?: { route?: string } | null;
}

/** Sales (SHIPMENTS) owns these hubs whatever the module rows say — trade
 *  documents are set per org via the DOCUMENTS row, which must not claim them. */
const SHIPMENTS_PREFIXES = ["/portal/shipments", "/portal/trade-documents"] as const;
const SHIPMENTS_CODE = "SHIPMENTS";
/** The generic home route — every portal path is "under" it, so it never claims one. */
const HOME_ROUTE = "/portal";
/** Admin is its own gate (osiris-admin only), not a per-org module. */
const IGNORED_CODES: ReadonlySet<string> = new Set(["ADMIN"]);
/** Where an org with Sales lands; everyone else stays on the portal home. */
const SHIPMENTS_LANDING = "/portal/shipments/dashboard";

/** True when `pathname` is `route` itself or lies under it ("/x" matches "/x" and "/x/y", not "/xy"). */
function underRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Strips a query / hash and a trailing slash so "/portal/accounting/?x=1" reads as "/portal/accounting". */
function normalise(pathname: string): string {
  const bare = pathname.split(/[?#]/, 1)[0] ?? "";
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

/**
 * The module a portal path belongs to: SHIPMENTS for the Sales hubs, otherwise
 * the module whose `config.route` is the longest prefix of the path. `null`
 * when nothing claims it (/portal itself, /portal/settings, /portal/chat…).
 */
export function requiredModuleFor(pathname: string, modules: readonly RoutedModule[]): string | null {
  const path = normalise(pathname);
  if (SHIPMENTS_PREFIXES.some((p) => underRoute(path, p))) return SHIPMENTS_CODE;

  let best: { code: string; length: number } | null = null;
  for (const m of modules) {
    if (!m || IGNORED_CODES.has(m.moduleCode)) continue;
    const route = normalise(String(m.config?.route ?? ""));
    if (!route || route === HOME_ROUTE || !underRoute(path, route)) continue;
    if (!best || route.length > best.length) best = { code: m.moduleCode, length: route.length };
  }
  return best?.code ?? null;
}

/** True when the path needs no module, or the module it needs is enabled. */
export function isPathAllowed(pathname: string, modules: readonly RoutedModule[]): boolean {
  const code = requiredModuleFor(pathname, modules);
  if (code === null) return true;
  return modules.some((m) => m.moduleCode === code && m.enabled);
}

/** Where this org lands: Sales › Dashboard with the Shipments module, the portal home otherwise. */
export function landingFor(modules: readonly RoutedModule[]): string {
  return modules.some((m) => m.moduleCode === SHIPMENTS_CODE && m.enabled) ? SHIPMENTS_LANDING : HOME_ROUTE;
}
