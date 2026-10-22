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

/** The full two-tab email view (Unprocessed / Processed) — a Dashboard sub-view since round W. */
export const SHIPMENTS_EMAILS = "/portal?view=emails";

/** Sales (SHIPMENTS) submenu keys that never show, whatever the stored module row says (round W: `inbox`). */
export const RETIRED_SALES_SUBMENUS: ReadonlySet<string> = new Set(["inbox"]);

/** Drops the retired Sales submenus (Inbox) from a stored submenu list — the sidebar and the top bar use it. */
export function visibleSalesSubmenus<T extends string | { key?: string }>(subMenus: readonly T[]): T[] {
  return subMenus.filter((s) => !RETIRED_SALES_SUBMENUS.has(typeof s === "string" ? s : String(s?.key ?? "")));
}
