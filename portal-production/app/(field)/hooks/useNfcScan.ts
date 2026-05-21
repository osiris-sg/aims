"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { CapacitorNfc } from "@capgo/capacitor-nfc";

/**
 * Cross-platform NFC tag reader for the field-tech scan flow.
 *
 * Reads the hardware UID of an NFC tag and normalises it to a single canonical
 * format — lowercase colon-separated hex (e.g. "04:a1:b2:c3:d4:e5:f6") —
 * regardless of platform. Existing assets in the DB were bound via Web NFC
 * which emits this exact format, so the backend's nfcTagUid column stays
 * consistent across web and native scans.
 *
 * Platform selection (resolved on mount):
 *   - Capacitor native shell → @capgo/capacitor-nfc with iosSessionType: 'tag'
 *     (NFCTagReaderSession on iOS — required for reading raw UIDs;
 *      enableReaderMode on Android).
 *   - Browser with `window.NDEFReader` (Chrome on Android only) → Web NFC.
 *   - Neither → isSupported: false, scan attempts no-op with an error.
 *
 * The hook auto-stops after the first successful read on both platforms so
 * the caller doesn't have to. The caller observes `uid` to react to a scan.
 */

export interface UseNfcScanResult {
  /** undefined while the capability check is in flight; boolean after. */
  isSupported: boolean | undefined;
  isScanning: boolean;
  uid: string | null;
  error: string | null;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
}

type Platform = "native" | "web" | "unsupported";

function bytesToColonHex(bytes: number[]): string {
  return bytes
    .map((b) => (b & 0xff).toString(16).padStart(2, "0"))
    .join(":");
}

function normalizeUid(raw: string | number[] | null | undefined): string | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) return bytesToColonHex(raw);
  // Web NFC returns colon-separated hex — may already match. Lowercase + strip
  // whitespace to guarantee canonical form regardless of browser quirks.
  return raw.trim().toLowerCase();
}

export function useNfcScan(): UseNfcScanResult {
  const [platform, setPlatform] = useState<Platform | undefined>(undefined);
  const [isScanning, setIsScanning] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Native listener handle — kept in a ref so cleanup can remove it without
  // restarting the effect each render.
  const listenerRef = useRef<PluginListenerHandle | null>(null);
  // Web NFC AbortController — controls the underlying reader.scan() lifetime.
  const webAbortRef = useRef<AbortController | null>(null);

  // Resolve which path to use on mount. The Capacitor.isNativePlatform() check
  // is synchronous; the plugin's hardware check is async so we only do it
  // when needed and accept null until then.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const { supported } = await CapacitorNfc.isSupported();
          if (!cancelled) setPlatform(supported ? "native" : "unsupported");
        } catch {
          if (!cancelled) setPlatform("unsupported");
        }
        return;
      }
      if (typeof window !== "undefined" && "NDEFReader" in window) {
        if (!cancelled) setPlatform("web");
        return;
      }
      if (!cancelled) setPlatform("unsupported");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- Native path (Capacitor + Capgo plugin) -----------------------------

  const stopNative = useCallback(async () => {
    if (listenerRef.current) {
      try {
        await listenerRef.current.remove();
      } catch {
        // listener may already be removed by the plugin after a tag scan
      }
      listenerRef.current = null;
    }
    try {
      await CapacitorNfc.stopScanning();
    } catch {
      // session may already be closed (auto-invalidate after first read)
    }
    setIsScanning(false);
  }, []);

  const startNative = useCallback(async () => {
    setError(null);
    setUid(null);
    try {
      // Register the listener BEFORE starting the session so we don't miss the
      // tag event on fast hardware.
      const handle = await CapacitorNfc.addListener("nfcEvent", (event) => {
        const id = event?.tag?.id;
        const normalised = Array.isArray(id) ? bytesToColonHex(id) : null;
        if (!normalised) {
          setError("Tag has no readable serial number.");
          return;
        }
        setUid(normalised);
        // Plugin auto-invalidates on iOS after first read; explicitly stop on
        // Android (and clean up the listener) so the reader doesn't keep
        // firing.
        void stopNative();
      });
      listenerRef.current = handle;

      await CapacitorNfc.startScanning({
        iosSessionType: "tag",
        invalidateAfterFirstRead: true,
        alertMessage: "Hold your phone near the asset's NFC tag.",
      });
      setIsScanning(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start NFC scan.");
      await stopNative();
    }
  }, [stopNative]);

  // ----- Web path (Web NFC NDEFReader) --------------------------------------

  const stopWeb = useCallback(async () => {
    if (webAbortRef.current) {
      webAbortRef.current.abort();
      webAbortRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startWeb = useCallback(async () => {
    setError(null);
    setUid(null);
    try {
      const NDEFReader = (window as unknown as { NDEFReader: new () => any })
        .NDEFReader;
      const reader = new NDEFReader();
      const controller = new AbortController();
      webAbortRef.current = controller;
      await reader.scan({ signal: controller.signal });
      setIsScanning(true);
      reader.onreading = (event: any) => {
        const raw = event?.serialNumber as string | undefined;
        const normalised = normalizeUid(raw ?? null);
        if (!normalised) {
          setError("Tag has no readable serial number.");
          return;
        }
        setUid(normalised);
        void stopWeb();
      };
      reader.onreadingerror = () => {
        setError("Failed to read tag — try again.");
      };
    } catch (e: any) {
      setError(e?.message ?? "Failed to start NFC scan.");
      await stopWeb();
    }
  }, [stopWeb]);

  // ----- Public surface -----------------------------------------------------

  const startScan = useCallback(async () => {
    if (platform === "native") return startNative();
    if (platform === "web") return startWeb();
    setError("NFC isn't available on this device.");
  }, [platform, startNative, startWeb]);

  const stopScan = useCallback(async () => {
    if (platform === "native") return stopNative();
    if (platform === "web") return stopWeb();
  }, [platform, stopNative, stopWeb]);

  // Cleanup on unmount — bail out of any in-flight session and remove
  // listeners so the next mount starts clean.
  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        listenerRef.current.remove().catch(() => {});
        listenerRef.current = null;
      }
      if (webAbortRef.current) {
        webAbortRef.current.abort();
        webAbortRef.current = null;
      }
      // Best-effort stop — ignore errors (session may already be closed).
      CapacitorNfc.stopScanning().catch(() => {});
    };
  }, []);

  return {
    isSupported: platform === undefined ? undefined : platform !== "unsupported",
    isScanning,
    uid,
    error,
    startScan,
    stopScan,
  };
}
