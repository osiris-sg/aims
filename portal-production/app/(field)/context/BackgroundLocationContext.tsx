"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "@clerk/nextjs";
import { Capacitor } from "@capacitor/core";
import { BackgroundGeolocation } from "@capgo/background-geolocation";
import type { Location } from "@capgo/background-geolocation";
import { request } from "@/helpers/request";

/**
 * Background-location provider for the (field) route group.
 *
 * Why this is a context provider and not a hook on the calling page:
 * the Capgo plugin's start() registers a JS callback that the native
 * foreground service invokes on every GPS fix. That callback's closure
 * is owned by whichever React component held the hook — so if the
 * calling page unmounts (e.g. router.replace from /sign to /done), the
 * native service keeps running but its callbacks reach a dead closure
 * and no pings get POSTed.
 *
 * The provider lives at the layout level, which survives every page
 * transition INSIDE the field route group. start() is called from
 * /sign on signature submit, but the callback registered with the
 * native plugin lives on the layout's lifecycle and continues firing
 * across navigations until stop() is called from /do (acknowledge).
 *
 * The provider also drives resume-after-app-kill: on mount it checks
 * localStorage for an active delivery marker and restarts tracking
 * automatically if the backend confirms the delivery is still open.
 */

const STORAGE_KEY = "aims-field-active-delivery";
const PING_INTERVAL_M = 0; // 0 = emit on every native callback (OS-driven timing)
const NOTIFICATION_TITLE = "AIMS Field — Tracking delivery";
const NOTIFICATION_MESSAGE =
  "Recording GPS location until you acknowledge the delivery.";

interface ActiveDelivery {
  reportId: string;
  startedAt: string;
}

export interface BackgroundLocationContextValue {
  isAvailable: boolean;
  isTracking: boolean;
  activeReportId: string | null;
  error: string | null;
  start: (reportId: string) => Promise<void>;
  stop: () => Promise<void>;
}

const BackgroundLocationContext =
  createContext<BackgroundLocationContextValue | null>(null);

function readActive(): ActiveDelivery | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveDelivery;
  } catch {
    return null;
  }
}

function writeActive(record: ActiveDelivery): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

