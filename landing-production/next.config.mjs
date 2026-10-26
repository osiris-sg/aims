/**
 * Marketing site for ai-ms.io. The authenticated portal lives on
 * app.ai-ms.io — any legacy deep link that used to resolve on www.ai-ms.io
 * (bookmarked /portal pages, emailed /pay and /guest links, printed /scan QR
 * codes) is forwarded there so nothing that was sent out breaks.
 */
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.ai-ms.io").replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Multi-zone: www.ai-ms.io is served by the portal project, which proxies
  // /privacy-policy and /terms from here. A distinct asset prefix lets it
  // route this build's JS/CSS/fonts to us without touching its own /_next.
  assetPrefix: "/landing-static",
  async rewrites() {
    return {
      beforeFiles: [{ source: "/landing-static/_next/:path+", destination: "/_next/:path+" }],
    };
  },
  async redirects() {
    // The privacy policy moved from /privacy to /privacy-policy (2026-10-27).
    // Keep the old address working: SiteJobs builds and the Play listing link it.
    const legal = [{ source: "/privacy", destination: "/privacy-policy", permanent: true }];
    return [...legal, ...["portal", "sign-in", "pay", "guest", "scan", "field", "submit"].flatMap((p) => [
      { source: `/${p}`, destination: `${APP_URL}/${p}`, permanent: true },
      { source: `/${p}/:path*`, destination: `${APP_URL}/${p}/:path*`, permanent: true },
    ])];
  },
};

export default nextConfig;
