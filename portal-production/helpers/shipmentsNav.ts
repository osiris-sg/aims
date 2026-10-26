// Sales navigation (round P, 2026-10-21): the top-nav item reads "Sales" (the
// module's own displayName row; URLs stay /portal/shipments/*). Under it:
// Dashboard · Orders · Shipments (round W: Inbox left the menu — the Dashboard is
// the email home, "See all emails" opens /portal/shipments/dashboard?view=emails). The Dashboard
// (/portal/shipments/dashboard) is the landing page — portal root, org switch,
// clicking "Sales". (Round O hid the old Home and landed on Orders; the old
// Home now sits behind enableShipmentsHome at the same route, the email-first
// dashboard is the default.) Shared by the top bar, the sidebar and the portal
// landing page.

/** The Orders list — the Shipments module's own route. */
export const SHIPMENTS_ORDERS = "/portal/shipments";
/** Sales › Dashboard — the landing page. */
export const SHIPMENTS_HOME = "/portal"; // round Z: the Sales dashboard is the portal home

/** Where a trade org lands (portal root, org switch, "Sales" in the nav). */
export function shipmentsLanding(): string {
  return SHIPMENTS_HOME;
}

/** The Sales menu as the user sees it (labels only — keys / routes are the module's). */
export const SALES_MENU_LABELS = ["Dashboard", "Orders", "Shipments"] as const;

/** Round AG added Sales › Monthly list in code; round AM made it the Orders page's Monthly view (the old URL redirects). */
export const SALES_MONTHLY_SUBMENU = { key: "monthly", label: "Monthly list" } as const;
export const SHIPMENTS_MONTHLY = "/portal/shipments/orders?view=monthly";
/** The Sales submenus without Monthly list (dropped even if a stored module row has it). */
export function withoutSalesMonthly<T extends string | { key?: string; label?: string }>(subMenus: readonly T[]): T[] {
  return subMenus.filter((s) => (typeof s === "string" ? s : s?.key) !== SALES_MONTHLY_SUBMENU.key);
}

/**
 * Round AM: "Clients" — its own top-level item right after Sales, for SHIPMENTS orgs only (added in code, no module
 * row). Customers · Suppliers. Routes sit under /portal/shipments so the SHIPMENTS route guard covers them.
 */
export const CLIENTS_ROUTE = "/portal/shipments/clients";
export const CLIENTS_LABELS = { en: { top: "Clients", customers: "Customers", suppliers: "Suppliers" }, ja: { top: "取引先", customers: "顧客", suppliers: "仕入先" } } as const;
export function clientsNavModule(lang: "en" | "ja", salesSortOrder: number) {
  const L = CLIENTS_LABELS[lang];
  return {
    moduleCode: "CLIENTS",
    displayName: L.top,
    enabled: true,
    icon: "PeopleRounded",
    sortOrder: salesSortOrder + 0.5,
    config: { route: CLIENTS_ROUTE, subMenus: [{ key: "customers", label: L.customers }, { key: "suppliers", label: L.suppliers }] },
  };
}
/** Sales (route /portal/shipments) is not the active item on a Clients page. */
export const isClientsPath = (path: string | null | undefined) => !!path && (path === CLIENTS_ROUTE || path.startsWith(`${CLIENTS_ROUTE}/`));
/** The browser's UI language for nav labels (Japanese or English). */
export const navLangOf = (navigatorLanguage: string | null | undefined): "en" | "ja" => (/^ja\b/i.test(navigatorLanguage ?? "") ? "ja" : "en");

/** The full two-tab email view (Unprocessed / Processed) — a Dashboard sub-view since round W. */
export const SHIPMENTS_EMAILS = "/portal?view=emails";

/** Sales (SHIPMENTS) submenu keys that never show, whatever the stored module row says (round W: `inbox`). */
export const RETIRED_SALES_SUBMENUS: ReadonlySet<string> = new Set(["inbox"]);

/** Drops the retired Sales submenus (Inbox) from a stored submenu list — the sidebar and the top bar use it. */
export function visibleSalesSubmenus<T extends string | { key?: string }>(subMenus: readonly T[]): T[] {
  return subMenus.filter((s) => !RETIRED_SALES_SUBMENUS.has(typeof s === "string" ? s : String(s?.key ?? "")));
}
