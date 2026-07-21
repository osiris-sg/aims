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
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import ws = require("ws");

dotenv.config(); // no-op if the caller (or dotenv-cli) already loaded env

/**
 * PrismaClient over Neon's WebSocket driver (port 443) instead of raw TCP
 * 5432 — same pattern as src/common/prisma.service.ts. Long-running scripts
 * die with "Server has closed the connection" / pool timeouts on flaky
 * networks over 5432; the WS tunnel doesn't.
 */
const TRANSIENT_RE = /closed the connection|connection pool|Connection terminated|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket hang up|fetch failed/i;

export function createScriptPrisma(): PrismaClient {
  neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
  const url = new URL(process.env.DATABASE_URL as string);
  url.searchParams.delete("pool_timeout");
  url.searchParams.delete("connect_timeout");
  // The Neon WS pool emits async 'error' events (e.g. wifi drop ⇒ "Connection
  // terminated unexpectedly") that surface as uncaught exceptions and kill the
  // process even though the in-flight query ALSO rejects and would be retried
  // by withDbRetry. Swallow only that class of error; rethrow anything else.
  process.on("uncaughtException", (e: any) => {
    if (TRANSIENT_RE.test(e?.message || "")) {
      console.warn(`  ⚠ swallowed transient connection error: ${(e?.message || "").slice(0, 120)}`);
      return;
    }
    throw e;
  });
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
}

/** Retry transient DB failures (connection closed, pool timeout, network drop)
 *  with long backoff — unattended runs must survive multi-minute wifi outages. */
export async function withDbRetry<T>(fn: () => Promise<T>, label = "db op"): Promise<T> {
  const delays = [2000, 5000, 15000, 60000, 120000, 300000];
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const transient = TRANSIENT_RE.test(e?.message || "");
      if (!transient || i >= delays.length) throw e;
      console.warn(`  ↻ ${label}: transient DB error, retrying in ${delays[i] / 1000}s (${i + 1}/${delays.length})`);
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

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
  accessTokenExpiresAt: Date;
  /** Refresh the access token in place (used by xeroGet on expiry/401). */
  refresh: () => Promise<void>;
};

async function refreshInPlace(prisma: PrismaClient, organizationId: string, tokens: { accessToken: string; refreshToken: string; accessTokenExpiresAt: Date }) {
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
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }),
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
  tokens.accessToken = updated.accessToken;
  tokens.refreshToken = updated.refreshToken;
  tokens.accessTokenExpiresAt = updated.accessTokenExpiresAt;
}

export async function getXeroTokens(prisma: PrismaClient, organizationId: string): Promise<XeroTokens> {
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId } });
  if (!conn) throw new Error(`No XeroConnection for org ${organizationId}. Connect at /xero/connect first.`);

  if (conn.refreshTokenExpiresAt <= new Date()) {
    throw new Error(`Xero refresh token expired ${conn.refreshTokenExpiresAt.toISOString()}. Re-authorize at /xero/connect.`);
  }

  const tokens: XeroTokens = {
    tenantId: conn.tenantId,
    accessToken: conn.accessToken,
    refreshToken: conn.refreshToken,
    accessTokenExpiresAt: conn.accessTokenExpiresAt,
    refresh: () => refreshInPlace(prisma, organizationId, tokens),
  };

  // Refresh access token up front if it has <5 min left. Long runs refresh
  // again mid-flight via xeroGet (access tokens only live 30 min).
  if (tokens.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    await tokens.refresh();
  }

  return tokens;
}

/** Parse a --modified-since=<ISO> CLI flag (shared by the import scripts). */
export function modifiedSinceArg(): Date | null {
  const hit = process.argv.find((a) => a.startsWith('--modified-since='));
  if (!hit) return null;
  const d = new Date(hit.split('=').slice(1).join('='));
  if (isNaN(d.getTime())) throw new Error(`Bad --modified-since value: ${hit}`);
  return d;
}

export async function xeroGet<T = any>(
  tokens: XeroTokens,
  path: string,
  query: Record<string, string | number> = {},
  opts: { modifiedAfter?: Date | null } = {},
): Promise<T> {
  // Throttle.
  const delta = Date.now() - lastRequestAt;
  if (delta < REQUEST_INTERVAL_MS) await new Promise((r) => setTimeout(r, REQUEST_INTERVAL_MS - delta));
  lastRequestAt = Date.now();

  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${XERO_API}${path}${qs ? `?${qs}` : ""}`;

  // Proactive mid-run refresh — access tokens only live 30 min, and long
  // stages (2k+ paced requests) outlive them. <2 min left → refresh now.
  if (tokens.refresh && tokens.accessTokenExpiresAt.getTime() - Date.now() < 2 * 60 * 1000) {
    await tokens.refresh();
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokens.accessToken}`,
      "Xero-Tenant-Id": tokens.tenantId,
      Accept: "application/json",
    };
    // Incremental pulls: Xero returns only records modified after this time.
    if (opts.modifiedAfter) headers["If-Modified-Since"] = opts.modifiedAfter.toUTCString();
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch (e: any) {
      // Network-level failure (wifi blip, DNS) — back off and retry.
      if (attempt >= 5) throw e;
      const wait = attempt * 15;
      console.warn(`  ⏸ network error (${(e?.message || '').slice(0, 60)}), retrying in ${wait}s...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }

    if (res.status === 401 && tokens.refresh && attempt < 5) {
      // Token expired mid-run (or clock skew beat the proactive check).
      await tokens.refresh();
      continue;
    }

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
