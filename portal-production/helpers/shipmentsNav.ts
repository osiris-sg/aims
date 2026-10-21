// Sales navigation (round P, 2026-10-21): the top-nav item reads "Sales" (the
// module's own displayName row; URLs stay /portal/shipments/*). Under it:
// Dashboard · Orders · Shipments · Inbox. The Dashboard
// (/portal/shipments/dashboard) is the landing page — portal root, org switch,
// clicking "Sales". (Round O hid the old Home and landed on Orders; the old
// Home now sits behind enableShipmentsHome at the same route, the email-first
// dashboard is the default.) Shared by the top bar, the sidebar and the portal
// landing page.

/** The Orders list — the Shipments module's own route. */
export const SHIPMENTS_ORDERS = "/portal/shipments";
/** Sales › Dashboard — the landing page. */
export const SHIPMENTS_HOME = "/portal/shipments/dashboard";

/** Where a trade org lands (portal root, org switch, "Sales" in the nav). */
export function shipmentsLanding(): string {
  return SHIPMENTS_HOME;
}

/** The Sales menu as the user sees it (labels only — keys / routes are the module's). */
export const SALES_MENU_LABELS = ["Dashboard", "Orders", "Shipments", "Inbox"] as const;
