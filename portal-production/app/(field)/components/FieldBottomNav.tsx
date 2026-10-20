"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { BottomNavigation, BottomNavigationAction, Box, Paper } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { fieldChrome } from "@/themes/fieldTheme";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import BuildIcon from "@mui/icons-material/Build";

export type FieldHomeTab = "deliveries" | "maintenance";

// Height of the bar itself, excluding the safe-area inset. Home screens pad
// their content by this (plus the inset) so nothing sits under the bar.
export const FIELD_BOTTOM_NAV_HEIGHT = 68;

const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";

/** Total height the bar occupies, for anything fixed that must sit above it. */
export const FIELD_BOTTOM_NAV_OFFSET = `calc(${FIELD_BOTTOM_NAV_HEIGHT}px + ${SAFE_BOTTOM})`;

/**
 * Fixed bottom nav for the two field home tabs (Deliveries | Maintenance).
 * Rendered ONLY on those two home screens, never inside a flow.
 *
 * Tab switches use `replace`: the homes are top-level, so Back from either
 * leaves the app rather than bouncing between tabs.
 *
 * Look: SiteClock's Material 3 NavigationBar (68 high, surface colour, a pill
 * behind the selected icon, labels 11.5 / w600).
 */
export function FieldBottomNav({ value }: { value: FieldHomeTab }) {
  const router = useRouter();
  const theme = useTheme();
  const pill = fieldChrome(theme).navIndicator;
  return (
    <Paper
      elevation={0}
      square
      sx={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        // Above page content, below the layout's fixed sign-out button (1200).
        zIndex: (t) => t.zIndex.appBar,
        borderTop: 1,
        borderColor: "divider",
        pb: SAFE_BOTTOM,
      }}
    >
      <BottomNavigation
        showLabels
        value={value}
        onChange={(_, next: FieldHomeTab) => {
          if (next === value) return;
          router.replace(next === "maintenance" ? "/scan/maintenance" : "/scan");
        }}
        sx={{
          height: FIELD_BOTTOM_NAV_HEIGHT,
          bgcolor: "transparent",
          "& .MuiBottomNavigationAction-root": {
            pt: "12px",
            pb: "10px",
            gap: "4px",
            justifyContent: "flex-start",
            color: "text.secondary",
            minWidth: 0,
          },
          // The pill sits behind the icon only (64 x 32), as in M3.
          "& .MuiBottomNavigationAction-root svg": {
            width: 64,
            height: 32,
            px: "20px",
            py: "4px",
            boxSizing: "border-box",
            borderRadius: "16px",
            transition: "background-color 160ms ease",
          },
          "& .MuiBottomNavigationAction-root.Mui-selected": { color: "text.primary" },
          "& .MuiBottomNavigationAction-root.Mui-selected svg": { bgcolor: pill, color: "primary.main" },
          "& .MuiBottomNavigationAction-label, & .MuiBottomNavigationAction-label.Mui-selected": {
            fontSize: "11.5px",
            fontWeight: 600,
            lineHeight: 1.2,
          },
        }}
      >
        <BottomNavigationAction label="Deliveries" value="deliveries" icon={<LocalShippingIcon />} />
        <BottomNavigationAction label="Maintenance" value="maintenance" icon={<BuildIcon />} />
      </BottomNavigation>
    </Paper>
  );
}

/** Spacer so the last card on a home screen can scroll clear of the bar. */
export function FieldBottomNavSpacer() {
  return <Box aria-hidden sx={{ flexShrink: 0, height: FIELD_BOTTOM_NAV_OFFSET }} />;
}
