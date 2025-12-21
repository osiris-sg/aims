const nextConfig = {
  reactStrictMode: false,
  images: {
    domains: ["dr06g550bflef.cloudfront.net", "aims-osiris.s3.ap-southeast-1.amazonaws.com"],
  },
  env: {
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  },
  swcMinify: false,
  async redirects() {
    return [
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
    ];
  },
};

export default nextConfig;
