const nextConfig = {
  reactStrictMode: false,
  images: {
    domains: ["dr06g550bflef.cloudfront.net"],
  },
  env: {
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  },
  swcMinify: false,
};

export default nextConfig;
