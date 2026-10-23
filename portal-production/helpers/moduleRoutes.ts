// Module route guard (round Y, 2026-10-22; narrowed by the 2026-10-23 hotfix):
// which module a portal path belongs to, so a page an org does not have is
// never rendered under that org. Only the Sales (SHIPMENTS) hubs are guarded:
// /portal/shipments/* and /portal/trade-documents/*. Every other portal path
// needs nothing here. Matching the other modules by their config.route was
// wrong: shared pages live under routes that belong to a module the org may
// have off (every document editor is /portal/documents/<TYPE>/…, so an
// invoice detail page was treated as the DOCUMENTS module and an org with
// Documents off was bounced to /portal). Modules are matched by CODE only,
// never by display name. Pure — ModuleRouteGuard applies it; the tests are
// helpers/moduleRoutes.test.mjs.

export interface RoutedModule {
  moduleCode: string;
  enabled: boolean;
  config?: { route?: string } | null;
}

/** Sales (SHIPMENTS) owns these hubs whatever the module rows say — trade
 *  documents are set per org via the DOCUMENTS row, which must not claim them. */
const SHIPMENTS_PREFIXES = ["/portal/shipments", "/portal/trade-documents"] as const;
const SHIPMENTS_CODE = "SHIPMENTS";
/** The generic home route. */
const HOME_ROUTE = "/portal";
/** Where an org with Sales lands; everyone else stays on the portal home. */
const SHIPMENTS_LANDING = "/portal"; // round Z: the Sales dashboard renders at the portal home

/** True when `pathname` is `route` itself or lies under it ("/x" matches "/x" and "/x/y", not "/xy"). */
function underRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Strips a query / hash and a trailing slash so "/portal/shipments/?x=1" reads as "/portal/shipments". */
function normalise(pathname: string): string {
  const bare = pathname.split(/[?#]/, 1)[0] ?? "";
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

/**
 * The module a portal path belongs to: SHIPMENTS for the Sales hubs, `null`
 * for every other path (nothing else is guarded by route). The module list is
 * accepted for call-site compatibility and not consulted.
 */
export function requiredModuleFor(pathname: string, _modules: readonly RoutedModule[]): string | null {
  const path = normalise(pathname);
  return SHIPMENTS_PREFIXES.some((p) => underRoute(path, p)) ? SHIPMENTS_CODE : null;
}

/** True when the path needs no module, or the module it needs is enabled (matched by module code). */
export function isPathAllowed(pathname: string, modules: readonly RoutedModule[]): boolean {
  const code = requiredModuleFor(pathname, modules);
  if (code === null) return true;
  return modules.some((m) => m.moduleCode === code && m.enabled);
}

/** Where this org lands: Sales › Dashboard with the Shipments module, the portal home otherwise. */
export function landingFor(modules: readonly RoutedModule[]): string {
  return modules.some((m) => m.moduleCode === SHIPMENTS_CODE && m.enabled) ? SHIPMENTS_LANDING : HOME_ROUTE;
}
