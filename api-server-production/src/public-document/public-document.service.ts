import {
  Injectable,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService } from '../documents/documents.service';

// Only delivery orders (outbound + return) get a view-only link.
const DO_TYPES = ['DO', 'DELIVERY_ORDER', 'RDO', 'RETURN_DELIVERY_ORDER'];

// ── IN-MEMORY rate limiter ──────────────────────────────────────────────────
// Same per-process limiter as the guest delivery surface. ⚠️ Lives in THIS Node
// process ONLY; if the backend is EVER scaled beyond one instance the effective
// limit weakens per-instance with no error. Move to a shared store before then.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 60; // requests per (token + ip) per minute
const rlBuckets = new Map<string, { count: number; resetAt: number }>();
function enforceRateLimit(key: string) {
  const now = Date.now();
  const bucket = rlBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rlBuckets.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return;
  }
  if (bucket.count >= RL_MAX) {
    throw new HttpException('Too many requests. Please slow down and try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
  }
  bucket.count += 1;
  if (rlBuckets.size > 5000) {
    for (const [k, v] of rlBuckets) if (v.resetAt <= now) rlBuckets.delete(k);
  }
}

type TokenState = 'ok' | 'revoked' | 'notfound';

/**
 * View-only document link surface. A token grants a NO-LOGIN, READ-ONLY render
 * of EXACTLY ONE document (a DO/RDO) and nothing else. Distinct from the
 * run-scoped DeliveryShareLink (which drives signing/finalizing): this token has
 * ZERO mutation surface — the only public route is a GET.
 *
 * The office mint/revoke routes are authenticated + permissioned; the public GET
 * is @Public(), rate-limited per (token + IP), resolves scope SOLELY from the
 * token, and never filters on run status or direction — a completed DO, an RDO,
 * or a DO with no run at all all render. Links never expire; revocation is the
 * only control.
 */
