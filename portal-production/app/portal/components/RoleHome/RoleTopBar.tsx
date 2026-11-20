"use client";

// The role-home top bar (guru 2026-11-06: "change the top navbar also, also
// the font"). This is the mock-up's bar, not the Xero-style dark one: a white
// 64px bar with the AIMS mark, AIMEE beside it, the module menu (see below), and
// the profile chip on the right carrying the role switcher.
//
// What it LOOKS like is the mock-up's; what it CONTAINS is the normal AIMS
// menu, item for item (guru 2026-11-06: "make the navigation the same as how
// we do it now"): every module from useNavModules(), then Org Settings — same
// list, order, routes and permission rules as TopNavBar. The role chosen on
// the profile chip changes the HOME SCREEN only; it does not filter this menu.
//
// DROPDOWNS ARE BACK (guru 2026-11-20: "add back the dropdown for the navbar,
// but if a user can only see one then show the subtabs in the bar"). The
// 2026-11-12 two-level bar (modules row ⇄ [⌂] Module │ tabs) is gone:
//   • modules row — Dashboard · Sales ▾ · Inventory ▾ · … · Org Settings ▾.
//     A module with sub-pages opens a dropdown of them — ONLY them, no
//     "main page" item (guru 2026-11-21: "remove the main dashboard for the
//     inventory/sales modules"); one without (Dashboard, Projects,
//     Deliveries) just opens. ORDERS sits at the top of the Sales dropdown
//     instead of being its own entry (guru 2026-11-21: "move orders to the
//     top of sales tabs").
//   • ONE module only — a user whose menu has a single entry sees that
//     module's name and its sub-pages as flat tabs in the bar: nothing to
//     drop down for, so the tabs are right there.

