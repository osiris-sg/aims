"use client";

// The modules + submenus this user can navigate to, with the same visibility
// rules as the top bar (org modules ∩ role allowedModules, adminOnly and
// role-gated submenus, hidden legacy modules, flag-injected submenus). Shared
// by TopNavBar and the chat home, so the assistant can only open screens the
// bar itself would show.

import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { showAccountingSetup, showShippingSettings, shownInMenu } from "@/helpers/settingsVisibility";
import { useEffect, useState } from "react";
import { clientsNavModule, navLangOf, visibleSalesSubmenus, withoutSalesMonthly } from "@/helpers/shipmentsNav";

// Mirrors DynamicSidebarContent — keep the two in sync.
const HIDDEN_MODULES = new Set<string>(["CUSTOMERS", "SUPPLIERS"]);
const HIDDEN_SUBMENUS: Record<string, string[]> = {
  INVENTORY: ["products", "list"],
  // User Management → Roles retired (guru 2026-10-28): roles are picked on the
  // user itself. Hidden here so orgs whose stored subMenus still carry it
  // don't show it.
  USER_MANAGEMENT: ["roles"],
};
const ORDER_OVERRIDE: Record<string, number> = { SALES: 0.5 };

// Secondary group — mirrors the sidebar's "Organization Settings" block
// (company profile / accounting setup / Master Files hub). Accounting Setup is
// dropped only for trade orgs (showAccountingSetup), same as the sidebar.
export const SETTINGS_MENU = [
  { label: "Company Profile", path: "/portal/settings/company-profile" },
  { label: "Shipping & documents", path: "/portal/settings/shipping" },
  // Customer profiles (billing mode, port, trucks, templates) — Shipments orgs only.
  { label: "Customers", path: "/portal/settings/customers" },
  { label: "Accounting Setup", path: "/portal/settings/accounting-setup" },
  { label: "Master Files", path: "/portal/masterfiles" },
];

const ADMIN_ROLES = ["superadmin", "admin", "osirisadmin"];
// Org administration is master-tier only (hierarchy access, guru 2026-09-25).
const SCOPED_ROLES = ["Designer", "Junior Manager", "Senior Manager"];

export interface NavScreen {
  label: string;
  path: string;
  module: string;
}

// Same submenu-route rules as the sidebar.
export function resolveSubmenuRoute(module: any, submenu: any): string {
  if (typeof submenu === "object" && submenu?.href) return submenu.href;
  const submenuKey = typeof submenu === "string" ? submenu : submenu.key;
  if (submenuKey === "list") return module.config.route;
  if (submenuKey === "extraction" && module.moduleCode === "DOCUMENTS") return "/portal/document-extraction";
  return `${module.config.route}/${submenuKey}`;
}

export const submenuLabel = (s: any) => (typeof s === "string" ? s : s?.label || s?.key || "");

