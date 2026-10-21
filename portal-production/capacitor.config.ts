import type { CapacitorConfig } from "@capacitor/cli";

/**
 * SiteJobs: Capacitor wrapper.
 *
 * The native shell does NOT bundle the Next.js build output. It loads the
 * deployed (or local dev) portal via `server.url` and adds native plugins
 * (NFC, future background location) on top. `webDir` is required by the
 * Capacitor schema but the contents of `out/` are unused while server.url
 * is set.
 *
 * Switch targets at build time:
 *   CAP_SERVER_URL=http://192.168.4.23:3000 npx cap sync       (local LAN dev)
 *   CAP_SERVER_URL=https://aims-staging.osiris.so npx cap sync
 *   CAP_SERVER_URL=https://app.ai-ms.io npx cap sync           (production)
 *
 * IMPORTANT: production must use the final, no-redirect host
 * (https://app.ai-ms.io — the portal). NOT the apex or www (https://ai-ms.io)
 * — those now serve the marketing site and 301 /field, /portal etc. over to
 * app.ai-ms.io, and a redirected navigation loads the new origin BEFORE
 * Capacitor's native bridge JS is injected — leaving the WebView without
 * `window.Capacitor`. NFC and background-geolocation calls then fail
 * silently.
 *
 * Default is the LAN dev URL so freshly-cloned developers can `cap sync` +
 * run the app against a phone on the same Wi-Fi without configuration.
 *
 * cleartext + allowMixedContent are dev affordances for an HTTP server.url
 * and are switched OFF (together with the LAN and dev-Clerk hosts) whenever
 * the URL is https, i.e. for every Play / staging sync.
 */
const SERVER_URL = process.env.CAP_SERVER_URL ?? "http://192.168.4.23:3000";
// Plain-http server.url = a LAN dev build. Only then are cleartext, mixed
// content and the LAN / dev-Clerk / staging hosts allowed. A Play (https)
// sync gets none of them.
const IS_DEV_SERVER = SERVER_URL.startsWith("http://");

// Hosts the WebView is allowed to navigate to internally. Without this, a
// redirect from the server URL (Clerk's auth flow, Google sign-in) would be
// classified as "external" and routed to the system browser via
// Intent.ACTION_VIEW. clerk.ai-ms.io is the future production Clerk domain
// (docs/clerk-cutover.md); *.clerk.accounts.dev is the DEV instance and is
// dev-only here, so Google sign-in inside the Play build needs the cutover.
const ALLOW_NAVIGATION = [
  "ai-ms.io",
  "*.ai-ms.io",
  "clerk.ai-ms.io",
  "*.clerk.com",
  "accounts.google.com",
  ...(IS_DEV_SERVER ? ["192.168.4.23", "192.168.*.*", "*.osiris.so", "*.clerk.accounts.dev"] : []),
];

const config: CapacitorConfig = {
  appId: "so.osiris.aims.field",
  appName: "SiteJobs",
  webDir: "out",
  server: {
    url: SERVER_URL,
    cleartext: IS_DEV_SERVER,
    allowNavigation: ALLOW_NAVIGATION,
  },
  android: {
    allowMixedContent: IS_DEV_SERVER,
  },
};

export default config;
