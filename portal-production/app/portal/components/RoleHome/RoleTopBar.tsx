"use client";

// The role-home top bar (guru 2026-11-06: "change the top navbar also, also
// the font"). This is the mock-up's bar, not the Xero-style dark one: a white
// 64px bar with the AIMS mark, AIMEE beside it, text menus with dropdowns, and
// the profile chip on the right carrying the role switcher.
//
// What it SHOWS is the mock-up's; what it OPENS is AIMS's. The menus are the
// org's real modules and submenus from useNavModules() — the same list, routes
// and permission rules as the normal bar — filtered to the modules the chosen
// role cares about. Everything filtered out is still reachable under "More",
// so no module is ever stranded.

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Box, Button, Divider, IconButton, Menu, MenuItem, Stack,
  Tooltip, Typography, alpha, useTheme,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import CheckIcon from "@mui/icons-material/Check";
import { useUser } from "@clerk/nextjs";
import { useThemeMode } from "@/contexts/ThemeModeContext";
import NotificationBell from "@/components/NotificationBell";
import { TopNavOrgSwitcher } from "@/components/TopNav/TopNavBar";
import { resolveSubmenuRoute, submenuLabel, useNavLabels, useNavModules } from "@/components/TopNav/useNavModules";
import { AimeeBot, AimeeKeyframes } from "./Aimee";
import { HOME_VIEW_EVENT, closeAimee, openAimee, readHomeView } from "@/app/portal/chat/homeView";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { ROLES, ROLE_ORDER } from "./roles";
import { readOpenedApp, useRoleView, writeOpenedApp } from "./useRoleView";
import AppGrid, { AppTile } from "./AppGrid";
import { appForPath, isFnActive } from "./apps";

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
  const { navModules, settingsMenu, isMasterTier } = useNavModules();
  const { moduleName, subLabel, settingLabel } = useNavLabels();
  const { isAimsChatEnabled } = useOrganizationFeatures();
  const { roleId, setRoleId, role } = useRoleView();
  const [menu, setMenu] = React.useState<{ code: string; anchor: HTMLElement } | null>(null);

  // Inside an app (opened from the launcher, or reached by any link) the bar
  // shows that app's functions instead of the role menus — the mock-up's
  // FeatureButton + AppFunctions. Apps outside the role's launcher never take
  // over the bar.
  const [openedApp, setOpenedApp] = React.useState<ReturnType<typeof readOpenedApp>>(null);
  React.useEffect(() => setOpenedApp(readOpenedApp()), [pathname]);
  const matched = pathname === "/portal" ? null : appForPath(pathname, openedApp);
  const app = matched && role.apps.includes(matched.id) ? matched : null;

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
    if (path === "/portal") writeOpenedApp(null);
    router.push(path);
  };

  // Modules this role keeps, in the org's own order; the rest go under "More".
  const wanted = new Set(role.nav);
  const mine = navModules.filter((m: any) => m.moduleCode !== "DASHBOARD" && wanted.has(m.moduleCode));
  const rest = navModules.filter((m: any) => m.moduleCode !== "DASHBOARD" && !wanted.has(m.moduleCode));

  const isActive = (m: any) => {
    const route: string = m.config?.route || "";
    if (!route || route === "/portal") return false;
    return pathname === route || pathname.startsWith(route + "/");
  };

  const initials =
    (user?.firstName?.[0] ?? "") + (user?.lastName?.[0] ?? "") ||
    (user?.primaryEmailAddress?.emailAddress?.[0] ?? "A").toUpperCase();

  // The mock-up's nav item: 15px ink text on a rounded pill; the current one
  // sits on #EEF0F8 with a 2px teal underline (AppNav.jsx `active`).
  const navBtnSx = (active: boolean, open: boolean) => ({
    color: dark ? "text.primary" : INK,
    px: 1.5,
    py: 1,
    minHeight: 0,
    borderRadius: 3,
    whiteSpace: "nowrap",
    flexShrink: 0,
    fontWeight: active ? 500 : 400,
    fontSize: "0.9375rem",
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
          px: { md: 2, lg: 4 },
          gap: 2,
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

        <Stack direction="row" alignItems="center" gap={0.5} sx={{ ml: 1, flex: 1, minWidth: 0, overflowX: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
          {app ? (
            <>
              {/* The app's own button (tile + name) goes to its first screen. */}
              <Button
                size="small"
                onClick={() => go(app.home)}
                data-testid="role-bar-app"
                // The app button names where you are; the underline belongs to
                // the function below it, so it never doubles up.
                sx={{ ...navBtnSx(false, false), fontWeight: 500, gap: 1, bgcolor: dark ? alpha("#fff", 0.06) : "#F4F6FB" }}
              >
                <AppTile id={app.id} size={24} />
                {app.name}
              </Button>
              {app.functions.map((fn) => {
                const active = isFnActive(fn, pathname, app.functions);
                return (
                  <Button
                    key={fn.href}
                    size="small"
                    onClick={() => go(fn.href)}
                    sx={{ ...navBtnSx(false, false), fontWeight: active ? 500 : 400, boxShadow: active ? `inset 0 -2px 0 ${TEAL}` : "none" }}
                  >
                    {fn.label}
                  </Button>
                );
              })}
            </>
          ) : (
            <>
            <Button size="small" onClick={() => go("/portal")} startIcon={<HomeOutlinedIcon />} sx={navBtnSx(pathname === "/portal", false)}>
              Home
            </Button>

            {mine.map((m: any) => {
              const subs: any[] = (m.config as any)?.subMenus || [];
              return (
                <React.Fragment key={m.moduleCode}>
                  <Button
                    size="small"
                    onClick={(e) =>
                      subs.length
                        ? setMenu(menu?.code === m.moduleCode ? null : { code: m.moduleCode, anchor: e.currentTarget })
                        : go(m.config?.route || "/portal")
                    }
                    endIcon={subs.length ? <KeyboardArrowDownIcon sx={{ fontSize: "1rem !important", opacity: 0.7 }} /> : undefined}
                    sx={navBtnSx(isActive(m), menu?.code === m.moduleCode)}
                  >
                    {moduleName(m)}
                  </Button>
                  {!!subs.length &&
                    dropdown(
                      m.moduleCode,
                      subs.map((s: any, i: number) => (
                        <MenuItem key={i} onClick={() => go(resolveSubmenuRoute(m, s))} sx={{ fontSize: "0.875rem", py: 1 }}>
                          {subLabel(m, s, submenuLabel(s))}
                        </MenuItem>
                      )),
                    )}
                </React.Fragment>
              );
            })}

            {/* More — the modules this role does not lead with, plus Org Settings. */}
            <Button
              size="small"
              onClick={(e) => setMenu(menu?.code === "MORE" ? null : { code: "MORE", anchor: e.currentTarget })}
              endIcon={<KeyboardArrowDownIcon sx={{ fontSize: "1rem !important", opacity: 0.7 }} />}
              sx={navBtnSx(pathname.startsWith("/portal/settings") || pathname.startsWith("/portal/masterfiles"), menu?.code === "MORE")}
            >
              More
            </Button>
            {dropdown("MORE", [
              ...rest.map((m: any) => (
                <MenuItem key={m.moduleCode} onClick={() => go(m.config?.route || "/portal")} sx={{ fontSize: "0.875rem", py: 1 }}>
                  {moduleName(m)}
                </MenuItem>
              )),
              ...(isMasterTier && rest.length ? [<Divider key="div" />] : []),
              ...(isMasterTier
                ? settingsMenu.map((s) => (
                    <MenuItem key={s.path} onClick={() => go(s.path)} sx={{ fontSize: "0.875rem", py: 1 }}>
                      {settingLabel(s)}
                    </MenuItem>
                  ))
                : []),
            ])}
            </>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" gap={0.5} sx={{ flexShrink: 0 }}>
          <TopNavOrgSwitcher light />
          <AppGrid />
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
                <Box sx={{ height: 32, width: 32, borderRadius: "50%", bgcolor: alpha(NAVY, 0.12), color: NAVY, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }}>
                  {ROLES[id].title.split(" ").filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).slice(0, 2).join("")}
                </Box>
                <Typography sx={{ flex: 1, fontSize: "0.875rem" }}>{ROLES[id].title}</Typography>
                {id === roleId && <CheckIcon sx={{ fontSize: "1.1rem", color: TEAL }} />}
              </MenuItem>
            )),
          ])}
        </Stack>
      </Box>
    </>
  );
}
