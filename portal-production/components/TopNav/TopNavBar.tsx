"use client";

// Xero-style desktop top navigation (guru 2026-08-30, GLOBAL for every org —
// the left rail is retired; mobile keeps the drawer). Same data and
// visibility rules as DynamicSidebarContent (org modules ∩ role allowedModules,
// adminOnly submenus, hidden legacy modules); the presentation follows Xero:
// dark bar across the top, text items, click-to-open dropdown per module,
// active module underlined. Desktop (md+) only — mobile keeps the drawer.

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Box, Button, Divider, Menu, MenuItem, Stack, Typography,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import Image from "next/image";
import { UserButton, useUser } from "@clerk/nextjs";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import GlobalSearch from "./GlobalSearch";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { Autocomplete, TextField, Chip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import NotificationBell from "@/components/NotificationBell";
import AppSwitcher from "./AppSwitcher";
import { IconButton, Tooltip } from "@mui/material";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import { useThemeMode } from "@/contexts/ThemeModeContext";
import logo from "@/components/Sidebar/aims-logo.png";
import { resolveSubmenuRoute, submenuLabel, useNavModules } from "./useNavModules";
import { HOME_VIEW_EVENT, closeAimee, openAimee, readHomeView, type HomeView } from "@/app/portal/chat/homeView";
import AimeeFace from "@/app/portal/chat/AimeeFace";
import { isClientsPath } from "@/helpers/shipmentsNav";

// Deliberate hardcoded org check pending a general per-org nav-logo solution.
// CIEL gets its cream mark (transparent PNG on the dark navy bar); ~2.2:1, so
// it is sized 62x28 to keep the aspect and fit the 52px bar. The S3 domain is
// already whitelisted in next.config.mjs images.domains.
const CIEL_ORG_ID = "09e55c23-e031-4254-8152-a373597b2cb3";
const CIEL_NAV_LOGO = "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/logos/ciel-logo-cream.png";

// Admin-only org switcher, folded into the bar next to the brand (Xero puts
// the org name there). Replaces the old below-bar "Viewing organization" row
// AND the ViewingAsBanner strip: when an override org is active the field is
// info-tinted, a tooltip carries the "writes are scoped here" warning, and the
// ✕ resets to home (guru 2026-08-30).
function TopNavOrgSwitcher() {
  const { isOsirisAdmin, organization, realOrganization, setActiveOrgId } = useOrganization();
  const { getToken } = useAuth();
  const [orgs, setOrgs] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    if (!isOsirisAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: "/organizations", method: "GET" }, {}, token);
        if (cancelled) return;
        const list: { id: string; name: string }[] =
          (res?.success && Array.isArray(res?.data?.data) && res.data.data) ||
          (res?.success && Array.isArray(res?.data) && res.data) ||
          [];
        const sorted = [...list].sort((a, b) => {
          if (a.id === realOrganization?.id) return -1;
          if (b.id === realOrganization?.id) return 1;
          return (a.name ?? "").localeCompare(b.name ?? "");
        });
        setOrgs(sorted);
      } catch (err) {
        console.error("Failed to load organizations:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [isOsirisAdmin, getToken, realOrganization?.id]);

  if (!isOsirisAdmin) return null;
  const value = orgs.find((o) => o.id === organization?.id) ?? null;
  const isOverride = !!organization && !!realOrganization && organization.id !== realOrganization.id;

  return (
    <Stack direction="row" alignItems="center" gap={0.25} sx={{ flexShrink: 0 }}>
      <Tooltip
        title={
          isOverride
            ? `Viewing as ${organization?.name} — data and writes are scoped to this org, not your home (${realOrganization?.name}).`
            : "Switch organization"
        }
      >
        <Autocomplete
          size="small"
          options={orgs}
          // Always controlled: null (not undefined) until the org list loads,
          // else MUI locks in uncontrolled mode and never shows the current
          // org. disableClearable types value as non-null; null is fine at runtime.
          value={value as (typeof orgs)[number]}
          getOptionLabel={(o) => o.name ?? ""}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          disableClearable
          onChange={(_, selected) => {
            if (!selected) return;
            setActiveOrgId(selected.id === realOrganization?.id ? null : selected.id);
          }}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <span style={{ flex: 1 }}>{option.name}</span>
              {option.id === realOrganization?.id && <Chip size="small" label="home" sx={{ ml: 1 }} />}
            </li>
          )}
          sx={{
            width: 210,
            // Doubled-up class selector out-specifies the light theme's white
            // input fill — the bar field must stay dark in BOTH themes (the
            // white pill with invisible text was the light-mode result).
            "& .MuiOutlinedInput-root.MuiInputBase-root": {
              color: "#FFFFFF",
              fontSize: "0.78rem",
              backgroundColor: "rgba(255,255,255,0.06)",
              "& fieldset": { borderColor: isOverride ? "#4da3ff" : "rgba(255,255,255,0.25)" },
              "&:hover fieldset": { borderColor: isOverride ? "#4da3ff" : "rgba(255,255,255,0.45)" },
              "&.Mui-focused": { backgroundColor: "rgba(255,255,255,0.10)", boxShadow: "none" },
            },
            "& .MuiOutlinedInput-input": {
              color: "#FFFFFF",
              "&::placeholder": { color: "rgba(255,255,255,0.6)", opacity: 1 },
            },
            "& .MuiSvgIcon-root": { color: "rgba(255,255,255,0.7)" },
          }}
          renderInput={(params) => <TextField {...params} placeholder="Switch organization…" variant="outlined" />}
        />
      </Tooltip>
      {isOverride && (
        <Tooltip title={`Reset to home (${realOrganization?.name})`}>
          <IconButton size="small" onClick={() => setActiveOrgId(null)} sx={{ color: "#4da3ff" }}>
            <CloseIcon sx={{ fontSize: "1rem" }} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

export default function TopNavBar() {
  const router = useRouter();
  const rawPathname = usePathname() || "";
  // A record opened from a list carries ?from=<list path> (e.g. an invoice from
  // Invoices → /portal/trade-documents/invoice/…?from=/portal/invoicing): the
  // menu it came from stays highlighted. Read from window.location rather than
  // useSearchParams so the layout doesn't need a Suspense boundary.
  const [fromPath, setFromPath] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      const f = new URLSearchParams(window.location.search).get("from");
      setFromPath(f && f.startsWith("/portal") && !f.startsWith("//") ? f.split("?")[0] : null);
    } catch {
      setFromPath(null);
    }
  }, [rawPathname]);
  const navPath = fromPath ?? rawPathname;
  const { user } = useUser();
  const { organization } = useOrganization(); // active org (respects admin "view as")
  const { mode, toggleMode } = useThemeMode();
  const { isAimsChatEnabled } = useOrganizationFeatures();
  const { navModules, isMasterTier, settingsMenu } = useNavModules();
  // AIMEE in the top bar (orgs with enableAimsChat): her face opens the
  // assistant from any page; while it is open the same face takes you back.
  const [homeView, setHomeView] = React.useState<HomeView>("dashboard");
  React.useEffect(() => {
    const sync = () => setHomeView(readHomeView());
    sync();
    window.addEventListener(HOME_VIEW_EVENT, sync);
    return () => window.removeEventListener(HOME_VIEW_EVENT, sync);
  }, [rawPathname]);
  const aimeeOpen = rawPathname === "/portal" && homeView === "aimee";
  const pressAimee = (e: React.MouseEvent<HTMLElement>) => {
    if (aimeeOpen) {
      router.replace("/portal", { scroll: false });
      closeAimee();
      return;
    }
    if (rawPathname === "/portal") {
      const r = e.currentTarget.getBoundingClientRect();
      openAimee({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    } else {
      router.push("/portal?aimee=1");
    }
  };

  const [openMenu, setOpenMenu] = React.useState<{ code: string; anchor: HTMLElement } | null>(null);

  const isModuleActive = (m: any): boolean => {
    const route: string = m.config?.route || "";
    if (!route) return false;
    if (route === "/portal") return navPath === "/portal";
    // Round AM: Clients lives under /portal/shipments — Sales isn't highlighted there.
    if (m.moduleCode === "SHIPMENTS" && isClientsPath(navPath)) return false;
    return navPath === route || navPath.startsWith(route + "/");
  };

  const go = (path: string) => {
    setOpenMenu(null);
    router.push(path);
  };

  return (
    <Box
      component="nav"
      sx={{
        display: { xs: "none", md: "flex" },
        alignItems: "center",
        gap: 0.5,
        px: 2,
        height: 52,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        zIndex: (t) => t.zIndex.appBar,
        // The brand bar stays dark navy in BOTH themes, like the old rail.
        bgcolor: "#041627",
        color: "#FFFFFF",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <Stack direction="row" alignItems="center" gap={1} sx={{ mr: 2, flexShrink: 0 }}>
        {organization?.id === CIEL_ORG_ID ? (
          // CIEL only: cream mark instead of the AIMS mark. The AIMS wordmark is
          // suppressed because the CIEL logo already contains its own name.
          <Image src={CIEL_NAV_LOGO} alt="CIEL" width={62} height={28} style={{ display: "block", objectFit: "contain" }} />
        ) : (
          <>
            <Image src={logo} alt="AIMS" width={26} height={26} style={{ display: "block" }} />
            <Typography sx={{ fontWeight: 800, letterSpacing: "0.06em", fontSize: "0.95rem" }}>AIMS</Typography>
          </>
        )}
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        sx={{
          gap: 0, minWidth: 0, overflowX: "auto", flex: 1,
          // Scroll silently if an org has more modules than fit — no scrollbar strip.
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {navModules.map((m: any) => {
          const subMenus: any[] = (m.config as any)?.subMenus || [];
          const hasMenu = subMenus.length > 0;
          const active = isModuleActive(m);
          return (
            <React.Fragment key={m.moduleCode}>
              <Button
                size="small"
                onClick={(e) =>
                  hasMenu
                    ? setOpenMenu(openMenu?.code === m.moduleCode ? null : { code: m.moduleCode, anchor: e.currentTarget })
                    : go(m.config?.route || "/portal")
                }
                endIcon={hasMenu ? <KeyboardArrowDownIcon sx={{ fontSize: "1rem !important", opacity: 0.7 }} /> : undefined}
                sx={{
                  color: "#FFFFFF",
                  px: 1.5,
                  height: 52,
                  borderRadius: 0,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.8125rem",
                  textTransform: "none",
                  // Xero-style active underline.
                  boxShadow: active ? "inset 0 -3px 0 #2f80ed" : "none",
                  bgcolor: openMenu?.code === m.moduleCode ? "rgba(255,255,255,0.08)" : "transparent",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.08)" },
                }}
              >
                {m.displayName || m.moduleCode}
              </Button>
              {hasMenu && (
                <Menu
                  anchorEl={openMenu && openMenu.code === m.moduleCode ? openMenu.anchor : null}
                  open={openMenu?.code === m.moduleCode}
                  onClose={() => setOpenMenu(null)}
                  anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                  transformOrigin={{ vertical: "top", horizontal: "left" }}
                  slotProps={{ paper: { sx: { mt: 0, minWidth: 220, borderRadius: "0 0 10px 10px" } } }}
                >
                  {subMenus.map((s: any, i: number) => (
                    <MenuItem key={i} onClick={() => go(resolveSubmenuRoute(m, s))} sx={{ fontSize: "0.8125rem", py: 1 }}>
                      {submenuLabel(s)}
                    </MenuItem>
                  ))}
                </Menu>
              )}
            </React.Fragment>
          );
        })}

        {/* Organization Settings — same secondary group as the sidebar;
            master tier only (juniors/seniors have no org administration) */}
        {isMasterTier && (
        <>
        <Button
          size="small"
          onClick={(e) => setOpenMenu(openMenu?.code === "ORG_SETTINGS" ? null : { code: "ORG_SETTINGS", anchor: e.currentTarget })}
          endIcon={<KeyboardArrowDownIcon sx={{ fontSize: "1rem !important", opacity: 0.7 }} />}
          sx={{
            color: "#FFFFFF",
            px: 1.5,
            height: 52,
            borderRadius: 0,
            whiteSpace: "nowrap",
            flexShrink: 0,
            fontWeight: rawPathname.startsWith("/portal/settings") || rawPathname.startsWith("/portal/masterfiles") ? 700 : 500,
            fontSize: "0.8125rem",
            textTransform: "none",
            boxShadow: rawPathname.startsWith("/portal/settings") || rawPathname.startsWith("/portal/masterfiles") ? "inset 0 -3px 0 #2f80ed" : "none",
            bgcolor: openMenu?.code === "ORG_SETTINGS" ? "rgba(255,255,255,0.08)" : "transparent",
            "&:hover": { bgcolor: "rgba(255,255,255,0.08)" },
          }}
        >
          Org Settings
        </Button>
        <Menu
          anchorEl={openMenu && openMenu.code === "ORG_SETTINGS" ? openMenu.anchor : null}
          open={openMenu?.code === "ORG_SETTINGS"}
          onClose={() => setOpenMenu(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          slotProps={{ paper: { sx: { mt: 0, minWidth: 220, borderRadius: "0 0 10px 10px" } } }}
        >
          {settingsMenu.map((s) => (
            <MenuItem key={s.path} onClick={() => go(s.path)} sx={{ fontSize: "0.8125rem", py: 1 }}>
              {s.label}
            </MenuItem>
          ))}
        </Menu>
        </>
        )}
      </Stack>

      <Stack direction="row" alignItems="center" gap={1} sx={{ flexShrink: 0, ml: 1 }}>
        {isAimsChatEnabled && (
          <Tooltip title={aimeeOpen ? "Back to the dashboard" : "AIMEE"}>
            <Box
              component="button"
              type="button"
              onClick={pressAimee}
              aria-label={aimeeOpen ? "Back to the dashboard" : "Open AIMEE"}
              data-tour="home-view-toggle"
              sx={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                height: 30,
                pl: "3px",
                pr: { xs: "3px", xl: 1.25 },
                mr: 0.5,
                borderRadius: 999,
                bgcolor: aimeeOpen ? "rgba(85,233,255,0.18)" : "rgba(255,255,255,0.08)",
                boxShadow: aimeeOpen ? "0 0 0 1px rgba(85,233,255,0.5)" : "none",
                "&:hover": { bgcolor: "rgba(255,255,255,0.16)" },
                "&:focus-visible": { outline: "2px solid rgba(85,233,255,0.8)" },
                "& .aimee-nav-label": { display: { xs: "none", xl: "inline" }, color: "rgba(255,255,255,0.9)", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.06em" },
              }}
            >
              <AimeeFace size={26} hover />
              <span className="aimee-nav-label">AIMEE</span>
            </Box>
          </Tooltip>
        )}
        <GlobalSearch />
        <TopNavOrgSwitcher />
        <AppSwitcher />
        <NotificationBell />
        <Tooltip title={mode === "dark" ? "Light mode" : "Dark mode"}>
          <IconButton size="small" onClick={toggleMode} sx={{ color: "rgba(255,255,255,0.8)" }}>
            {mode === "dark" ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Divider orientation="vertical" flexItem sx={{ borderColor: "rgba(255,255,255,0.15)", my: 1.25 }} />
        <Typography sx={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.7)", maxWidth: 180, overflow: "hidden", whiteSpace: "nowrap" }}>
          {user?.emailAddresses?.[0]?.emailAddress || user?.fullName || ""}
        </Typography>
        <UserButton afterSignOutUrl="/" />
      </Stack>
    </Box>
  );
}
