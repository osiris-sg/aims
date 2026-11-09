"use client";

// Mounts the org's hotkey map once for the whole portal (guru 2026-11-09).
// The map comes down with /configuration/complete (uiConfig.hotkeys) and is
// read on every key press, so a save on Settings → Hotkeys applies as soon as
// the configuration refreshes. Behind enableHotkeys (default on).

import { useEffect, useRef } from "react";
import { useConfiguration } from "../context/ConfigurationContext";
import { useOrganizationFeatures } from "../hooks/useOrganizationFeatures";
import { installHotkeys, resolveHotkeyMap, type HotkeyMap } from "@/helpers/hotkeys";

export default function HotkeysHost() {
  const { uiConfig } = useConfiguration();
  const { isHotkeysEnabled } = useOrganizationFeatures();
  const mapRef = useRef<HotkeyMap>(resolveHotkeyMap(null));
  mapRef.current = resolveHotkeyMap((uiConfig as any)?.hotkeys ?? null);

  useEffect(() => {
    if (!isHotkeysEnabled) return;
    return installHotkeys(() => mapRef.current);
  }, [isHotkeysEnabled]);

  return null;
}