function clearActive(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function BackgroundLocationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { getToken } = useAuth();
  const isAvailable = Capacitor.isNativePlatform();
  const [isTracking, setIsTracking] = useState(false);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs the long-lived plugin callback reads through. Refs are stable across
  // re-renders, so the callback's closure (captured at start() time) always
  // sees the current value rather than the value at registration time.
  const activeReportIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  // Guards resumeIfActive against double-firing if the provider remounts
  // for any reason during initial render.
  const resumedRef = useRef(false);

  const postPing = useCallback(async (loc: Location) => {
    const reportId = activeReportIdRef.current;
    const token = tokenRef.current;
    // Capgo's Location.time is epoch ms (or null). Fall back to "now" so
    // the DTO's @IsISO8601() never sees null, and so pings emitted by the
    // OS in rapid succession without a fresh GPS fix get distinct
    // timestamps — otherwise the (reportId, timestamp) unique constraint
    // silently drops every duplicate via skipDuplicates: true.
    const timestamp = loc.time
      ? new Date(loc.time).toISOString()
      : new Date().toISOString();
    // eslint-disable-next-line no-console
    console.log("[bgLocation] postPing called", {
      hasReportId: !!reportId,
      hasToken: !!token,
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      timestamp,
    });
    if (!reportId || !token) return;
    try {
      // NOTE: the shared helpers/request.ts catches non-2xx HTTP errors and
      // returns { success: false, message } instead of throwing. So a
      // successful await here does NOT mean the backend accepted the ping.
      // Inspect the response shape explicitly below.
      const res = await request(
        {
          path: `/maintenance-reports/${reportId}/location-ping`,
          method: "POST",
        },
        {
          pings: [
            {
              latitude: loc.latitude,
              longitude: loc.longitude,
              accuracy:
                typeof loc.accuracy === "number" ? loc.accuracy : undefined,
              speed: typeof loc.speed === "number" ? loc.speed : undefined,
              heading:
                typeof loc.bearing === "number" ? loc.bearing : undefined,
              timestamp,
            },
          ],
        },
        token,
      );

      // Three response shapes we want to distinguish in Logcat:
      //   { success: false, message }                — request helper caught a non-2xx
      //   { success: true, data: { accepted, skipped }, message }  — normal pass
      //   anything else / undefined                  — unexpected
      if (!res || res.success === false) {
        // eslint-disable-next-line no-console
        console.warn("[bgLocation] ping REJECTED by backend", {
          message: res?.message,
          fullResponse: res,
        });
        return;
      }
      const payload = res?.data ?? {};
      // eslint-disable-next-line no-console
      console.log("[bgLocation] ping accepted", {
        accepted: payload.accepted,
        skipped: payload.skipped,
      });
      if (payload.accepted === 0 && payload.skipped > 0) {
        // Every ping is being silently dropped by the (reportId, timestamp)
        // unique constraint. Usually means Capgo is re-emitting the same
        // cached fix repeatedly.
        // eslint-disable-next-line no-console
        console.warn(
          "[bgLocation] ping was skipped as duplicate — Capgo may be re-emitting a cached fix",
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[bgLocation] ping threw unexpectedly:", err);
    }
  }, []);

  const start = useCallback(
    async (reportId: string) => {
      // eslint-disable-next-line no-console
      console.log("[bgLocation] start() entry", { reportId, isAvailable });
      if (!isAvailable) {
        // eslint-disable-next-line no-console
        console.warn(
          "[bgLocation] start() bailing — Capacitor.isNativePlatform() returned false. " +
            "Background tracking only runs inside the Android shell, not in browser sessions.",
        );
        setError("Background tracking is only available in the native app.");
        return;
      }
      setError(null);
      activeReportIdRef.current = reportId;
      setActiveReportId(reportId);
      writeActive({ reportId, startedAt: new Date().toISOString() });

      const token = await getToken();
      if (!token) {
        // eslint-disable-next-line no-console
        console.warn("[bgLocation] start() got no token from Clerk — bailing");
        setError("Not signed in — cannot start tracking.");
        return;
      }
      tokenRef.current = token;

      try {
        // Stop-first guard: Capgo reports prior-session conflicts via the
        // callback (ALREADY_STARTED) instead of rejecting the promise, so we
        // tear down any leftover service before registering a fresh callback.
        try {
          await BackgroundGeolocation.stop();
          // eslint-disable-next-line no-console
          console.log("[bgLocation] cleared prior session before start");
        } catch {
          // No prior session — fine.
        }

        // eslint-disable-next-line no-console
        console.log("[bgLocation] about to call BackgroundGeolocation.start", {
          backgroundTitle: NOTIFICATION_TITLE,
          distanceFilter: PING_INTERVAL_M,
        });
        await BackgroundGeolocation.start(
          {
            backgroundTitle: NOTIFICATION_TITLE,
            backgroundMessage: NOTIFICATION_MESSAGE,
            requestPermissions: true,
            stale: false,
            distanceFilter: PING_INTERVAL_M,
          },
          (location, callbackError) => {
            // eslint-disable-next-line no-console
            console.log("[bgLocation] CALLBACK fired", {
              hasLocation: !!location,
              hasError: !!callbackError,
              errorCode: callbackError?.code,
              errorMessage: callbackError?.message,
              latitude: location?.latitude,
              longitude: location?.longitude,
            });
            if (callbackError) {
              const code = callbackError.code;
              if (code === "ALREADY_STARTED") {
                // eslint-disable-next-line no-console
                console.warn(
                  "[bgLocation] received ALREADY_STARTED despite stop-first guard — ignoring",
                );
                return;
              }
              setError(callbackError.message ?? "Location callback error");
              return;
            }
            if (location) {
              void postPing(location);
            }
          },
        );
        // eslint-disable-next-line no-console
        console.log(
          "[bgLocation] BackgroundGeolocation.start resolved — tracking now active",
        );
        setIsTracking(true);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error("[bgLocation] BackgroundGeolocation.start REJECTED", e);
        setError(e?.message ?? "Failed to start background tracking");
        activeReportIdRef.current = null;
        setActiveReportId(null);
        clearActive();
      }
    },
    [isAvailable, getToken, postPing],
  );

  const stop = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.log("[bgLocation] stop() called", { isAvailable });
    if (!isAvailable) {
      clearActive();
      activeReportIdRef.current = null;
      setActiveReportId(null);
      return;
    }
    try {
      await BackgroundGeolocation.stop();
    } catch {
      // Already stopped — fine
    }
    setIsTracking(false);
    activeReportIdRef.current = null;
    setActiveReportId(null);
    tokenRef.current = null;
    clearActive();
  }, [isAvailable]);

  const resumeIfActive = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.log("[bgLocation] resumeIfActive() called", { isAvailable });
    if (!isAvailable) return;
    const stored = readActive();
    // eslint-disable-next-line no-console
    console.log("[bgLocation] resumeIfActive stored:", stored);
    if (!stored?.reportId) return;

    try {
      const token = await getToken();
      if (!token) return;
      const res = await request(
        {
          path: `/maintenance-reports/${stored.reportId}/location-track`,
          method: "GET",
        },
        {},
        token,
      );
      const data = res?.data ?? res;
      if (!data || data.success === false) {
        // eslint-disable-next-line no-console
        console.log(
          "[bgLocation] resume: backend rejected — clearing stale entry",
        );
        clearActive();
        return;
      }
      const payload = data.data ?? data;
      if (payload?.isActive === false) {
        // eslint-disable-next-line no-console
        console.log(
          "[bgLocation] resume: delivery already acked — clearing",
        );
        clearActive();
        return;
      }
      // eslint-disable-next-line no-console
      console.log(
        "[bgLocation] resume: restarting tracking for",
        stored.reportId,
      );
      await start(stored.reportId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[bgLocation] resumeIfActive failed:", err);
    }
  }, [isAvailable, getToken, start]);

  // Resume any in-flight delivery exactly once per provider mount. The guard
  // ref handles React-18 dev-mode double-invocation; in production it's
  // belt-and-suspenders.
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    void resumeIfActive();
    // resumeIfActive is stable (useCallback) but we deliberately don't depend
    // on it — we want this exactly once per mount, not on token refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: BackgroundLocationContextValue = {
    isAvailable,
    isTracking,
    activeReportId,
    error,
    start,
    stop,
  };

  return (
    <BackgroundLocationContext.Provider value={value}>
      {children}
    </BackgroundLocationContext.Provider>
  );
}

/**
 * Read access to background-tracking state and the start/stop signals.
 * Must be called from a descendant of <BackgroundLocationProvider> — i.e.
 * any component inside the (field) route group.
 */
export function useBackgroundLocationContext(): BackgroundLocationContextValue {
  const ctx = useContext(BackgroundLocationContext);
  if (!ctx) {
    throw new Error(
      "useBackgroundLocationContext must be used inside a BackgroundLocationProvider " +
        "(i.e. somewhere under app/(field)/layout.tsx).",
    );
  }
  return ctx;
}
