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

    return {
      state: 'ok' as const,
      documentType,
      data: this.sanitizeConfigForPublic(full?.config),
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
      })),
    };
  }
}
