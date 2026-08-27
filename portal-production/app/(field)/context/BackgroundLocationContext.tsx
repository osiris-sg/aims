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

// Local ping queue (batch + retry + drain). The old path POSTed one ping per
// fix and, on any failure, logged and dropped it forever — so a transient
// mobile-data drop looked identical to a tracking gap. Fixes are now buffered
// and POSTed in batches; a failed batch stays queued and retries. Retries are
// safe because DeliveryLocationPing has @@unique([reportId, timestamp]) and the
// endpoint inserts with skipDuplicates, so a re-sent batch never double-inserts
// (each queued ping keeps its capture timestamp, so the unique key is stable).
const FLUSH_INTERVAL_MS = 5000; // drain cadence
const FLUSH_AT_QUEUE_LEN = 10; // ...or flush immediately once this many buffer
const BATCH_MAX_PINGS = 50; // max pings per POST request
const MAX_QUEUE = 1000; // hard cap; oldest fixes evicted beyond this (bounded memory)

// Shown once (until the tech visits Settings) to explain that Android needs
// "Allow all the time" for tracking to survive the screen turning off.
const BG_NOTICE_KEY = "aims-field-bg-location-notice-ack";

interface ActiveDelivery {
  reportId: string;
  startedAt: string;
}

export interface BackgroundLocationContextValue {
  isAvailable: boolean;
  isTracking: boolean;
  activeReportId: string | null;
  error: string | null;
  start: (reportId: string, opts?: { isResume?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
}

interface QueuedPing {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: string;
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

  // Ping queue + the machinery that drains it. queueRef holds captured-but-not-
  // yet-acknowledged fixes; flushingRef prevents overlapping flushes; the timer
  // and online handler drive periodic + on-reconnect draining.
  const queueRef = useRef<QueuedPing[]>([]);
  const flushingRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const onlineHandlerRef = useRef<(() => void) | null>(null);

  // "Allow all the time" rationale overlay (JS-only: we cannot trigger the
  // background-location prompt from JS with this plugin, so we explain and route
  // to Settings via BackgroundGeolocation.openSettings()).
  const [bgNoticeOpen, setBgNoticeOpen] = useState(false);

  // Drain the queue: POST buffered fixes in batches. A failed batch is LEFT in
  // the queue and retried on the next tick (or the next `online` event) instead
  // of being dropped. A fresh token is fetched per flush so a long delivery
  // outliving the start-time token doesn't silently 401 every ping.
  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return;
    const reportId = activeReportIdRef.current;
    if (!reportId || queueRef.current.length === 0) return;
    flushingRef.current = true;
    try {
      const token = await getToken();
      if (!token) return; // keep the queue; try again next tick
      // Drain several batches per tick so a reconnect backlog clears fast;
      // stop on the first failure (kept for retry) or when empty.
      for (let i = 0; i < 20 && queueRef.current.length > 0; i++) {
        const batch = queueRef.current.slice(0, BATCH_MAX_PINGS);
        // NOTE: helpers/request.ts turns non-2xx into { success:false } rather
        // than throwing, so inspect the shape rather than trusting the await.
        const res = await request(
          {
            path: `/maintenance-reports/${reportId}/location-ping`,
            method: "POST",
          },
          { pings: batch },
          token,
        );
        if (!res || res.success === false) {
          // eslint-disable-next-line no-console
          console.warn("[bgLocation] batch POST failed — kept for retry", {
            queueLen: queueRef.current.length,
            message: res?.message,
          });
          break;
        }
        // Remove exactly what we sent from the FRONT — new fixes appended
        // during the await must not be dropped.
        queueRef.current.splice(0, batch.length);
        const payload = res?.data ?? {};
        // eslint-disable-next-line no-console
        console.log("[bgLocation] batch accepted", {
          sent: batch.length,
          accepted: payload.accepted,
          skipped: payload.skipped,
          remaining: queueRef.current.length,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[bgLocation] flush threw — queue kept for retry:", err);
    } finally {
      flushingRef.current = false;
    }
  }, [getToken]);

  // Buffer one fix. Never awaits a network call, so it stays cheap on the GPS
  // callback path and works fully offline. Capgo's Location.time is epoch ms (or
  // null) — fall back to "now" so the DTO's @IsISO8601() never sees null and
  // rapid re-emits of a cached fix still get distinct timestamps.
  const enqueuePing = useCallback(
    (loc: Location) => {
      const timestamp = loc.time
        ? new Date(loc.time).toISOString()
        : new Date().toISOString();
      const q = queueRef.current;
      q.push({
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: typeof loc.accuracy === "number" ? loc.accuracy : undefined,
        speed: typeof loc.speed === "number" ? loc.speed : undefined,
        heading: typeof loc.bearing === "number" ? loc.bearing : undefined,
        timestamp,
      });
      // Bounded buffer: a long offline stretch cannot grow memory without limit.
      // Evict the OLDEST fixes past the cap so the most recent trail survives.
      if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
      // eslint-disable-next-line no-console
      console.log("[bgLocation] ping queued", {
        queueLen: q.length,
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp,
      });
      if (q.length >= FLUSH_AT_QUEUE_LEN) void flushQueue();
    },
    [flushQueue],
  );

  const start = useCallback(
    async (reportId: string, opts?: { isResume?: boolean }) => {
      // eslint-disable-next-line no-console
      console.log("[bgLocation] start() entry", { reportId, isAvailable, isResume: !!opts?.isResume });
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
      // Fresh delivery: start from an empty buffer so no stale pings from a
      // prior report ever POST against this reportId.
      queueRef.current = [];
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
              enqueuePing(location);
            }
          },
        );
        // eslint-disable-next-line no-console
        console.log(
          "[bgLocation] BackgroundGeolocation.start resolved — tracking now active",
        );
        setIsTracking(true);

        // Drain the buffer on a timer and whenever connectivity returns.
        if (flushTimerRef.current == null) {
          flushTimerRef.current = window.setInterval(() => {
            void flushQueue();
          }, FLUSH_INTERVAL_MS);
        }
        if (!onlineHandlerRef.current) {
          const handler = () => {
            // eslint-disable-next-line no-console
            console.log("[bgLocation] back online — draining queue");
            void flushQueue();
          };
          onlineHandlerRef.current = handler;
          window.addEventListener("online", handler);
        }

        // Background-location step: after foreground is granted (Capgo's
        // requestPermissions handled that during start()), explain that Android
        // needs "Allow all the time" for tracking to survive the screen turning
        // off, and offer Settings. Not shown on resume, and suppressed once the
        // tech has visited Settings. We cannot detect the actual grant or fire
        // the prompt from JS with this plugin (see the native follow-up).
        if (!opts?.isResume && typeof window !== "undefined") {
          let acked = false;
          try {
            acked = window.localStorage.getItem(BG_NOTICE_KEY) === "1";
          } catch {
            acked = false;
          }
          if (!acked) setBgNoticeOpen(true);
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error("[bgLocation] BackgroundGeolocation.start REJECTED", e);
        setError(e?.message ?? "Failed to start background tracking");
        activeReportIdRef.current = null;
        setActiveReportId(null);
        clearActive();
      }
    },
    [isAvailable, getToken, enqueuePing, flushQueue],
  );

