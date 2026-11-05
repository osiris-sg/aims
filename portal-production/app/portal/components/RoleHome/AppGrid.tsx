"use client";

// The app launcher (the mock-up's AppGrid.jsx): the grid icon in the top bar
// opens a soft lilac panel with "Home dashboard", a white "Your favourites"
// card of up to six apps, and the role's remaining apps underneath.
//
// Each tile opens the app's first REAL AIMS screen; the top bar then shows
// that app's functions. The pencil is a working editor, not a mock: in edit
// mode every app of the role is shown, a tap adds it to or removes it from
// the favourites (six at most), and the choice is saved per role.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Box, IconButton, Popover, Tooltip, Typography, alpha, useTheme } from "@mui/material";
import AppsRoundedIcon from "@mui/icons-material/AppsRounded";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CalculateOutlinedIcon from "@mui/icons-material/CalculateOutlined";
import AccountBalanceOutlinedIcon from "@mui/icons-material/AccountBalanceOutlined";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import type { SvgIconProps } from "@mui/material";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { withActiveOrg } from "@/helpers/request";
import { APPS, type AppId } from "./apps";
import { useRoleView, writeOpenedApp } from "./useRoleView";

const NAVY = "#2B2257";
const INK = "#1C1A33";

export const APP_ICONS: Record<AppId, React.ComponentType<SvgIconProps>> = {
  accounting: CalculateOutlinedIcon,
  finance: AccountBalanceOutlinedIcon,
  sales: TrendingUpRoundedIcon,
  inventory: ViewInArOutlinedIcon,
  delivery: LocalShippingOutlinedIcon,
  hr: GroupOutlinedIcon,
  ops: AccountTreeOutlinedIcon,
  settings: TuneRoundedIcon,
};

/** The apps of a role that this org and this user can actually open. */
export function useRoleApps() {
  const { role, favourites, setFavourites } = useRoleView();
  const { isModuleEnabled } = useConfiguration();
  const { isModuleAllowed } = useUserPermissions();
  const available = role.apps.filter((id) => {
    const m = APPS[id].module;
    return !m || (isModuleEnabled(m) && isModuleAllowed(m));
  });
  const favs = favourites.filter((id) => available.includes(id));
  return { available, favs, rest: available.filter((id) => !favs.includes(id)), setFavourites };
}

export function AppTile({ id, size = 44 }: { id: AppId; size?: number }) {
  const Icon = APP_ICONS[id];
  return (
    <Box sx={{ height: size, width: size, borderRadius: size >= 40 ? "16px" : "8px", bgcolor: APPS[id].bg, display: "grid", placeItems: "center", boxShadow: "0 1px 2px rgba(0,0,0,.08)", flexShrink: 0 }}>
      <Icon sx={{ fontSize: size * 0.48, color: "#fff" }} />
    </Box>
  );
}

