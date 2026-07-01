import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Outbound payload for creating a site in water-sg. managerId is always null
// from this path — the field acknowledgment has no manager context; water-sg
// assigns one later.
export interface WaterSgSitePayload {
  siteId: string;
  name: string;
  lat: number;
  lng: number;
  cameraP2P: string | null;
  managerId: null;
}

// ESS site payload (/api/ess-site). Distinct field names from SIDS: `siteName`
// (not `name`), a `batteryCount` (3 or 4, default 3 from the field path), and an
// optional `customer` name when the delivered unit's project has one.
export interface WaterSgEssSitePayload {
  siteId: string;
  siteName: string;
  lat: number;
  lng: number;
  batteryCount: number;
  customer?: string;
}

// ECM site payload (/api/ecm-site). Same `name` field as SIDS but a nullable
// `managerId` (always null from the field ack — water-sg assigns one later).
export interface WaterSgEcmSitePayload {
  siteId: string;
  name: string;
  lat: number;
  lng: number;
  managerId: string | null;
}

export interface WaterSgCreateSiteResult {
  ok: boolean;
  id?: string;
  alreadyExists?: boolean;
}

/**
 * Thin client for the water-sg site API. Mirrors S3Service's shape: ConfigService
 * injected, endpoints + key read once in the constructor from flat env keys.
 * One shared Bearer key (WATER_SG_API_KEY); one URL per product line
 * (WATER_SG_API_URL for SIDS, WATER_SG_ESS_API_URL, WATER_SG_ECM_API_URL). Uses
 * the Node global fetch — no axios.
 *
 * Each createXSite() throws on a missing config or any non-2xx response so the
 * caller can treat the whole forward as best-effort and swallow failures.
 */
@Injectable()
export class WaterSgService {
  private readonly logger = new Logger(WaterSgService.name);
  private readonly apiUrl: string;
  private readonly essApiUrl: string;
  private readonly ecmApiUrl: string;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get('WATER_SG_API_URL');
    this.essApiUrl = this.configService.get('WATER_SG_ESS_API_URL');
    this.ecmApiUrl = this.configService.get('WATER_SG_ECM_API_URL');
    this.apiKey = this.configService.get('WATER_SG_API_KEY');
  }

  /**
   * POST a site to water-sg. Returns the parsed result on 2xx; throws on a
   * missing URL or any non-2xx status (the caller wraps this in try/catch).
   */
  async createSite(payload: WaterSgSitePayload): Promise<WaterSgCreateSiteResult> {
    if (!this.apiUrl) {
      throw new Error('WATER_SG_API_URL is not configured');
    }

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Pull the body for diagnostics but never let a parse failure mask the
      // real HTTP error.
      const body = await res.text().catch(() => '');
      throw new Error(
        `water-sg createSite failed: HTTP ${res.status} ${res.statusText} ${body}`.trim(),
      );
    }

    // Tolerate a few likely response shapes for the new site id and an
    // idempotency signal, so a minor contract change doesn't break the footprint.
    const data = (await res.json().catch(() => ({}))) as any;
    const id = data?.id ?? data?.site?.id ?? data?.siteId;
    const alreadyExists = data?.alreadyExists ?? data?.exists ?? false;

    return { ok: true, id, alreadyExists };
  }

  /**
   * POST an ESS site to water-sg (/api/ess-site). Same auth + error/response
   * handling as createSite; distinct payload shape (see WaterSgEssSitePayload).
   */
  async createEssSite(payload: WaterSgEssSitePayload): Promise<WaterSgCreateSiteResult> {
    return this.postSite(this.essApiUrl, 'WATER_SG_ESS_API_URL', payload);
  }

  /**
   * POST an ECM site to water-sg (/api/ecm-site). Same auth + error/response
   * handling as createSite; distinct payload shape (see WaterSgEcmSitePayload).
   */
  async createEcmSite(payload: WaterSgEcmSitePayload): Promise<WaterSgCreateSiteResult> {
    return this.postSite(this.ecmApiUrl, 'WATER_SG_ECM_API_URL', payload);
  }

  /**
   * Shared POST for the ESS/ECM endpoints — mirrors createSite()'s fetch, Bearer
   * auth, non-2xx-throws, and tolerant response parsing. createSite() (SIDS) is
   * intentionally left inline so its behavior is untouched by this extraction.
   */
  private async postSite(
    url: string | undefined,
    urlEnvName: string,
    payload: WaterSgEssSitePayload | WaterSgEcmSitePayload,
  ): Promise<WaterSgCreateSiteResult> {
    if (!url) {
      throw new Error(`${urlEnvName} is not configured`);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `water-sg ${urlEnvName} createSite failed: HTTP ${res.status} ${res.statusText} ${body}`.trim(),
      );
    }

    const data = (await res.json().catch(() => ({}))) as any;
    const id = data?.id ?? data?.site?.id ?? data?.siteId;
    const alreadyExists = data?.alreadyExists ?? data?.exists ?? false;

    return { ok: true, id, alreadyExists };
  }
}