export function useNavModules() {
  const { modules, isModuleEnabled } = useConfiguration();
  const { isModuleAllowed, userRoles, hasPermission } = useUserPermissions();
  // Same rule as DynamicSidebarContent's Organization Settings group.
  const settingsMenu = SETTINGS_MENU.filter(
    (s) =>
      (s.path !== "/portal/settings/accounting-setup" || showAccountingSetup(isModuleEnabled)) &&
      ((s.path !== "/portal/settings/shipping" && s.path !== "/portal/settings/customers") || showShippingSettings(isModuleEnabled)),
  );
  const { isAdsInsightsEnabled, isMaintenanceDatesEnabled, isPostingQueueEnabled } = useOrganizationFeatures();

  const isAdminUser =
    userRoles.length === 0 ||
    userRoles.some((r: any) => ADMIN_ROLES.includes((r?.name || "").toLowerCase()));
  const isMasterTier = userRoles.length === 0 || userRoles.some((r: any) => !SCOPED_ROLES.includes(r?.name));

  const orderKey = (m: any) => ORDER_OVERRIDE[m.moduleCode] ?? m.sortOrder ?? 999;
  const [lang, setLang] = useState<"en" | "ja">("en");
  useEffect(() => setLang(navLangOf(typeof navigator !== "undefined" ? navigator.language : null)), []);
  const built = (modules || [])
    .filter((m: any) => m.enabled)
    .filter((m: any) => isModuleAllowed(m.moduleCode))
    .filter((m: any) => !HIDDEN_MODULES.has(m.moduleCode))
    .filter((m: any) => shownInMenu(m))
    .map((m: any) => {
      const hide = HIDDEN_SUBMENUS[m.moduleCode];
      const rawSubMenus = (m.config as any)?.subMenus;
      if (!Array.isArray(rawSubMenus)) return m;
      // Round AM: Sales › Monthly list is the Orders page's Monthly view now — never a menu item.
      const subMenus = m.moduleCode === "SHIPMENTS" ? withoutSalesMonthly(rawSubMenus) : rawSubMenus;
      const filtered = subMenus.filter((s: any) => {
        if (typeof s === "object" && s?.adminOnly && !isAdminUser) return false;
        const key = typeof s === "string" ? s : s?.key;
        // CRM → Marketing rides on the enableAdsInsights org flag.
        if (key === "marketing" && m.moduleCode === "CRM" && !isAdsInsightsEnabled) return false;
        // Accounting → Posting Queue rides on the enablePostingQueue org flag (guru 2026-10-24).
        if (key === "posting-queue" && m.moduleCode === "ACCOUNTING" && !isPostingQueueEnabled) return false;
        // Round P: every Sales (Shipments) submenu shows — Dashboard · Orders · Shipments — except the retired
        // ones (round W: Inbox left the menu; the Dashboard hosts the emails now), whatever the DB row says.
        if (m.moduleCode === "SHIPMENTS" && visibleSalesSubmenus([s]).length === 0) return false;
        // Role-gated submenu (guru 2026-09-28). Admin-ish users always pass.
        if (typeof s === "object" && Array.isArray(s.roles) && userRoles.length > 0 && !isAdminUser) {
          if (!userRoles.some((r: any) => s.roles.includes(r?.name))) return false;
        }
        return !hide?.includes(key);
      });
      // Service Reports -> Maintenance Dates rides on the enableMaintenanceDates flag.
      if (
        m.moduleCode === "MAINTENANCE" &&
        isMaintenanceDatesEnabled &&
        !filtered.some((s: any) => (typeof s === "string" ? s : s?.key) === "dates")
      ) {
        filtered.push({ key: "dates", label: "Maintenance Dates" });
      }
      return { ...m, config: { ...(m.config as any), subMenus: filtered } };
    });
  // Round AM: "Clients" right after Sales for orgs whose menu has the SHIPMENTS module (Sales).
  const sales = built.find((m: any) => m.moduleCode === "SHIPMENTS");
  const navModules = [...built, ...(sales ? [clientsNavModule(lang, orderKey(sales))] : [])].sort((a: any, b: any) => orderKey(a) - orderKey(b));

  // Flat list of every screen the user can reach: module roots + submenus +
  // the settings group. This is what the chat assistant is allowed to open.
  const screens: NavScreen[] = [];
  for (const m of navModules) {
    const route: string = m.config?.route || "";
    const label: string = m.displayName || m.moduleCode;
    if (route && route !== "/portal") screens.push({ label, path: route, module: m.moduleCode });
    for (const s of (m.config as any)?.subMenus || []) {
      const path = resolveSubmenuRoute(m, s);
      if (!screens.some((x) => x.path === path)) screens.push({ label: `${label} › ${submenuLabel(s)}`, path, module: m.moduleCode });
    }
  }
  if (isMasterTier) for (const s of settingsMenu) screens.push({ label: `Org Settings › ${s.label}`, path: s.path, module: "SETTINGS" });

  return { navModules, screens, settingsMenu, isAdminUser, isMasterTier, userRoles, hasPermission };
}
