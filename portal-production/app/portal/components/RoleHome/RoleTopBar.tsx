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
// NO DROPDOWNS (guru 2026-11-12: "when I click Sales the Sales tab opens with
// only those [items]… and they can still select the home icon and select the
// other modules"). The bar has two levels:
//   • modules row — Dashboard · Sales · Inventory · … · Org Settings. A module
//     with sub-pages swaps the bar to its level; one without (Dashboard,
//     Projects, Deliveries) just opens.
//   • module level — [⌂] Sales │ Quotations · Invoices · … — the sub-pages
//     the dropdown used to list, as flat tabs. ⌂ returns to the modules row.
// Landing inside a module (deep link, list → record) opens its level.

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Box, Button, Divider, IconButton, Menu, MenuItem, Stack,
  Tooltip, Typography, alpha, useTheme,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import CheckIcon from "@mui/icons-material/Check";
import LogoutIcon from "@mui/icons-material/Logout";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import { useClerk, useUser } from "@clerk/nextjs";
import { useThemeMode } from "@/contexts/ThemeModeContext";
import NotificationBell from "@/components/NotificationBell";
import { TopNavOrgSwitcher } from "@/components/TopNav/TopNavBar";
import { resolveSubmenuRoute, submenuLabel, useNavLabels, useNavModules } from "@/components/TopNav/useNavModules";
import { AimeeBot, AimeeKeyframes } from "./Aimee";
import { HOME_VIEW_EVENT, closeAimee, openAimee, readHomeView } from "@/app/portal/chat/homeView";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { ROLES, ROLE_ORDER } from "./roles";
import { useRoleView } from "./useRoleView";
import AppSwitcher from "@/components/TopNav/AppSwitcher";
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
  const { isAimsChatEnabled } = useOrganizationFeatures();
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
  const navPath = fromPath ?? pathname;

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

  // Which level the bar shows. null = follow the page (inside a module → that
  // module's level; elsewhere → the modules row); "home" = the modules row
  // even while inside a module (⌂ pressed); { code } = that module's level
  // (module pressed, page not changed yet). Any navigation resets to "follow".
  const [level, setLevel] = React.useState<"home" | { code: string } | null>(null);
  React.useEffect(() => setLevel(null), [navPath]);

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
          bgcolor: dark ? "background.paper" : "rgba(255,255,255,0.95)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid",
          borderColor: dark ? alpha("#fff", 0.08) : "#F1F5F9",
          px: { md: 2, lg: 3 },
          gap: 1.5,
        }}
      >
        <Stack direction="row" alignItems="center" gap={1} sx={{ flexShrink: 0, cursor: "pointer" }} onClick={() => go("/portal")}>
          {/* The mock-up's own logo file. It is dark ink on transparent, so on
              the dark theme it is flattened to white to stay readable. */}
          <Box
            component="img"
            src="/role-home/aims-logo.png"
            alt="AIMS"
            sx={{ height: 32, width: "auto", display: "block", userSelect: "none", filter: dark ? "brightness(0) invert(1)" : "none" }}
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

        {/* Scrolls silently if an org has more modules than fit (as the normal
            bar does); the right edge fades so a cut-off item reads as "more". */}
        <Stack
          direction="row"
          alignItems="center"
          gap={0.25}
          sx={{
            flex: 1, minWidth: 0, overflowX: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
            pr: 3,
            maskImage: "linear-gradient(to right, black calc(100% - 28px), transparent)",
            WebkitMaskImage: "linear-gradient(to right, black calc(100% - 28px), transparent)",
          }}
        >
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
                    active: pathname.startsWith("/portal/settings") || pathname.startsWith("/portal/masterfiles"),
                  }]
                : []),
            ];
            const followed = bars.find((b) => b.active && b.tabs.length)?.code ?? null;
            const openCode = level === "home" ? null : level?.code ?? followed;
            const open = openCode ? bars.find((b) => b.code === openCode) : undefined;

            if (!open) {
              // Modules row.
              return bars.map((b) => (
                <Button
                  key={b.code}
                  size="small"
                  data-testid={`role-nav-module-${b.code}`}
                  onClick={() => (b.tabs.length ? setLevel({ code: b.code }) : go(b.route))}
                  sx={navBtnSx(b.active, false)}
                >
                  {b.label}
                </Button>
              ));
            }

            // Module level: ⌂ · module name │ its sub-pages as tabs. The tab
            // whose route is the longest prefix of the page is the current one
            // (a module's own route is a prefix of every page under it).
            const current = open.tabs
              .filter((tb) => navPath === tb.path || navPath.startsWith(tb.path + "/"))
              .sort((a, b) => b.path.length - a.path.length)[0];
            return (
              <>
                <Tooltip title="All modules">
                  <IconButton
                    size="small"
                    data-testid="role-nav-home"
                    aria-label="All modules"
                    onClick={() => setLevel("home")}
                    sx={{ color: dark ? "text.primary" : INK, flexShrink: 0, "&:hover": { bgcolor: dark ? alpha("#fff", 0.08) : "#F2F4FA" } }}
                  >
                    <HomeRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Typography
                  data-testid="role-nav-level"
                  sx={{ fontSize: "0.875rem", fontWeight: 600, color: dark ? "text.primary" : INK, px: 0.75, whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  {open.label}
                </Typography>
                <Box sx={{ width: "1px", height: 20, bgcolor: dark ? alpha("#fff", 0.16) : "#E2E6F0", mx: 0.5, flexShrink: 0 }} />
                {open.tabs.map((tb) => (
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
              </>
            );
          })()}
        </Stack>

        <Stack direction="row" alignItems="center" gap={0.5} sx={{ flexShrink: 0 }}>
          <TopNavOrgSwitcher light />
          <AppSwitcher iconColor={dark ? "rgba(255,255,255,0.7)" : "#94A3B8"} />
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
