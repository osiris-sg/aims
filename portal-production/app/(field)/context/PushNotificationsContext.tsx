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
import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import type { PushNotificationSchema, Token } from "@capacitor/push-notifications";
import { toast } from "react-toastify";

/**
 * Push registration for the (field) route group.
 *
 * The office schedules a delivery; the backend pushes it to every active
 * field-tech in the org (see api-server-production/src/push). This is the
 * device half: get an FCM token, keep the backend's DeviceToken row current,
 * and drop it at logout.
 *
 * Lives at the layout level for the same reason BackgroundLocationContext
 * does — the plugin's listeners are registered against whichever React tree
 * called addListener(), and a per-page hook would tear them down on the first
 * router.replace. The layout survives every navigation inside (field).
 *
 * NOTHING here is load-bearing for the rest of the app. Every failure path —
 * permission declined, no Google Play services, offline, backend 500 — logs
 * and returns. A rider who taps "Don't allow" gets an app that works exactly
 * as it did before push existed; they just keep finding new deliveries by
 * opening the Scheduled Deliveries screen themselves.
 */

/**
 * Android notification channel. The id MUST equal the `channelId` the backend
 * sets on the FCM message (deliveries.service.ts -> PushService), because
 * Android 8+ silently DISCARDS a notification whose channel does not exist —
 * no error, no tray entry, nothing in logcat that names the cause. If you
 * rename it here, rename it there in the same commit.
 */
const CHANNEL_ID = "aims-deliveries";

/**
 * The token we last successfully handed to the backend. Persisted because the
 * DELETE at logout needs to name a token, and by then the plugin listener that
 * knew it may be long gone. Also lets a start-up POST that failed offline be
 * retried rather than lost.
 */
const TOKEN_KEY = "aims-field-push-token";
/** Set once the POST for TOKEN_KEY's value has been acknowledged. */
const SYNCED_KEY = "aims-field-push-token-synced";

type PushPermission = "unknown" | "granted" | "denied" | "unsupported";

export interface PushNotificationsContextValue {
  /** Native shell only — a browser session can never register. */
  isAvailable: boolean;
  permission: PushPermission;
  /** The FCM token currently held, if any. Diagnostic; nothing branches on it. */
  token: string | null;
}

const PushNotificationsContext =
  createContext<PushNotificationsContextValue | null>(null);

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage disabled — we lose the logout DELETE, and the backend prunes the
    // row on its first dead-token send instead. Not worth failing over.
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* see readStored */
  }
}

/**
 * POST/DELETE /device-tokens with a plain fetch rather than helpers/request.
 *
 * Deliberate: request() dispatches a global Redux error notification on ANY
 * non-2xx, so a rider standing in a lift with no signal would get a red error
 * toast about a background bookkeeping call they never asked for. Push
 * registration must be invisible when it fails.
 */
