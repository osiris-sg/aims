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
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { Autocomplete, TextField, Chip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import NotificationBell from "@/components/NotificationBell";
import { IconButton, Tooltip } from "@mui/material";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import { useThemeMode } from "@/contexts/ThemeModeContext";
import logo from "@/components/Sidebar/aims-logo.png";

// Mirrors DynamicSidebarContent — keep the two in sync.
const HIDDEN_MODULES = new Set<string>(["CUSTOMERS", "SUPPLIERS"]);
const HIDDEN_SUBMENUS: Record<string, string[]> = {
  INVENTORY: ["products", "list"],
};
const ORDER_OVERRIDE: Record<string, number> = { SALES: 0.5 };
// Secondary group — mirrors the sidebar's "Organization Settings" block
// (company profile / accounting setup / Master Files hub). Not module-gated,
// same as the sidebar.
const SETTINGS_MENU = [
  { label: "Company Profile", path: "/portal/settings/company-profile" },
  { label: "Accounting Setup", path: "/portal/settings/accounting-setup" },
  { label: "Master Files", path: "/portal/masterfiles" },
];

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
  const value = orgs.find((o) => o.id === organization?.id) ?? undefined;
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
          value={value}
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
  const { user } = useUser();
  const { mode, toggleMode } = useThemeMode();
  const { modules } = useConfiguration();
  const { isModuleAllowed, userRoles } = useUserPermissions();
  const isAdminUser =
    userRoles.length === 0 ||
    userRoles.some((r: any) => ["superadmin", "admin", "osirisadmin"].includes((r?.name || "").toLowerCase()));

  const [openMenu, setOpenMenu] = React.useState<{ code: string; anchor: HTMLElement } | null>(null);

  const orderKey = (m: any) => ORDER_OVERRIDE[m.moduleCode] ?? m.sortOrder ?? 999;
  const navModules = (modules || [])
    .filter((m: any) => m.enabled)
    .filter((m: any) => isModuleAllowed(m.moduleCode))
    .filter((m: any) => !HIDDEN_MODULES.has(m.moduleCode))
    .map((m: any) => {
      const hide = HIDDEN_SUBMENUS[m.moduleCode];
      const subMenus = (m.config as any)?.subMenus;
      if (!Array.isArray(subMenus)) return m;
      const filtered = subMenus.filter((s: any) => {
        if (typeof s === "object" && s?.adminOnly && !isAdminUser) return false;
        return !hide?.includes(typeof s === "string" ? s : s?.key);
      });
      return { ...m, config: { ...(m.config as any), subMenus: filtered } };
    })
    .sort((a: any, b: any) => orderKey(a) - orderKey(b));

  // Same submenu-route rules as the sidebar.
  const resolveSubmenuRoute = (module: any, submenu: any): string => {
    if (typeof submenu === "object" && submenu?.href) return submenu.href;
    const submenuKey = typeof submenu === "string" ? submenu : submenu.key;
    if (submenuKey === "list") return module.config.route;
    if (submenuKey === "extraction" && module.moduleCode === "DOCUMENTS") return "/portal/document-extraction";
    return `${module.config.route}/${submenuKey}`;
  };
  const submenuLabel = (s: any) => (typeof s === "string" ? s : s?.label || s?.key || "");

  const isModuleActive = (m: any): boolean => {
    const route: string = m.config?.route || "";
    if (!route) return false;
    if (route === "/portal") return rawPathname === "/portal";
    return rawPathname === route || rawPathname.startsWith(route + "/");
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
        <Image src={logo} alt="AIMS" width={26} height={26} style={{ display: "block" }} />
        <Typography sx={{ fontWeight: 800, letterSpacing: "0.06em", fontSize: "0.95rem" }}>AIMS</Typography>
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

        {/* Organization Settings — same secondary group as the sidebar */}
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
          {SETTINGS_MENU.map((s) => (
            <MenuItem key={s.path} onClick={() => go(s.path)} sx={{ fontSize: "0.8125rem", py: 1 }}>
              {s.label}
            </MenuItem>
          ))}
        </Menu>
      </Stack>

      <Stack direction="row" alignItems="center" gap={1} sx={{ flexShrink: 0, ml: 1 }}>
        <TopNavOrgSwitcher />
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
