import { getXeroTokens, xeroGet, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
(async () => {
  const tokens = await getXeroTokens(null as any, ORG);
  try { await xeroGet(tokens, "/Organisation", {} as any); console.log("quota OK"); process.exit(0); }
  catch (e: any) { console.log("still capped"); process.exit(1); }
})().catch(() => process.exit(1));
