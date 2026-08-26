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
  async redirects() {
    return ["portal", "sign-in", "pay", "guest", "scan", "field", "submit"].flatMap((p) => [
      { source: `/${p}`, destination: `${APP_URL}/${p}`, permanent: true },
      { source: `/${p}/:path*`, destination: `${APP_URL}/${p}/:path*`, permanent: true },
    ]);
  },
};

export default nextConfig;
