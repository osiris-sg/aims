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

// A SEPARATE, far tighter bucket for the one WRITE route. 60/min is a READ
// budget; a signature submit is a once-ever action, so anything past a couple of
// attempts a minute is either a mistake or someone probing. Same per-process
// caveat as above.
const SIGN_RL_WINDOW_MS = 60_000;
const SIGN_RL_MAX = 5;
const signRlBuckets = new Map<string, { count: number; resetAt: number }>();
function enforceSignRateLimit(key: string) {
  const now = Date.now();
  const bucket = signRlBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    signRlBuckets.set(key, { count: 1, resetAt: now + SIGN_RL_WINDOW_MS });
    return;
  }
  if (bucket.count >= SIGN_RL_MAX) {
    throw new HttpException('Too many attempts. Please wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
  }
  bucket.count += 1;
  if (signRlBuckets.size > 5000) {
    for (const [k, v] of signRlBuckets) if (v.resetAt <= now) signRlBuckets.delete(k);
  }
}

// Signature payload bounds. Stored VERBATIM and rendered in an <img> for
// everyone who opens the document afterwards, so it is validated on the way in
// rather than trusted.
const SIG_PREFIX = 'data:image/png;base64,';
const SIG_MAX_BYTES = 500_000; // a pad drawing is single-digit KB; this is a sanity ceiling
const NAME_MAX = 120;

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

  /** Gate for the ONE write route — far tighter than the read budget. */
  publicSignRateGate(token: string, ip: string) {
    enforceSignRateLimit(`${token || 'notoken'}::${ip || 'noip'}`);
  }

  /**
   * PUBLIC — the customer signs an UNSIGNED DO from the share link.
   *
   * This is the only mutating route behind this token, and it is deliberately
   * narrow: it writes signature fields on the run's DO_ACK rows and NOTHING
   * else. It does NOT call finalizeRun — that flips run status, mints the DO and
   * triggers the invoice, none of which belongs to a customer clicking a link
   * (and its `status: not completed` guard would skip these rows regardless).
   *
   * WRITE-ONCE is enforced by the WHERE clause, not by a read-then-write: the
   * precondition `signature: null` lives in the same statement as the update, so
   * two concurrent submits cannot both win. A rowCount of 0 means it was already
   * signed, and that is reported rather than returned as a silent success.
   *
   * NOTHING addressable comes from the body. deliveryId and organizationId are
   * resolved from the TOKEN, so the endpoint cannot be aimed at another
   * document by editing the payload.
   *
   * `signedAt` is the true moment of signing. The date the customer TYPES is a
   * separate fact — it may legitimately differ — and goes to
   * serviceData.signedDateText as an ISO date, formatted at render. Writing it
   * into signedAt would corrupt the audit trail that records when the signature
   * was actually captured.
   *
   * Provenance (ip, user agent, submitted timestamp) is recorded alongside.
   * Nothing else in this codebase does that, but this is the one write where the
   * signer is anonymous and a disputed signature is plausible.
   */
  async publicSign(
    token: string,
    body: { name?: string; signature?: string; signedDate?: string },
    meta: { ip: string; userAgent: string },
  ) {
    const { link, state } = await this.resolveToken(token);
    if (!link || state !== 'ok') {
      // Same opaque refusal the read path gives — never reveal whether a token
      // existed beyond ok/revoked/notfound.
      throw new HttpException('This link is no longer available.', HttpStatus.GONE);
    }

    // ── validate the payload ────────────────────────────────────────────────
    const name = (body?.name ?? '').trim();
    if (!name) throw new BadRequestException('Please enter the name of the person signing.');
    if (name.length > NAME_MAX) throw new BadRequestException('That name is too long.');

    const signature = (body?.signature ?? '').trim();
    if (!signature) throw new BadRequestException('A signature is required.');
    if (!signature.startsWith(SIG_PREFIX)) {
      throw new BadRequestException('The signature must be a PNG data URL.');
    }
    const b64 = signature.slice(SIG_PREFIX.length);
    let decoded: Buffer;
    try {
      decoded = Buffer.from(b64, 'base64');
    } catch {
      throw new BadRequestException('The signature could not be read.');
    }
    // Buffer.from is lenient; re-encoding catches a payload that is not really
    // base64 rather than storing something that will never render.
    if (decoded.length === 0 || decoded.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) {
      throw new BadRequestException('The signature could not be read.');
    }
    if (decoded.length > SIG_MAX_BYTES) throw new BadRequestException('That signature image is too large.');
    // PNG magic bytes — the prefix claims PNG, so verify the bytes agree.
    if (decoded.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new BadRequestException('The signature must be a PNG image.');
    }

    // Typed date: stored as an ISO date (YYYY-MM-DD), formatted at render, so a
    // signer cannot put free text on the document.
    let signedDateText: string | null = null;
    if (body?.signedDate) {
      const d = new Date(body.signedDate);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('That date could not be read.');
      signedDateText = d.toISOString().slice(0, 10);
    }

    // ── resolve the run FROM THE TOKEN ──────────────────────────────────────
    const item = await this.prisma.deliveryItem.findFirst({
      where: { documentId: link.documentId },
      select: { deliveryId: true },
    });
    if (!item?.deliveryId) {
      throw new BadRequestException('This document has no delivery run to sign against.');
    }

    const now = new Date();
    const provenance = {
      signedDateText,
      signedVia: 'public-share-link',
      signedIp: meta.ip || null,
      signedUserAgent: (meta.userAgent || '').slice(0, 400) || null,
      signedSubmittedAt: now.toISOString(),
    };

    // ── WRITE-ONCE ──────────────────────────────────────────────────────────
    // The precondition IS the WHERE clause. status is deliberately absent from
    // the SET: the run stays exactly as finalized as it already was.
    const targets = await this.prisma.maintenanceServiceReport.findMany({
      where: { deliveryId: item.deliveryId, kind: 'DO_ACK', signature: null },
      select: { id: true, serviceData: true },
    });
    if (targets.length === 0) {
      // Either already signed, or the run has no DO_ACK at all. Say so instead
      // of returning a success that wrote nothing.
      const signed = await this.prisma.maintenanceServiceReport.count({
        where: { deliveryId: item.deliveryId, kind: 'DO_ACK', signature: { not: null } },
      });
      return {
        ok: false,
        alreadySigned: signed > 0,
        signedCount: 0,
        message: signed > 0
          ? 'This delivery order has already been signed.'
          : 'This delivery order cannot be signed.',
      };
    }

    // serviceData is merged per row so an existing payload (photoAngles etc.)
    // survives — a blind overwrite would discard it.
    let signedCount = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const t of targets) {
        const merged = { ...((t.serviceData as Record<string, unknown>) ?? {}), ...provenance };
        const res = await tx.maintenanceServiceReport.updateMany({
          where: { id: t.id, signature: null }, // re-asserted at write time
          data: { signature, signedByName: name, signedAt: now, serviceData: merged },
        });
        signedCount += res.count;
      }
    });

    if (signedCount === 0) {
      return { ok: false, alreadySigned: true, signedCount: 0, message: 'This delivery order has already been signed.' };
    }
    return { ok: true, alreadySigned: false, signedCount, signedAt: now };
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
        // The date the signer typed (getById already narrowed serviceData down
        // to this one key — no provenance reaches here to be leaked).
        signedDateText: r.signedDateText ?? null,
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