async function callDeviceTokens(
  method: "POST" | "DELETE",
  body: Record<string, string>,
  authToken: string,
): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  if (!base) return false;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };
  // Mirror helpers/request: an osiris-admin viewing another org must register
  // against the org they are viewing, which is the one the backend's
  // @UserOrganization() will resolve. Ignored by the backend for everyone else.
  if (typeof window !== "undefined") {
    const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
    if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
  }
  try {
    const res = await fetch(`${base}/device-tokens`, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Drop this device's token at logout, so a phone handed to another rider stops
 * receiving the previous rider's deliveries.
 *
 * Exported as a bare function, not through the context, because the sign-out
 * button lives in FieldLayout — the component that RENDERS the provider and so
 * cannot consume it. Takes Clerk's getToken because it must run while the
 * session is still valid, i.e. strictly before signOut().
 */
export async function unregisterDeviceToken(
  getToken: () => Promise<string | null>,
): Promise<void> {
  const token = readStored(TOKEN_KEY);
  if (!token) return;
  try {
    const authToken = await getToken();
    // Clear locally regardless of the network call: the user is leaving, and a
    // stale local token would otherwise be re-POSTed by the next rider's
    // session. The backend prunes server-side on its next dead-token send.
    if (authToken) await callDeviceTokens("DELETE", { token }, authToken);
  } catch {
    /* logout must never fail because of push */
  } finally {
    writeStored(TOKEN_KEY, null);
    writeStored(SYNCED_KEY, null);
  }
}

export function PushNotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const isAvailable = Capacitor.isNativePlatform();
  const [permission, setPermission] = useState<PushPermission>(
    isAvailable ? "unknown" : "unsupported",
  );
  const [token, setToken] = useState<string | null>(null);

  // Init runs exactly once per mount. React 18 dev-mode double-invokes effects,
  // and registering the plugin listeners twice would POST every token twice.
  const initedRef = useRef(false);
  const listenersRef = useRef<PluginListenerHandle[]>([]);
  const tokenRef = useRef<string | null>(null);

  /**
   * Hand a token to the backend. Idempotent by design — the endpoint upserts
   * and refreshes lastSeenAt, so re-POSTing an unchanged token on every app
   * start is the intended behaviour, not waste: it is what keeps lastSeenAt
   * meaningful and re-creates the row if it was pruned.
   */
  const syncToken = useCallback(
    async (value: string) => {
      tokenRef.current = value;
      setToken(value);
      writeStored(TOKEN_KEY, value);
      try {
        const authToken = await getToken();
        if (!authToken) return; // not signed in yet; retried on next start
        const ok = await callDeviceTokens(
          "POST",
          { token: value, platform: "android" },
          authToken,
        );
        writeStored(SYNCED_KEY, ok ? value : null);
        if (!ok) {
          // eslint-disable-next-line no-console
          console.warn("[push] device-token POST rejected — will retry");
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[push] device-token POST threw — will retry", err);
      }
    },
    [getToken],
  );

  useEffect(() => {
    // A browser session has no FCM token to give. Bail before touching the
    // plugin so the field pages still work in a desktop browser.
    if (!isAvailable) return;
    // Every call needs a Clerk token; registering before sign-in would just 401
    // and burn the one token event we get.
    if (!isLoaded || !isSignedIn) return;
    if (initedRef.current) return;
    initedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        // Channel FIRST. A push can arrive between register() and the channel
        // existing, and Android drops it silently if the channel is missing.
        try {
          await PushNotifications.createChannel({
            id: CHANNEL_ID,
            name: "Deliveries",
            description: "New scheduled deliveries assigned to you",
            // 4 = IMPORTANCE_HIGH: heads-up while the rider is driving. A new
            // job is time-critical; the default (3) shows no banner.
            importance: 4,
            // 1 = VISIBILITY_PUBLIC: readable on the lock screen, which is
            // where a rider will actually see it.
            visibility: 1,
            vibration: true,
          });
        } catch (err) {
          // createChannel is Android-only and non-fatal — a missing channel
          // costs us the notification, not the app.
          // eslint-disable-next-line no-console
          console.warn("[push] createChannel failed", err);
        }

        // Listeners BEFORE register(). register() resolves void and the token
        // arrives asynchronously on the 'registration' event — attaching after
        // would race, and losing that event means no token until next launch.
        listenersRef.current.push(
          await PushNotifications.addListener("registration", (t: Token) => {
            // This ONE listener covers both cases. Android's onNewToken()
            // routes into the same 'registration' event (verified in the
            // plugin's PushNotificationsPlugin.java), so a rotated token
            // re-enters here and re-POSTs itself. There is no separate refresh
            // event to subscribe to, and without this the backend would keep
            // sending to a token FCM has already retired.
            void syncToken(t.value);
          }),
        );

        listenersRef.current.push(
          await PushNotifications.addListener("registrationError", (err) => {
            // Typically a device with no Google Play services. Nothing to do —
            // this rider simply never gets pushes.
            // eslint-disable-next-line no-console
            console.warn("[push] registration failed", err);
          }),
        );

        listenersRef.current.push(
          await PushNotifications.addListener(
            "pushNotificationReceived",
            (n: PushNotificationSchema) => {
              // Foreground arrivals are NOT drawn in the system tray by
              // default — FCM hands them straight to this callback instead. So
              // a rider with the app open would otherwise see nothing at all.
              // Reuse the field group's existing toast surface.
              toast.info(
                [n.title, n.body].filter(Boolean).join(" — ") ||
                  "New scheduled delivery",
              );
            },
          ),
        );

        listenersRef.current.push(
          await PushNotifications.addListener(
            "pushNotificationActionPerformed",
            () => {
              // Tapping already brings the app to the front via the launcher
              // intent — that is the whole of the required behaviour today.
              // Deep-linking to the run is deliberately NOT built here; the
              // backend already ships deliveryId/deliveryNumber in the message
              // data for whoever picks that up next.
            },
          ),
        );

        // Android 13+ needs the POST_NOTIFICATIONS runtime grant. Below 13 the
        // plugin reports 'granted' without prompting.
        let status = await PushNotifications.checkPermissions();
        if (
          status.receive === "prompt" ||
          status.receive === "prompt-with-rationale"
        ) {
          status = await PushNotifications.requestPermissions();
        }
        if (cancelled) return;

        if (status.receive !== "granted") {
          // Declined. Stop here — do NOT call register(). Everything else in
          // the app is untouched.
          setPermission("denied");
          // eslint-disable-next-line no-console
          console.warn(
            "[push] notification permission not granted — this device will not receive delivery pushes",
          );
          return;
        }

        setPermission("granted");
        await PushNotifications.register();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[push] init failed — continuing without push", err);
      }
    })();

    return () => {
      cancelled = true;
      // Detach on unmount so a remount cannot double-register listeners.
      const handles = listenersRef.current;
      listenersRef.current = [];
      handles.forEach((h) => {
        try {
          void h.remove();
        } catch {
          /* already gone */
        }
      });
      initedRef.current = false;
    };
  }, [isAvailable, isLoaded, isSignedIn, syncToken]);

  // Retry a token whose POST never landed (registered inside a lift, backend
  // restarting). Without this the device holds a token the backend has never
  // seen and stays silent until the next cold start.
  useEffect(() => {
    if (!isAvailable || !isSignedIn) return;
    const retry = () => {
      const stored = readStored(TOKEN_KEY);
      if (stored && readStored(SYNCED_KEY) !== stored) void syncToken(stored);
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [isAvailable, isSignedIn, syncToken]);

  return (
    <PushNotificationsContext.Provider
      value={{ isAvailable, permission, token }}
    >
      {children}
    </PushNotificationsContext.Provider>
  );
}

/**
 * Push state, for anything that wants to show whether this device is
 * registered. Must be called from under <PushNotificationsProvider>, i.e.
 * anywhere in the (field) route group.
 */
export function usePushNotificationsContext(): PushNotificationsContextValue {
  const ctx = useContext(PushNotificationsContext);
  if (!ctx) {
    throw new Error(
      "usePushNotificationsContext must be used inside a PushNotificationsProvider " +
        "(i.e. somewhere under app/(field)/layout.tsx).",
    );
  }
  return ctx;
}
