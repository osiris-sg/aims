const nextConfig = {
  reactStrictMode: false,
  images: {
    domains: ["dr06g550bflef.cloudfront.net", "aims-osiris.s3.ap-southeast-1.amazonaws.com"],
  },
  // No `env` passthrough: CLERK_SECRET_KEY used to be copied here, which bakes
  // the secret into the build. clerkMiddleware reads it from process.env at
  // runtime (Vercel injects it), so nothing needs it inlined.
  swcMinify: false,
  // ai-ms.io / www.ai-ms.io are attached to THIS project (the marketing site
  // lives on aims-landing). Until the domains move, the two legal pages are
  // proxied from aims-landing on those hosts only; app.ai-ms.io is unaffected.
  async rewrites() {
    const LANDING = "https://aims-landing.vercel.app";
    const onMarketingHost = [{ type: "host", value: "(www\\.)?ai-ms\\.io" }];
    return {
      // The pages themselves (also their ?_rsc= requests).
      beforeFiles: [
        { source: "/privacy-policy", has: onMarketingHost, destination: `${LANDING}/privacy-policy` },
        { source: "/terms", has: onMarketingHost, destination: `${LANDING}/terms` },
        // The landing header/footer logo goes through the image optimizer.
        {
          source: "/_next/image",
          has: [...onMarketingHost, { type: "query", key: "url", value: "/aims-logo.png" }],
          destination: `${LANDING}/_next/image`,
        },
      ],
      afterFiles: [],
      // The landing build's own JS/CSS/fonts and icon: only used when this
      // project has no such file, so the portal's assets are never shadowed.
      fallback: [
        { source: "/_next/static/:path*", has: onMarketingHost, destination: `${LANDING}/_next/static/:path*` },
        { source: "/icon.png", has: onMarketingHost, destination: `${LANDING}/icon.png` },
      ],
    };
  },
  async redirects() {
    return [
      // Round Z (2026-10-22): the Sales dashboard is the portal home; the old URLs keep working (query kept:
      // /portal/shipments/dashboard?view=emails → /portal?view=emails).
      {
        source: "/portal/shipments/dashboard",
        destination: "/portal",
        permanent: true,
      },
      {
        source: "/portal/shipments/inbox",
        destination: "/portal?view=emails",
        permanent: true,
      },
      {
        source: "/portal/invoices",
        destination: "/portal/sales/invoices",
        permanent: true,
      },
      {
        source: "/portal/documents",
        destination: "/portal/sales/quotations",
        permanent: false,
      },
      {
        source: "/portal/assets",
        destination: "/portal/inventory/products",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
