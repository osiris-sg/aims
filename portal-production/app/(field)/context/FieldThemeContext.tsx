"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { fieldDarkTheme, fieldLightTheme, type FieldMode } from "@/themes/fieldTheme";

/**
 * The field app's OWN theme choice: Light / Dark / Follow phone.
 *
 * Deliberately separate from the office portal's ThemeModeContext (which the
 * field app used to inherit, so a dark phone or the portal's toggle turned the
 * rider's screens dark). The choice is saved per device under its own key and
 * never touches the portal's key.
 *
 * No flash of the wrong theme on open: app/(field)/layout.tsx runs an inline
 * bootstrap script (FIELD_THEME_BOOTSTRAP) before anything paints. It reads
 * the saved choice, stamps `data-field-theme` on <html> and paints the body
 * in the right scaffold colour. The MUI tree is then rendered only once the
 * client has mounted, so the server markup never carries the wrong theme and
 * nothing is hydrated against a mismatched one.
 */

export type FieldThemePreference = "light" | "dark" | "system";

export const FIELD_THEME_STORAGE_KEY = "aims:field-theme";
const FIELD_THEME_ATTR = "data-field-theme";
const SCAFFOLD: Record<FieldMode, string> = { light: "#F4F6F9", dark: "#12151A" };
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Inline script for the field layout. Kept in plain ES5 and mirrored by hand
 * against the constants above (it runs before any module loads).
 */
export const FIELD_THEME_BOOTSTRAP = `(function(){try{var k="${FIELD_THEME_STORAGE_KEY}",p=null;try{p=window.localStorage.getItem(k)}catch(e){}var m=p==="light"||p==="dark"?p:(window.matchMedia&&window.matchMedia("${DARK_QUERY}").matches?"dark":"light");var d=document.documentElement;d.setAttribute("${FIELD_THEME_ATTR}",m);d.style.colorScheme=m;document.body.style.backgroundColor=m==="dark"?"${SCAFFOLD.dark}":"${SCAFFOLD.light}";}catch(e){}})();`;

export function readFieldThemePreference(): FieldThemePreference {
  try {
    const stored = window.localStorage.getItem(FIELD_THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private mode, WebView quirks) - follow phone
  }
  return "system";
}

function writeFieldThemePreference(pref: FieldThemePreference) {
  try {
    if (pref === "system") window.localStorage.removeItem(FIELD_THEME_STORAGE_KEY);
    else window.localStorage.setItem(FIELD_THEME_STORAGE_KEY, pref);
  } catch {
    // ignore - the choice still applies for this session
  }
}

function subscribeSystemDark(onChange: () => void) {
  try {
    const mq = window.matchMedia(DARK_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}
function getSystemDark() {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

const noopSubscribe = () => () => {};

// The saved choice as a tiny external store, so the FIRST client render
// already has it (a mount effect would render "follow phone" for a frame and
// then flip - exactly the flash this file exists to avoid). `current` keeps
// the choice for the session even when localStorage refuses the write.
let current: FieldThemePreference | null = null;
const listeners = new Set<() => void>();
function subscribePreference(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
function getPreference(): FieldThemePreference {
  return current ?? readFieldThemePreference();
}

interface FieldThemeContextValue {
  /** What the rider chose. */
  preference: FieldThemePreference;
  /** What is actually on screen (preference resolved against the phone). */
  mode: FieldMode;
  setPreference: (pref: FieldThemePreference) => void;
}

const FieldThemeContext = createContext<FieldThemeContextValue | null>(null);

export function FieldThemeProvider({ children }: { children: React.ReactNode }) {
  // Server: false. Client: true from the first client render, so the themed
  // tree is never server-rendered (see the docblock).
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const preference = useSyncExternalStore(subscribePreference, getPreference, () => "system" as FieldThemePreference);
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);

  const mode: FieldMode = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  const setPreference = useCallback((pref: FieldThemePreference) => {
    current = pref;
    writeFieldThemePreference(pref);
    listeners.forEach((l) => l());
  }, []);

  // Keep the document in step with the resolved mode (the bootstrap script
  // set these before hydration; a change in the menu or on the phone updates
  // them here). Cleared on unmount so a client navigation into the office
  // portal does not carry the field colours with it.
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute(FIELD_THEME_ATTR, mode);
    html.style.colorScheme = mode;
    document.body.style.backgroundColor = SCAFFOLD[mode];
  }, [mode]);
  useEffect(
    () => () => {
      const html = document.documentElement;
      html.removeAttribute(FIELD_THEME_ATTR);
      html.style.colorScheme = "";
      document.body.style.backgroundColor = "";
    },
    [],
  );

  const value = useMemo(() => ({ preference, mode, setPreference }), [preference, mode, setPreference]);

  if (!mounted) return null;
  return (
    <FieldThemeContext.Provider value={value}>
      <ThemeProvider theme={mode === "dark" ? fieldDarkTheme : fieldLightTheme}>{children}</ThemeProvider>
    </FieldThemeContext.Provider>
  );
}

export function useFieldTheme(): FieldThemeContextValue {
  const ctx = useContext(FieldThemeContext);
  if (!ctx) throw new Error("useFieldTheme must be used within FieldThemeProvider");
  return ctx;
}