export default function AppGrid() {
  const router = useRouter();
  const t = useTheme();
  const dark = t.palette.mode === "dark";
  const { available, favs, rest, setFavourites } = useRoleApps();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const [editing, setEditing] = React.useState(false);

  const close = () => {
    setAnchor(null);
    setEditing(false);
  };
  const open = (id: AppId | null) => {
    writeOpenedApp(id);
    close();
    router.push(withActiveOrg(id ? APPS[id].home : "/portal"));
  };
  const toggleFav = (id: AppId) => {
    if (favs.includes(id)) setFavourites(favs.filter((x) => x !== id));
    else if (favs.length < 6) setFavourites([...favs, id]);
  };

  const panelBg = dark ? t.palette.background.default : "#EEF0F8";
  const cardBg = dark ? t.palette.background.paper : "#FFFFFF";

  const tile = (id: AppId) => {
    const fav = favs.includes(id);
    const full = editing && !fav && favs.length >= 6;
    return (
      <Box
        key={id}
        component="button"
        type="button"
        onClick={() => (editing ? toggleFav(id) : open(id))}
        disabled={full}
        data-testid={`app-tile-${id}`}
        sx={{
          all: "unset",
          boxSizing: "border-box",
          cursor: full ? "not-allowed" : "pointer",
          opacity: full ? 0.45 : 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1,
          py: 1.5,
          borderRadius: "16px",
          "&:hover": { bgcolor: dark ? alpha("#fff", 0.08) : "#ECEAF7" },
          "&:hover .app-tile-icon": { transform: "scale(1.1)" },
          "& .app-tile-icon": { transition: "transform .15s" },
        }}
      >
        <Box className="app-tile-icon" sx={{ position: "relative" }}>
          <AppTile id={id} />
          {editing && (
            <Box
              sx={{
                position: "absolute", top: -6, right: -6, height: 18, width: 18, borderRadius: "50%",
                display: "grid", placeItems: "center",
                bgcolor: fav ? "#1BA39C" : dark ? alpha("#fff", 0.25) : "#CBD5E1",
                border: `2px solid ${cardBg}`,
              }}
            >
              {fav && <CheckRoundedIcon sx={{ fontSize: 12, color: "#fff" }} />}
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: 13, color: dark ? "text.primary" : INK }}>{APPS[id].name}</Typography>
      </Box>
    );
  };

  return (
    <>
      <Tooltip title="Apps">
        <IconButton
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          data-testid="app-grid-btn"
          sx={{ height: 40, width: 40, borderRadius: "50%", color: dark ? "rgba(255,255,255,0.7)" : "#94A3B8", bgcolor: anchor ? (dark ? alpha("#fff", 0.08) : "#F2F4FA") : "transparent" }}
        >
          <AppsRoundedIcon />
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              mt: 1, width: 320, p: 1, borderRadius: "24px", bgcolor: panelBg, backgroundImage: "none",
              border: "1px solid", borderColor: dark ? alpha("#fff", 0.1) : "#E2E8F0",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,.1), 0 8px 10px -6px rgba(0,0,0,.1)",
            },
          },
        }}
        data-testid="app-grid-panel"
      >
        <Box
          component="button"
          type="button"
          onClick={() => open(null)}
          data-testid="app-grid-home"
          sx={{
            all: "unset", boxSizing: "border-box", cursor: "pointer", width: "100%", mb: 1,
            display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1.5, borderRadius: "20px",
            bgcolor: cardBg, "&:hover": { bgcolor: dark ? alpha("#fff", 0.08) : "#F8F8FC" },
          }}
        >
          <Box sx={{ height: 36, width: 36, borderRadius: "12px", bgcolor: NAVY, display: "grid", placeItems: "center" }}>
            <HomeOutlinedIcon sx={{ fontSize: 18, color: "#fff" }} />
          </Box>
          <Typography sx={{ fontSize: 15, fontWeight: 500, color: dark ? "text.primary" : INK }}>Home dashboard</Typography>
        </Box>

        <Box sx={{ borderRadius: "20px", bgcolor: cardBg, p: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1, pb: 0.5 }}>
            <Box>
              <Typography sx={{ fontSize: 18, fontWeight: 500, color: dark ? "text.primary" : INK }}>
                {editing ? "Edit favourites" : "Your favourites"}
              </Typography>
              {editing && (
                <Typography sx={{ fontSize: 11, color: "text.secondary" }}>Tap to add or remove · {favs.length}/6</Typography>
              )}
            </Box>
            <Tooltip title={editing ? "Done" : "Edit favourites"}>
              <IconButton
                onClick={() => setEditing((v) => !v)}
                data-testid="app-grid-edit"
                sx={{ height: 36, width: 36, borderRadius: "50%", bgcolor: editing ? NAVY : dark ? alpha("#fff", 0.1) : "#ECEAF7", color: editing ? "#fff" : dark ? "text.primary" : NAVY, "&:hover": { bgcolor: editing ? "#3A2F72" : dark ? alpha("#fff", 0.16) : "#E0DDF2" } }}
              >
                {editing ? <CheckRoundedIcon sx={{ fontSize: 18 }} /> : <EditOutlinedIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
            {(editing ? available : favs).map(tile)}
          </Box>
          {!editing && favs.length === 0 && (
            <Typography sx={{ px: 1, py: 2, fontSize: 13, color: "text.secondary" }}>No favourites yet. Use the pencil to pick some.</Typography>
          )}
        </Box>

        {!editing && rest.length > 0 && <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", p: 1.5 }}>{rest.map(tile)}</Box>}
      </Popover>
    </>
  );
}