import * as React from "react";
import { documentEditorNavPath } from "@/helpers/documentNavPath";
import { usePathname, useRouter } from "next/navigation";
import {
  Box, Button, ButtonBase, Divider, IconButton, Menu, MenuItem, Stack,
  Tooltip, Typography, alpha, useTheme,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import CheckIcon from "@mui/icons-material/Check";
import LogoutIcon from "@mui/icons-material/Logout";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import { useClerk, useUser } from "@clerk/nextjs";
import { useThemeMode } from "@/contexts/ThemeModeContext";
import NotificationBell from "@/components/NotificationBell";
import { TopNavOrgSwitcher } from "@/components/TopNav/TopNavBar";
import { resolveSubmenuRoute, submenuLabel, useNavLabels, useNavModules, isSettingsPath } from "@/components/TopNav/useNavModules";
import { AimeeBot, AimeeKeyframes } from "./Aimee";
import { HOME_VIEW_EVENT, closeAimee, openAimee, readHomeView } from "@/app/portal/chat/homeView";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { ROLES, ROLE_ORDER } from "./roles";
import { useRoleView } from "./useRoleView";
import AppSwitcher from "@/components/TopNav/AppSwitcher";
import GlobalSearch from "@/components/TopNav/GlobalSearch";
import NavTabsScroller from "@/components/TopNav/NavTabsScroller";
import { useTranslations } from "next-intl";
import { isClientsPath } from "@/helpers/shipmentsNav";

const TEAL = "#1BA39C";

const NAVY = "#2B2257";
const INK = "#1C1A33";

export default function RoleTopBar() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const t = useTheme();
  const dark = t.palette.mode === "dark";
  const { mode, toggleMode } = useThemeMode();
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const { navModules, settingsMenu, isMasterTier } = useNavModules();
  const { moduleName, subLabel, settingLabel } = useNavLabels();
  const { isAimsChatEnabled, isAppSwitcherHidden } = useOrganizationFeatures();
  const { roleId, setRoleId, role } = useRoleView();
  const [menu, setMenu] = React.useState<{ code: string; anchor: HTMLElement } | null>(null);

  const tn = useTranslations("shell.nav");
  // A record opened from a list carries ?from=<list path>: the menu it came
  // from stays highlighted (same rule as the normal bar).
  const [fromPath, setFromPath] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      const f = new URLSearchParams(window.location.search).get("from");
      setFromPath(f && f.startsWith("/portal") && !f.startsWith("//") ? f.split("?")[0] : null);
    } catch {
      setFromPath(null);
    }
  }, [pathname]);
  // A directly-opened document editor highlights its owning module (Sales /
  // Inventory) even without a ?from (guru 2026-11-14).
  const navPath = fromPath ?? documentEditorNavPath(pathname) ?? pathname;

  // AIMEE's open/closed state, so the face can toggle it like the normal bar.
  const [homeView, setHomeView] = React.useState(readHomeView());
  React.useEffect(() => {
    const sync = () => setHomeView(readHomeView());
    sync();
    window.addEventListener(HOME_VIEW_EVENT, sync);
    return () => window.removeEventListener(HOME_VIEW_EVENT, sync);
  }, [pathname]);
  const aimeeOpen = pathname === "/portal" && homeView === "aimee";
  const pressAimee = (e: React.MouseEvent<HTMLElement>) => {
    if (aimeeOpen) {
      router.replace("/portal", { scroll: false });
      closeAimee();
      return;
    }
    if (pathname === "/portal") {
      const r = e.currentTarget.getBoundingClientRect();
      openAimee({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    } else router.push("/portal?aimee=1");
  };

  const go = (path: string) => {
    setMenu(null);
    router.push(path);
  };

  // Same highlight rule as the normal bar.
  const isActive = (m: any): boolean => {
    const route: string = m.config?.route || "";
    if (!route) return false;
    if (route === "/portal") return navPath === "/portal";
    if (m.moduleCode === "SHIPMENTS" && isClientsPath(navPath)) return false;
    return navPath === route || navPath.startsWith(route + "/");
  };

  const initials =
    (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "") ||
    (user?.primaryEmailAddress?.emailAddress?.[0] ?? "A").toUpperCase();

  // The mock-up's nav item: 15px ink text on a rounded pill; the current one
  // sits on #EEF0F8 with a 2px teal underline (AppNav.jsx `active`).
  const navBtnSx = (active: boolean, open: boolean) => ({
    color: dark ? "text.primary" : INK,
    // Tight enough that the full AIMS menu (nine-odd items) fits beside the
    // right-hand cluster on a laptop screen.
    px: 1.25,
    py: 1,
    minWidth: 0,
    minHeight: 0,
    borderRadius: 3,
    whiteSpace: "nowrap",
    flexShrink: 0,
    fontWeight: active ? 500 : 400,
    fontSize: "0.875rem",
    lineHeight: 1.4,
    textTransform: "none" as const,
    bgcolor: active ? (dark ? alpha("#fff", 0.1) : "#EEF0F8") : open ? (dark ? alpha("#fff", 0.08) : "#F2F4FA") : "transparent",
    boxShadow: active ? `inset 0 -2px 0 ${TEAL}` : "none",
    "&:hover": { bgcolor: dark ? alpha("#fff", 0.08) : "#F2F4FA" },
  });

  // The bar's fill; the tab arrows' fades run from it (round 12).
  const barBg = dark ? t.palette.background.paper : "rgba(255,255,255,0.95)";

  const dropdown = (code: string, items: React.ReactNode) => (
    <Menu
      anchorEl={menu?.code === code ? menu.anchor : null}
      open={menu?.code === code}
      onClose={() => setMenu(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{ paper: { sx: { mt: 1, minWidth: 220, borderRadius: 3 } } }}
    >
      {items}
    </Menu>
  );

  return (
    <>
      <AimeeKeyframes />
      <Box
        component="nav"
        sx={{
          display: { xs: "none", md: "flex" },
          alignItems: "center",
          height: 64,
          flexShrink: 0,
          position: "sticky",
          top: 0,
          zIndex: (th) => th.zIndex.appBar,
          bgcolor: barBg,
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid",
          borderColor: dark ? alpha("#fff", 0.08) : "#F1F5F9",
          px: { md: 2, lg: 3 },
          gap: 1.5,
        }}
      >
        <Stack direction="row" alignItems="center" gap={1} sx={{ flexShrink: 0, cursor: "pointer" }} onClick={() => go("/portal")}>
          {/* Brand Kit R01 wordmark, the same files the landing uses; the cream
              variant is used on the dark theme. */}
          <Box
            component="img"
            src={dark ? "/role-home/aims-logo-white.png" : "/role-home/aims-logo.png"}
            alt="AIMS"
            sx={{ height: 32, width: "auto", display: "block", userSelect: "none" }}
          />
        </Stack>

        {isAimsChatEnabled && (
          <Tooltip title={aimeeOpen ? "Back to home" : "Ask AIMEE"}>
            <Box
              component="button"
              type="button"
              onClick={pressAimee}
              aria-label="Ask AIMEE"
              sx={{ all: "unset", cursor: "pointer", display: "grid", placeItems: "center", ml: 1, height: 44, width: 46, borderRadius: 999, "&:hover": { transform: "scale(1.05)" }, transition: "transform .15s" }}
            >
              <AimeeBot size={46} />
            </Box>
          </Tooltip>
        )}

        {/* The modules / tabs scroll when they do not fit; NavTabsScroller shows an arrow over a soft
            fade on each side with hidden tabs (round 12). The ⌂ and the module name stay put. */}
        <Stack direction="row" alignItems="center" gap={0.25} sx={{ flex: 1, minWidth: 0, alignSelf: "stretch" }}>
          {(() => {
            // The SAME menu as the normal AIMS bar (guru 2026-11-06): every
            // module the org has and the user may open, in the org's order,
            // then Org Settings (master tier only). Only the styling — and the
            // no-dropdown levels — are the role-home bar's.
            type Tab = { label: string; path: string };
            type Bar = { code: string; label: string; route: string; tabs: Tab[]; active: boolean };
            const bars: Bar[] = [
              ...navModules.map((m: any): Bar => ({
                code: m.moduleCode,
                label: moduleName(m),
                route: m.config?.route || "/portal",
                tabs: ((m.config as any)?.subMenus || []).map((s: any): Tab => ({ label: subLabel(m, s, submenuLabel(s)), path: resolveSubmenuRoute(m, s) })),
                active: isActive(m),
              })),
              ...(isMasterTier
                ? [{
                    code: "ORG_SETTINGS",
                    label: tn("orgSettings"),
                    route: "",
                    tabs: settingsMenu.map((s): Tab => ({ label: settingLabel(s), path: s.path })),
                    active: isSettingsPath(pathname),
                  }]
                : []),
            ];
            // Orders is the first Sales item, not a module of its own.
            const ordersAt = bars.findIndex((b) => b.code === "ORDERS");
            const sales = bars.find((b) => b.code === "SALES");
            if (ordersAt >= 0 && sales) {
              const [orders] = bars.splice(ordersAt, 1);
              sales.tabs = [...(orders.tabs.length ? orders.tabs : [{ label: orders.label, path: orders.route }]), ...sales.tabs];
              sales.active = sales.active || orders.active;
            }
            // A module's MAIN PAGE (guru 2026-11-14): Accounting → General
            // Ledger (its Dashboard tab is gone), Sales → the Sales page,
            // Inventory → the Inventory overview; any other module → its own
            // route when that is one of its tabs, else its first tab.
            const MODULE_HOME: Record<string, string> = { ACCOUNTING: "/portal/accounting/ledger", SALES: "/portal/sales", INVENTORY: "/portal/inventory/overview" };
            // Jobs calendar orgs: Jobs opens on its Calendar tab when that is the first one.
            const homeOf = (b: Bar) => MODULE_HOME[b.code] ?? (b.code === "DELIVERIES" && b.tabs[0]?.path === "/portal/deliveries/calendar" ? b.tabs[0].path : null) ?? (b.tabs.some((t) => t.path === b.route) || !b.tabs.length ? b.route : b.tabs[0].path);
            // The tab whose route is the longest prefix of the page is the
            // current one (a module's own route is a prefix of every page under it).
            const currentTab = (b: Bar) =>
              b.tabs
                .filter((tb) => navPath === tb.path || navPath.startsWith(tb.path + "/"))
                .sort((x, y) => y.path.length - x.path.length)[0];

            if (bars.length === 1) {
              // One module only: its name, then its sub-pages as flat tabs.
              const only = bars[0];
              const current = currentTab(only);
              return (
                <>
                  <ButtonBase
                    data-testid="role-nav-level"
                    onClick={() => {
                      const home = homeOf(only);
                      if (home && home !== navPath) go(home);
                    }}
                    sx={{
                      fontFamily: "inherit",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: dark ? "text.primary" : INK,
                      px: 0.75,
                      py: 0.5,
                      borderRadius: 1.5,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      "&:hover": { bgcolor: dark ? alpha("#fff", 0.08) : "#EEF0F7" },
                    }}
                  >
                    {only.label}
                  </ButtonBase>
                  {only.tabs.length > 0 && (
                    <>
                      <Box sx={{ width: "1px", height: 20, bgcolor: dark ? alpha("#fff", 0.16) : "#E2E6F0", mx: 0.5, flexShrink: 0 }} />
                      <NavTabsScroller fade={barBg} arrowColor={dark ? "rgba(255,255,255,0.85)" : INK} gap={0.25} testId="role-nav-scroller">
                        {only.tabs.map((tb) => (
                          <Button
                            key={tb.path}
                            size="small"
                            data-testid="role-nav-tab"
                            onClick={() => go(tb.path)}
                            sx={navBtnSx(current?.path === tb.path, false)}
                          >
                            {tb.label}
                          </Button>
                        ))}
                      </NavTabsScroller>
                    </>
                  )}
                </>
              );
            }

            // Modules row with dropdowns — the normal bar's menu in this bar's styling.
            return (
              <NavTabsScroller fade={barBg} arrowColor={dark ? "rgba(255,255,255,0.85)" : INK} gap={0.25} testId="role-nav-scroller">
                {bars.map((b) => {
                  const hasMenu = b.tabs.length > 0;
                  const isOpen = menu?.code === b.code;
                  const current = currentTab(b);
                  const home = homeOf(b);
                  return (
                    <React.Fragment key={b.code}>
                      <Button
                        size="small"
                        data-testid={`role-nav-module-${b.code}`}
                        aria-haspopup={hasMenu ? "menu" : undefined}
                        aria-expanded={hasMenu ? isOpen : undefined}
                        onClick={(e) => (hasMenu ? setMenu(isOpen ? null : { code: b.code, anchor: e.currentTarget }) : go(home || b.route))}
                        endIcon={hasMenu ? <KeyboardArrowDownIcon sx={{ fontSize: "1rem !important", opacity: 0.7, transition: "transform .15s", transform: isOpen ? "rotate(180deg)" : "none" }} /> : undefined}
                        sx={{ ...navBtnSx(b.active, isOpen), "& .MuiButton-endIcon": { ml: 0.25, mr: -0.5 } }}
                      >
                        {b.label}
                      </Button>
                      {hasMenu &&
                        dropdown(
                          b.code,
                          b.tabs.map((tb) => (
                            <MenuItem key={tb.path} data-testid="role-nav-item" onClick={() => go(tb.path)} selected={current?.path === tb.path} sx={{ fontSize: "0.875rem", py: 1 }}>
                              {tb.label}
                            </MenuItem>
                          )),
                        )}
                    </React.Fragment>
                  );
                })}
              </NavTabsScroller>
            );
          })()}
        </Stack>

        <Stack direction="row" alignItems="center" gap={0.5} sx={{ flexShrink: 0 }}>
          {/* The same "search anything" field as the normal bar (guru 2026-11-13). */}
          <GlobalSearch light />
          <TopNavOrgSwitcher light />
          {!isAppSwitcherHidden && <AppSwitcher iconColor={dark ? "rgba(255,255,255,0.7)" : "#94A3B8"} />}
          <NotificationBell iconColor={dark ? "rgba(255,255,255,0.85)" : INK} />
          <Tooltip title={mode === "dark" ? "Light mode" : "Dark mode"}>
            <IconButton size="small" onClick={toggleMode} sx={{ color: "text.secondary" }}>
              {mode === "dark" ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          {/* Profile chip — name, role, and the role switcher (the mock-up's). */}
          <Box
            component="button"
            type="button"
            onClick={(e) => setMenu(menu?.code === "ROLE" ? null : { code: "ROLE", anchor: e.currentTarget })}
            data-testid="role-home-profile-chip"
            sx={{
              all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 1,
              pl: 0.5, pr: 1, py: 0.5, ml: 0.5, borderRadius: 999,
              "&:hover": { bgcolor: alpha(t.palette.text.primary, 0.05) },
            }}
          >
            <Box sx={{ height: 36, width: 36, borderRadius: "50%", bgcolor: NAVY, color: "#fff", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }}>
              {initials}
            </Box>
            <Box sx={{ textAlign: "left", lineHeight: 1.2, display: { md: "none", xl: "block" } }}>
              <Typography sx={{ fontSize: "0.875rem", fontWeight: 500 }}>
                {user?.fullName || user?.primaryEmailAddress?.emailAddress || ""}
              </Typography>
              <Typography sx={{ fontSize: "0.6875rem", color: "text.secondary", whiteSpace: "nowrap" }}>{role.title}</Typography>
            </Box>
            <KeyboardArrowDownIcon sx={{ fontSize: "1.1rem", color: "text.secondary" }} />
          </Box>
          {dropdown("ROLE", [
            <Typography key="lbl" sx={{ px: 2, py: 1, fontSize: "0.75rem", color: "text.secondary" }}>
              Viewing as
            </Typography>,
            ...ROLE_ORDER.map((id) => (
              <MenuItem
                key={id}
                onClick={() => { setRoleId(id); setMenu(null); if (pathname !== "/portal") router.push("/portal"); }}
                data-testid={`role-chip-option-${id}`}
                sx={{ gap: 1.5, py: 1 }}
              >
                <Box sx={{ height: 32, width: 32, borderRadius: "50%", bgcolor: dark ? alpha("#B9B0F2", 0.18) : alpha(NAVY, 0.12), color: dark ? "#D3CCFA" : NAVY, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }}>
                  {ROLES[id].title.split(" ").filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).slice(0, 2).join("")}
                </Box>
                <Typography sx={{ flex: 1, fontSize: "0.875rem" }}>{ROLES[id].title}</Typography>
                {id === roleId && <CheckIcon sx={{ fontSize: "1.1rem", color: TEAL }} />}
              </MenuItem>
            )),
            // The account half of the menu — what the normal bar's Clerk
            // avatar offers (this bar draws its own chip, so it has to).
            <Divider key="acct-div" sx={{ my: 0.75 }} />,
            <MenuItem
              key="account"
              onClick={() => { setMenu(null); openUserProfile(); }}
              data-testid="role-chip-manage-account"
              sx={{ gap: 1.5, py: 1, fontSize: "0.875rem" }}
            >
              <ManageAccountsOutlinedIcon sx={{ fontSize: "1.2rem", color: "text.secondary" }} />
              Manage account
            </MenuItem>,
            <MenuItem
              key="logout"
              onClick={() => { setMenu(null); signOut({ redirectUrl: "/" }); }}
              data-testid="role-chip-logout"
              sx={{ gap: 1.5, py: 1, fontSize: "0.875rem", color: "error.main" }}
            >
              <LogoutIcon sx={{ fontSize: "1.2rem" }} />
              Log out
            </MenuItem>,
          ])}
        </Stack>
      </Box>
    </>
  );
}