  const stop = useCallback(async () => {
    // eslint-disable-next-line no-console
    console.log("[bgLocation] stop() called", { isAvailable });
    if (!isAvailable) {
      queueRef.current = [];
      clearActive();
      activeReportIdRef.current = null;
      setActiveReportId(null);
      return;
    }
    // Best-effort: send anything still buffered (e.g. the final fixes at the
    // drop-off) while activeReportIdRef is still set, before we tear down.
    try {
      await flushQueue();
    } catch {
      // Whatever couldn't send is discarded below — the delivery is closing.
    }
    try {
      await BackgroundGeolocation.stop();
    } catch {
      // Already stopped — fine
    }
    if (flushTimerRef.current != null) {
      window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (onlineHandlerRef.current) {
      window.removeEventListener("online", onlineHandlerRef.current);
      onlineHandlerRef.current = null;
    }
    setIsTracking(false);
    activeReportIdRef.current = null;
    setActiveReportId(null);
    tokenRef.current = null;
    queueRef.current = [];
    clearActive();
  }, [isAvailable, flushQueue]);

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
      await start(stored.reportId, { isResume: true });
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

  // Remember the tech has seen the notice once they visit Settings, so we stop
  // showing it every delivery. "Not now" does NOT set the flag — a tech who
  // keeps dismissing keeps being reminded, since we can't confirm the grant.
  const markBgNoticeAcked = useCallback(() => {
    try {
      window.localStorage.setItem(BG_NOTICE_KEY, "1");
    } catch {
      // Private mode / storage disabled — worst case the notice shows again.
    }
  }, []);

  const openLocationSettings = useCallback(async () => {
    markBgNoticeAcked();
    setBgNoticeOpen(false);
    try {
      await BackgroundGeolocation.openSettings();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[bgLocation] openSettings failed", err);
    }
  }, [markBgNoticeAcked]);

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
      {bgNoticeOpen && (
        // Plain inline-styled overlay (no MUI dependency) so it renders reliably
        // inside the field route group on the Sunmi device. Screen only.
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="aims-bg-notice-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              maxWidth: 420,
              width: "100%",
              padding: 20,
              boxShadow: "0 8px 30px rgba(0,0,0,0.3)",
            }}
          >
            <h2 id="aims-bg-notice-title" style={{ margin: "0 0 8px", fontSize: 18 }}>
              Keep tracking with the screen off
            </h2>
            <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#333" }}>
              To record your full delivery route, Android needs location set to{" "}
              <strong>Allow all the time</strong>. If it is only set to{" "}
              <strong>While using the app</strong>, tracking pauses when your screen
              turns off, and the route between stops will be missing.
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.5, color: "#666" }}>
              Open Settings, tap Permissions, then Location, and choose Allow all the time.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setBgNoticeOpen(false)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  background: "#fff",
                  fontSize: 14,
                }}
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => void openLocationSettings()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#1976d2",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Open Settings
              </button>
            </div>
          </div>
        </div>
      )}
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
