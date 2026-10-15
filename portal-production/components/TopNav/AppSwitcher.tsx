"use client";

// App switcher (AIMS ↔ SiteClock link, 2026-10): a Google-style app launcher
// in the portal header. Grid icon → dropdown with one round tile per app, both
// always visible: AIMS (this portal) and SiteClock (the site clock-in app,
// sharing the same Clerk login). Mounted in the desktop TopNavBar and the
// mobile Appnavbar only, so it never appears in the (field) app or on public
// routes.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Box, ButtonBase, IconButton, Popover, Tooltip, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import AppsRoundedIcon from "@mui/icons-material/AppsRounded";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import Image from "next/image";
import logo from "@/components/Sidebar/aims-logo.png";

export const SITECLOCK_URL = "https://siteclock.osiris.sg";
// ?from=aims makes SiteClock sync the AIMS session once on that visit (direct visits never sync)
export const SITECLOCK_FROM_AIMS_URL = SITECLOCK_URL + "/?from=aims";

type AppTile = {
  key: string;
  label: string;
  href: string;
  external: boolean;
  color: string;
  icon: React.ReactNode;
};

const APPS: AppTile[] = [
  {
    key: "aims",
    label: "AIMS",
    href: "/portal",
    external: false,
    color: "#041627",
    icon: <Image src={logo} alt="" width={24} height={24} style={{ display: "block" }} />,
  },
  {
    key: "siteclock",
    label: "SiteClock",
    href: SITECLOCK_FROM_AIMS_URL,
    external: true,
    color: "#0e7490",
    icon: <AccessTimeRoundedIcon sx={{ color: "#FFFFFF", fontSize: 26 }} />,
  },
];

export default function AppSwitcher({ sx, iconColor }: { sx?: SxProps<Theme>; iconColor?: string }) {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const go = (app: AppTile) => {
    setAnchorEl(null);
    if (app.external) {
      window.location.assign(app.href);
    } else {
      router.push(app.href);
    }
  };

  return (
    <>
      <Tooltip title="Apps">
        <IconButton
          size="small"
          aria-label="Apps"
          aria-haspopup="true"
          aria-expanded={open ? "true" : undefined}
          data-tour="app-switcher"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{ color: iconColor ?? "rgba(255,255,255,0.8)", ...sx }}
        >
          <AppsRoundedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 1, p: 1.5, borderRadius: 3, width: 232 } } }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 0.5 }}>
          {APPS.map((app) => (
            <ButtonBase
              key={app.key}
              onClick={() => go(app)}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                p: 1.5,
                borderRadius: 2,
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Box
                sx={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  bgcolor: app.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                }}
              >
                {app.icon}
              </Box>
              <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: "text.primary", lineHeight: 1.2 }}>
                {app.label}
              </Typography>
            </ButtonBase>
          ))}
        </Box>
      </Popover>
    </>
  );
}
