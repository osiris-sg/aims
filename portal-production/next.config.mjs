const nextConfig = {
  reactStrictMode: false,
  images: {
    domains: ["dr06g550bflef.cloudfront.net", "aims-osiris.s3.ap-southeast-1.amazonaws.com"],
  },
  // No `env` passthrough: CLERK_SECRET_KEY used to be copied here, which bakes
  // the secret into the build. clerkMiddleware reads it from process.env at
  // runtime (Vercel injects it), so nothing needs it inlined.
  swcMinify: false,
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
