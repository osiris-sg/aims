"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LogoutIcon from "@mui/icons-material/Logout";
import { fieldChrome } from "@/themes/fieldTheme";

/**
 * The field app's top bar (SiteClock AppBar): navy in light, dark surface in
 * dark, rendered ONCE by the field layout so the sign-out button is on every
 * screen (it used to float top-right at zIndex 1200; the bar keeps that layer).
 *
 * Screens describe the bar with `useFieldAppBar({ title, onBack })`:
 * - no title  -> the AIMS wordmark (home tabs pass `section` as the suffix);
 * - `onBack`  -> a back arrow running the screen's OWN handler, so a back that
 *               used to live in the page body keeps exactly its behaviour.
 * A screen that sets nothing gets the wordmark and no back arrow.
 */

export const FIELD_APP_BAR_HEIGHT = 56;
const SAFE_TOP = "env(safe-area-inset-top, 0px)";
/** Total height the bar occupies, for anything sticky that must sit under it. */
export const FIELD_APP_BAR_OFFSET = `calc(${FIELD_APP_BAR_HEIGHT}px + ${SAFE_TOP})`;

export interface FieldAppBarConfig {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Suffix next to the wordmark on the home tabs ("Deliveries"). */
  section?: string;
  onBack?: () => void;
  backDisabled?: boolean;
}

type Ctx = { set: (key: number, cfg: FieldAppBarConfig | null) => void };
const FieldAppBarContext = createContext<Ctx | null>(null);
let nextKey = 1;

/**
 * Describe the bar for the current screen. The latest mounted caller wins;
 * unmounting restores the previous one. `onBack` is read through a ref so a
 * fresh closure each render is fine (no stale state in the handler).
 */
export function useFieldAppBar(cfg: FieldAppBarConfig) {
  const ctx = useContext(FieldAppBarContext);
  const keyRef = useRef(0);
  if (!keyRef.current) keyRef.current = nextKey++;
  const backRef = useRef(cfg.onBack);
  backRef.current = cfg.onBack;
  const hasBack = !!cfg.onBack;

  useEffect(() => {
    if (!ctx) return;
    ctx.set(keyRef.current, {
      title: cfg.title,
      subtitle: cfg.subtitle,
      section: cfg.section,
      backDisabled: cfg.backDisabled,
      onBack: hasBack ? () => backRef.current?.() : undefined,
    });
    // A JSX title re-publishes each render; that only re-renders the bar
    // (the provider's children are a stable element), never the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, cfg.title, cfg.subtitle, cfg.section, cfg.backDisabled, hasBack]);

  useEffect(() => {
    const key = keyRef.current;
    return () => ctx?.set(key, null);
  }, [ctx]);
}

export function FieldAppBarProvider({ onSignOut, children }: { onSignOut: () => void; children: React.ReactNode }) {
  const [stack, setStack] = useState<{ key: number; cfg: FieldAppBarConfig }[]>([]);
  const ctx = useMemo<Ctx>(
    () => ({
      set: (key, cfg) =>
        setStack((prev) => {
          const rest = prev.filter((e) => e.key !== key);
          if (!cfg) return rest;
          const i = prev.findIndex((e) => e.key === key);
          if (i === -1) return [...rest, { key, cfg }];
          const next = [...prev];
          next[i] = { key, cfg };
          return next;
        }),
    }),
    [],
  );
  const current = stack.length ? stack[stack.length - 1].cfg : {};
  return (
    <FieldAppBarContext.Provider value={ctx}>
      <FieldAppBar {...current} onSignOut={onSignOut} />
      {children}
    </FieldAppBarContext.Provider>
  );
}

function Wordmark({ color }: { color: string }) {
  return (
    <Typography component="span" sx={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.04em", color, lineHeight: 1 }}>
      AIMS
    </Typography>
  );
}

function FieldAppBar({
  title,
  subtitle,
  section,
  onBack,
  backDisabled,
  onSignOut,
}: FieldAppBarConfig & { onSignOut: () => void }) {
  const theme = useTheme();
  const chrome = fieldChrome(theme);
  const fg = chrome.onAppBar;
  return (
    <Box
      component="header"
      sx={{
        position: "sticky",
        top: 0,
        // The old floating sign-out button's layer: above the bottom nav
        // (1100), below dialogs (1300) and the background-location notice.
        zIndex: 1200,
        flexShrink: 0,
        bgcolor: chrome.appBar,
        color: fg,
        pt: SAFE_TOP,
        borderBottom: theme.palette.mode === "dark" ? `1px solid ${chrome.border}` : "none",
      }}
    >
      <Box sx={{ height: FIELD_APP_BAR_HEIGHT, display: "flex", alignItems: "center", gap: 0.5, pl: onBack ? 0.5 : 2, pr: 0.5 }}>
        {onBack && (
          <IconButton aria-label="Back" onClick={onBack} disabled={backDisabled} sx={{ color: fg, "&.Mui-disabled": { color: fg, opacity: 0.4 } }}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {title ? (
            <>
              <Typography variant="h6" noWrap sx={{ color: fg, lineHeight: 1.2 }}>
                {title}
              </Typography>
              {subtitle && (
                <Typography noWrap sx={{ color: fg, opacity: 0.72, fontSize: 12.5, fontWeight: 500, lineHeight: 1.3 }}>
                  {subtitle}
                </Typography>
              )}
            </>
          ) : (
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
              <Wordmark color={fg} />
              {section && (
                <Typography component="span" sx={{ color: fg, opacity: 0.72, fontSize: 13, fontWeight: 600 }}>
                  {section}
                </Typography>
              )}
            </Box>
          )}
        </Box>
        <Tooltip title="Sign out">
          <IconButton aria-label="Sign out" onClick={onSignOut} sx={{ color: fg }}>
            <LogoutIcon />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
