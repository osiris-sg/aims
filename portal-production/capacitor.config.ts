import type { CapacitorConfig } from "@capacitor/cli";

/**
 * AIMS Field — Capacitor wrapper.
 *
 * The native shell does NOT bundle the Next.js build output. It loads the
 * deployed (or local dev) portal via `server.url` and adds native plugins
 * (NFC, future background location) on top. `webDir` is required by the
 * Capacitor schema but the contents of `out/` are unused while server.url
 * is set.
 *
 * Switch targets at build time:
 *   CAP_SERVER_URL=http://192.168.4.23:3000 npx cap sync   (local LAN dev)
 *   CAP_SERVER_URL=https://aims-staging.osiris.so npx cap sync
 *   CAP_SERVER_URL=https://aims.osiris.so npx cap sync     (production)
 *
 * Default is the LAN dev URL so freshly-cloned developers can `cap sync` +
 * run the app against a phone on the same Wi-Fi without configuration.
 *
 * cleartext + allowMixedContent are dev affordances for HTTP server.url.
 * Production builds against an HTTPS URL don't actually exercise either.
 */
const SERVER_URL = process.env.CAP_SERVER_URL ?? "http://192.168.4.23:3000";

const config: CapacitorConfig = {
  appId: "so.osiris.aims.field",
  appName: "AIMS Field",
  webDir: "out",
  server: {
    url: SERVER_URL,
    cleartext: true,
    // Hosts the WebView is allowed to navigate to internally. Without this,
    // a redirect from the server URL (e.g. Clerk's auth flow, or a
    // redirect chain after server.url) could be classified as "external"
    // and routed to the system browser via Intent.ACTION_VIEW. The wildcard
    // entries cover all staging/prod subdomains plus the LAN dev IP.
    allowNavigation: [
      "192.168.4.23",
      "192.168.*.*",
      "*.osiris.so",
      "*.ai-ms.io",
      "*.clerk.accounts.dev",
      "*.clerk.com",
      "accounts.google.com",
    ],
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
