import { Injectable, Logger } from '@nestjs/common';
import { WaterSgService } from './water-sg.service';

export interface CachedSite {
  siteId: string;
  siteName: string;
}

/**
 * In-memory cache of the AIMS-unit → water-sg-site map (canonical SID → site).
 * Mirrors ClerkAuthGuard's TTL-cache pattern: one shared map refreshed at most
 * once per TTL, so the inventory list/detail joins are served locally with ZERO
 * per-row network calls.
 *
 * Fails soft: if water-sg is unreachable the last-known map (or empty) is served
 * and a short retry window is set, so an outage NEVER breaks the inventory page
 * and never hammers a down water-sg.
 */
@Injectable()
export class WaterSgLinkService {
  private readonly logger = new Logger(WaterSgLinkService.name);
  private static readonly TTL_MS = 5 * 60 * 1000; // 5 min fresh window
  private static readonly RETRY_MS = 30 * 1000; // back-off after a failure

  private cache: Map<string, CachedSite> | null = null;
  private expiresAt = 0;

  constructor(private readonly waterSg: WaterSgService) {}

  /** canonical SID (e.g. "045") → { siteId, siteName }. Never throws. */
  async getMap(): Promise<Map<string, CachedSite>> {
    const now = Date.now();
    if (this.cache && now < this.expiresAt) return this.cache;

    try {
      const links = await this.waterSg.getLinkedSites();
      const map = new Map<string, CachedSite>();
      for (const l of links) {
        map.set(l.canonical, { siteId: l.siteId, siteName: l.siteName });
      }
      this.cache = map;
      this.expiresAt = now + WaterSgLinkService.TTL_MS;
      return map;
    } catch (e: any) {
      // Fail soft — serve last-known (or empty) and retry soon.
      this.logger.warn(
        `getLinkedSites failed; serving ${this.cache ? 'stale' : 'empty'} map: ${e?.message ?? e}`,
      );
      if (!this.cache) this.cache = new Map();
      this.expiresAt = now + WaterSgLinkService.RETRY_MS;
      return this.cache;
    }
  }

  /** Plain object keyed by canonical SID — the shape the portal consumes. */
  async getLinksObject(): Promise<Record<string, CachedSite>> {
    return Object.fromEntries(await this.getMap());
  }
}
