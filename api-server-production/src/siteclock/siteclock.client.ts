/**
 * Thin client for SiteClock's /v1 API (repo siteclock, backend/src/modules/v1).
 * One instance per call, built from the org's SiteClockConnection. Every call
 * has a timeout and turns a non-2xx answer into SiteClockApiError carrying
 * SiteClock's { error, code } so the sync can tell "fix the data" (4xx) from
 * "try again later" (network / 5xx).
 */
export class SiteClockApiError extends Error {
  constructor(
    message: string,
    readonly status: number, // 0 = network / timeout
    readonly code: string | null,
    readonly body: any = null,
  ) {
    super(message);
  }
  /** Worth retrying unchanged: network trouble, rate limit, server error. */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface SiteClockWorker {
  id: string;
  name: string;
  employeeNo: string | null;
  role: string;
  active: boolean;
  teamIds: string[];
}
export interface SiteClockTeam {
  id: string;
  name: string;
  members: { id: string; name: string; employeeNo: string | null }[];
}
export interface SiteClockJob {
  id: string;
  externalRef: string;
  status: string;
  worker: { id: string; name: string } | null;
  startAt: string | null;
  endAt: string | null;
  [k: string]: any;
}

export interface SiteClockClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class SiteClockClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SiteClockClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e: any) {
      const why = e?.name === 'TimeoutError' ? `timed out after ${this.timeoutMs / 1000}s` : e?.message || 'network error';
      throw new SiteClockApiError(`SiteClock unreachable: ${why}`, 0, null);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error || `HTTP ${res.status}`;
      throw new SiteClockApiError(`SiteClock ${method} ${path.split('?')[0]}: ${msg}`, res.status, json?.code ?? null, json);
    }
    return json as T;
  }

  /** Refs carry a colon ("aims-delivery:<id>") — always encode them in a path. */
  private ref(r: string) {
    return encodeURIComponent(r);
  }

  teams() {
    return this.call<{ date: string; teams: SiteClockTeam[] }>('GET', '/v1/teams');
  }
  workers() {
    return this.call<{ workers: SiteClockWorker[] }>('GET', '/v1/workers');
  }
  putSite(ref: string, body: { name: string; address: string }) {
    return this.call<{ site: { id: string; externalRef: string } }>('PUT', `/v1/sites/by-ref/${this.ref(ref)}`, body);
  }
  createJob(body: { externalRef: string; workerId: string; siteRef: string; startAt: string; endAt: string; title: string; notes: string | null }) {
    return this.call<{ job: SiteClockJob; duplicate?: boolean }>('POST', '/v1/jobs', body);
  }
  patchJob(ref: string, body: Record<string, unknown>) {
    return this.call<{ job: SiteClockJob; unchanged?: boolean }>('PATCH', `/v1/jobs/by-ref/${this.ref(ref)}`, body);
  }
  cancelJob(ref: string, reason?: string) {
    return this.call<{ job: SiteClockJob }>('POST', `/v1/jobs/by-ref/${this.ref(ref)}/cancel`, reason ? { reason } : {});
  }
  getJob(ref: string) {
    return this.call<{ job: SiteClockJob }>('GET', `/v1/jobs/by-ref/${this.ref(ref)}`);
  }
}
