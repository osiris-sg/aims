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
  XERO: {
    CLIENT_ID: process.env.XERO_CLIENT_ID,
    CLIENT_SECRET: process.env.XERO_CLIENT_SECRET,
    REDIRECT_URI: process.env.XERO_REDIRECT_URI,
    SCOPES: process.env.XERO_SCOPES || 'accounting.transactions accounting.contacts accounting.settings offline_access',
  },
  WATER_SG: {
    API_URL: process.env.WATER_SG_API_URL,
    API_KEY: process.env.WATER_SG_API_KEY,
  },
});
