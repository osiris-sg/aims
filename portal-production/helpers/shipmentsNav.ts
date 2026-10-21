// Shipments navigation (round O, 2026-10-21): owner decision — no Home page for
// now, Orders is the landing page. The Home page (/portal/shipments/dashboard)
// stays in the code behind the org flag enableShipmentsHome (ADH: off). With the
// flag off the Shipments menu is Orders, Shipments, Inbox and every landing /
// redirect that used to go to Home goes to Orders instead. Shared by the top
// bar, the sidebar, the portal landing page and the Home page's own redirect.

/** The Orders list — the Shipments module's own route. */
export const SHIPMENTS_ORDERS = "/portal/shipments";
/** Shipments › Home, only with enableShipmentsHome. */
export const SHIPMENTS_HOME = "/portal/shipments/dashboard";

/** Where a trade org lands (portal root, org switch, "Shipments" in the nav). */
export function shipmentsLanding(homeEnabled: boolean): string {
  return homeEnabled ? SHIPMENTS_HOME : SHIPMENTS_ORDERS;
}

/** True when a module's submenu row is Shipments › Home and the flag is off: the menus drop it (stored row kept). */
export function hiddenShipmentsSubmenu(moduleCode: string, submenuKey: string | undefined, homeEnabled: boolean): boolean {
  return moduleCode === "SHIPMENTS" && submenuKey === "dashboard" && !homeEnabled;
}