@Injectable()
export class PublicDocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  /** Controller calls this per public request with the token + client IP. */
  publicRateGate(token: string, ip: string) {
    enforceRateLimit(`${token || 'notoken'}::${ip || 'noip'}`);
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * The document's `config` is a stored JSON blob that, for authenticated office
   * use, carries fields the public DO render never needs and MUST NOT leak to a
   * link holder: internal ids, a staff email (`lastUsedBy`), audit timestamps,
   * prices/totals/margins, contact emails, and free-text ops notes (`remarks` /
   * top-level `referenceNo`). Strip them here. Items get a POSITIVE whitelist so
   * no price/cost field can ever ride along on a line. Proof-photo grouping has
   * already run in getById, so the internal item ids are safe to drop now.
   */
  /**
   * Server-side mirror of the preview's `groupDeliveryLines`: collapse each
   * consecutive same-`deliveryGroup` run of qty-1 delivery lines into ONE line
   * whose `description` carries the "Rental/Sale of N units of {name} / Model:
   * {skuKey} / S/No.: {serial}" block. Run BEFORE sanitising so the grouping key
   * (deliveryGroup = the real Asset id) is consumed here and never shipped; the
   * preview then passes these pre-grouped, key-less lines through unchanged.
   * Non-delivery lines (no deliveryGroup) pass through untouched.
   */
  private groupDeliveryLinesForPublic(raw: any[], isReturn: boolean): any[] {
    if (!Array.isArray(raw) || raw.length === 0) return raw;
    const out: any[] = [];
    let i = 0;
    while (i < raw.length) {
      const line = raw[i];
      const key = line?.deliveryGroup;
      if (!key) {
        out.push(line);
        i++;
        continue;
      }
      const run = [line];
      let j = i + 1;
      while (j < raw.length && raw[j]?.deliveryGroup === key) {
        run.push(raw[j]);
        j++;
      }
      const serials = run.flatMap((r) => (Array.isArray(r.serialNumbers) ? r.serialNumbers : [])).filter(Boolean);
      const qty = run.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
      const name = run[0].description || '';
      const model = run[0].skuKey || '';
      const verb = isReturn ? 'Return' : run.some((r) => r.deploymentType === 'SALE') ? 'Sale' : 'Rental';
      const years = run.map((r) => r.year).filter((y) => y != null);
      const year = years.length === run.length && new Set(years).size === 1 ? years[0] : null;
      const lines = [`${verb} of ${qty} unit${qty === 1 ? '' : 's'} of ${name}`];
      if (model) lines.push(`Model: ${model}`);
      if (year != null) lines.push(`Year: ${year}`);
      for (const s of serials) lines.push(`S/No.: ${s}`);
      out.push({ ...run[0], quantity: qty, serialNumbers: serials, description: lines.join('\n') });
      i = j;
    }
    return out;
  }

  private sanitizeConfigForPublic(config: any): any {
    const cfg = { ...(config ?? {}) };
    const DROP_TOP = [
      'customerId', 'customerEmail', 'lastUsedBy', 'lastUsedAt', 'confirmedAt',
      'remarks', 'referenceNo', 'salesMobile', 'toDONo', 'fromDONo',
      'sourceDocumentId', 'sourceDocumentType', 'sourceDocumentNumber',
      'stockDeducted', 'rate', 'absorbTax', 'taxApplicable',
      'subTotal', 'grossTotal', 'nettTotal', 'gstAmount', 'gstPercent',
      'discountAmount', 'discountPercent',
    ];
    for (const k of DROP_TOP) delete cfg[k];
    if (cfg.attention && typeof cfg.attention === 'object') {
      const { email: _email, ...rest } = cfg.attention as Record<string, unknown>;
      cfg.attention = rest;
    }
    // documentInfo.referenceNo is customer-facing free text that, in practice,
    // carries INTERNAL ops notes (billing customer, "NOT INVOICED", staff names).
    // Strip it entirely; the generic DO heading falls back to documentNumber.
    if (cfg.documentInfo && typeof cfg.documentInfo === 'object') {
      const { referenceNo: _ref, ...di } = cfg.documentInfo as Record<string, unknown>;
      cfg.documentInfo = di;
    }
    // NOTE: deliveryGroup is deliberately NOT kept — it is the real Asset id
    // (deliveries.service sets deliveryGroup = assetId). The "Model … S/No …"
    // grouping is done SERVER-SIDE in groupDeliveryLinesForPublic (before this
    // sanitise) and baked into `description`, so no asset id ever ships.
    const ITEM_KEEP = ['id', 'sku', 'skuKey', 'itemCode', 'description', 'quantity', 'uom', 'remarks', 'serialNumbers', 'proofPhotos'];
    if (Array.isArray(cfg.items)) {
      cfg.items = cfg.items.map((it: any) => {
        const out: any = {};
        for (const k of ITEM_KEEP) if (it && it[k] !== undefined) out[k] = it[k];
        return out;
      });
    }
    return cfg;
  }

  /**
   * AUTHENTICATED (office) — mint or reuse a view-only link for a DO/RDO in the
   * caller's org. Reuses the newest active (non-revoked) link so re-sharing is
   * idempotent. No expiry is ever set.
   */
  async generateForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, type: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (!DO_TYPES.includes(doc.type)) {
      throw new BadRequestException('Only delivery orders can be shared as a view-only link');
    }

    const existing = await this.prisma.documentShareLink.findFirst({
      where: { documentId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { token: true },
    });
    const token =
      existing?.token ??
      (
        await this.prisma.documentShareLink.create({
          data: { documentId, token: this.generateToken() },
          select: { token: true },
        })
      ).token;

    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const path = `/guest/do/${token}`;
    return { token, path, url: base ? `${base}${path}` : path };
  }

  /** AUTHENTICATED (office) — revoke every active view-only link on the document. */
  async revokeForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const r = await this.prisma.documentShareLink.updateMany({
      where: { documentId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: r.count };
  }

  private async resolveToken(token: string): Promise<{
    link: { documentId: string; organizationId: string } | null;
    state: TokenState;
  }> {
    const link = await this.prisma.documentShareLink.findUnique({
      where: { token },
      select: { documentId: true, revokedAt: true, document: { select: { organizationId: true } } },
    });
    if (!link) return { link: null, state: 'notfound' };
    if (link.revokedAt) {
      return { link: { documentId: link.documentId, organizationId: link.document.organizationId }, state: 'revoked' };
    }
    return { link: { documentId: link.documentId, organizationId: link.document.organizationId }, state: 'ok' };
  }

  /**
   * PUBLIC — read-only render payload for the token's document. Returns 200 with
   * a `state` so the page shows the right screen (never leaks whether a token
   * existed beyond ok/revoked/notfound). Reuses getById so the DO renders
   * IDENTICALLY to the portal (same config folds: projectName, scheduledFor,
   * per-line proof photos), then WHITELISTS the output down to only what the
   * preview draws — never the run, other documents, other customers, or org-wide
   * fields. `pingCount` is dropped so the auth-only "View route" action is never
   * offered here.
   */
  async getPublicView(token: string) {
    const { link, state } = await this.resolveToken(token);
    if (!link || state !== 'ok') return { state };

    const full: any = await this.documentsService.getById(link.documentId, link.organizationId);
    const org = full?.organization ?? {};
    const reports = Array.isArray(full?.maintenanceReports) ? full.maintenanceReports : [];

    // CleanDocumentPreview's DO layout branch matches the SHORT type codes the
    // office passes ('DO' / 'RDO'), not the raw stored type. Map the stored type
    // to that code so the public view enters the DO layout (and the org selector
    // then picks the Biofuel replica) instead of falling through to the default
    // priced layout. Pass any other code through unchanged.
    const TYPE_MAP: Record<string, string> = {
      DELIVERY_ORDER: 'DO',
      RETURN_DELIVERY_ORDER: 'RDO',
    };
    const documentType = (full?.type && TYPE_MAP[full.type]) || full?.type || null;

    // Collapse the delivery lines into their "N units / Model / S/No." display
    // form on the SERVER (using deliveryGroup = the Asset id), so the sanitise
    // below can drop the asset id — only the rendered description lines ship.
    const isReturn = full?.type === 'RETURN_DELIVERY_ORDER' || full?.type === 'RDO';
    const rawCfg: any = full?.config ?? {};
    const groupedCfg = {
      ...rawCfg,
      items: this.groupDeliveryLinesForPublic(Array.isArray(rawCfg.items) ? rawCfg.items : [], isReturn),
    };

    // The DO No. row reads data.documentInfo?.documentNumber || data.name. The
    // document number lives on the Document ROW (getById's full.name), NOT in
    // config, so the config-only public payload had neither and rendered blank.
    // Carry the name (the DO number) so the header shows it, matching the portal.
    const data = this.sanitizeConfigForPublic(groupedCfg);
    if (full?.name && data && data.name == null) data.name = full.name;

    return {
      state: 'ok' as const,
      documentType,
      data,
      organization: {
        id: org.id ?? null,
        name: org.name ?? null,
        logo: org.logo ?? null,
        address: org.address ?? null,
        phoneNumber: org.phoneNumber ?? null,
        registrationNumber: org.registrationNumber ?? null,
      },
      maintenanceReports: reports.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        photos: r.photos ?? [],
        signature: r.signature ?? null,
        signedByName: r.signedByName ?? null,
        signedAt: r.signedAt ?? null,
        technicianName: r.technicianName ?? null,
        createdAt: r.createdAt,
        subjectAsset: r.subjectAsset ?? null,
        subjectSku: r.subjectSku ?? null,
        // pingCount is a plain integer (how many GPS pings this DO_START has). The
        // Timeline uses it to decide whether to offer the "View route" link; the
        // actual coordinates come from the token-scoped route endpoint below.
        pingCount: r.pingCount ?? 0,
      })),
    };
  }

  /**
   * PUBLIC — the GPS route for one DO_START report behind a view-only token.
   * DOUBLY scoped: the token must be valid + non-revoked, AND the report must
   * belong to THAT token's document (a bare report id is never trusted — a token
   * for another document, or a report from another document, resolves to 404).
   * Returns ONLY lat/lng/timestamp per ping: no device id, accuracy, speed,
   * heading, user, or report internals. A shared DO is final, so no live flag.
   */
  async getPublicRouteTrack(token: string, reportId: string) {
    const { link, state } = await this.resolveToken(token);
    if (!link || state !== 'ok') throw new NotFoundException('Not found');
    // The report must be a DO_START belonging to THIS token's document + org.
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: {
        id: reportId,
        documentId: link.documentId,
        organizationId: link.organizationId,
        kind: 'DO_START',
      },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Not found');
    const pings = await this.prisma.deliveryLocationPing.findMany({
      where: { reportId },
      orderBy: { timestamp: 'asc' },
      select: { latitude: true, longitude: true, timestamp: true },
    });
    return { pings };
  }
}
