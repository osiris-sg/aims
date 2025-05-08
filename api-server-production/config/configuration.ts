export default () => ({
  port: parseInt(process.env.PORT, 10) || 40400,
  DATABASE: {
    HOST: process.env.DATABASE_HOST,
  },
  AWS: {
    REGION: process.env.AWS_REGION,
    RESOURCE_BUCKET: process.env.RESOURCE_BUCKET,
    ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  },
  DASHBOARD_URL: process.env.DASHBOARD_URL,
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
});
