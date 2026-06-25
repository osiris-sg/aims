/**
 * Shared helpers for the Xero → AIMS migration scripts.
 *
 * All migration scripts go through these helpers so token refresh,
 * pagination, and rate-limit handling are consistent.
 *
 * Connection state lives in the XeroConnection table — populated by the
 * portal OAuth flow at /xero/connect. To re-authorize when the refresh
 * token expires (60 days), hit /xero/connect?organizationId=<orgId>.
 */

import { PrismaClient } from "@prisma/client";

export const XERO_API = "https://api.xero.com/api.xro/2.0";
export const XERO_FILES_API = "https://api.xero.com/files.xro/1.0";

export const BIOFUEL_ORG_ID = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";

// Xero rate limit: 60 req/min per tenant. We pace at one request per 1100ms
// (~54 req/min) to leave headroom for occasional retries.
export const REQUEST_INTERVAL_MS = 1100;

let lastRequestAt = 0;

export type XeroTokens = {
  tenantId: string;
  accessToken: string;
  refreshToken: string;
};

export async function getXeroTokens(prisma: PrismaClient, organizationId: string): Promise<XeroTokens> {
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId } });
  if (!conn) throw new Error(`No XeroConnection for org ${organizationId}. Connect at /xero/connect first.`);

  if (conn.refreshTokenExpiresAt <= new Date()) {
    throw new Error(`Xero refresh token expired ${conn.refreshTokenExpiresAt.toISOString()}. Re-authorize at /xero/connect.`);
  }

  // Refresh access token if it has <5 min left.
  if (conn.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    console.log("  ↻ refreshing Xero access token...");
    const clientId = process.env.XERO_CLIENT_ID!;
    const clientSecret = process.env.XERO_CLIENT_SECRET!;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refreshToken }),
    });
    if (!res.ok) throw new Error(`Refresh failed (${res.status}): ${await res.text()}`);
    const t = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    const updated = await prisma.xeroConnection.update({
      where: { organizationId },
      data: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    return { tenantId: updated.tenantId, accessToken: updated.accessToken, refreshToken: updated.refreshToken };
  }

  return { tenantId: conn.tenantId, accessToken: conn.accessToken, refreshToken: conn.refreshToken };
}

export async function xeroGet<T = any>(
  tokens: XeroTokens,
  path: string,
  query: Record<string, string | number> = {},
): Promise<T> {
  // Throttle.
  const delta = Date.now() - lastRequestAt;
  if (delta < REQUEST_INTERVAL_MS) await new Promise((r) => setTimeout(r, REQUEST_INTERVAL_MS - delta));
  lastRequestAt = Date.now();

  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${XERO_API}${path}${qs ? `?${qs}` : ""}`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Xero-Tenant-Id": tokens.tenantId,
        Accept: "application/json",
      },
    });

    if (res.status === 429) {
      // Rate-limited — Xero says retry-after in seconds.
      const wait = parseInt(res.headers.get("Retry-After") || "60", 10);
      console.warn(`  ⏸ 429 rate limit, waiting ${wait}s...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Xero GET ${path} ${res.status}: ${body.slice(0, 300)}`);
    }

    return (await res.json()) as T;
  }
  throw new Error(`Xero GET ${path}: gave up after 5 attempts (rate limited)`);
}
