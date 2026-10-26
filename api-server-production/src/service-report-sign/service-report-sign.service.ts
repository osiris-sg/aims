import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { MaintenanceReportsService } from '../maintenance-reports/maintenance-reports.service';

/**
 * Remote customer signature for SERVICE reports (2026-10-26).
 *
 * The DO pattern (public-document: office mints a token link, the customer
 * signs on /guest/do/<token>, one narrow write) applied to service reports.
 * The customer could not sign on site; the technician (field app) or the
 * office (portal) sends them a link instead.
 *
 * - Mint: authenticated, org-scoped. One link covers 1..N unsigned SERVICE
 *   reports of ONE customer, mirroring the field's "Sign all N" batch rule.
 *   An active link for the exact same set is reused.
 * - View: @Public, token only. Returns a whitelisted summary (no ids beyond the
 *   report ids the token already carries, no prices, no emails).
 * - Sign: @Public, token only, nothing addressable in the body. Uploads the PNG
 *   to S3 like the field app does, then calls the SAME
 *   MaintenanceReportsService.sign the on-site flow uses, per report — so
 *   status -> completed, signedAt, the deferred customer email and any future
 *   signing side effect come for free. Single-use: the link is claimed
 *   atomically (signedAt IS NULL in the WHERE) before any report is touched.
 * - PDF: @Public, token only; renders one of the token's reports on demand
 *   (service-report PDFs are never stored, so "regenerate" is automatic).
 */

// Same window as the DO guest delivery link (public-delivery LINK_WINDOW_MS).
const LINK_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_REPORTS = 20;
const NAME_MAX = 120;
const SIG_PREFIX = 'data:image/png;base64,';
const SIG_MAX_BYTES = 500_000;
const SIGNATURE_FOLDER = 'maintenance-reports'; // where the field app uploads signatures

// Per-process limiters, same shape and caveat as public-document (single
// Render instance today; move to a shared store before scaling out).
function makeLimiter(windowMs: number, max: number, msg: string) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string) => {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (b.count >= max) throw new HttpException(msg, HttpStatus.TOO_MANY_REQUESTS);
    b.count += 1;
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  };
}
const readLimit = makeLimiter(60_000, 60, 'Too many requests. Please slow down and try again shortly.');
const signLimit = makeLimiter(60_000, 5, 'Too many attempts. Please wait a minute and try again.');

type LinkState = 'active' | 'signed' | 'revoked' | 'expired' | 'notfound';

const customerOf = (r: { serviceData: unknown }) => String(((r.serviceData as any) ?? {}).customerName ?? '').trim() || 'Unknown customer';

@Injectable()
export class ServiceReportSignService {
  private readonly logger = new Logger(ServiceReportSignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly reports: MaintenanceReportsService,
  ) {}

  readGate(token: string, ip: string) {
    readLimit(`${token || 'notoken'}::${ip || 'noip'}`);
  }
  signGate(token: string, ip: string) {
    signLimit(`${token || 'notoken'}::${ip || 'noip'}`);
  }

  private portalPath(token: string) {
    const path = `/guest/service-report/${token}`;
    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    return { path, url: base ? `${base}${path}` : path };
  }

  // ── office / field (authenticated) ─────────────────────────────────────
  async mint(organizationId: string, body: { reportIds?: string[]; techSignatureKey?: string }, userId?: string) {
    const ids = Array.from(new Set((body?.reportIds ?? []).map((s) => String(s).trim()).filter(Boolean)));
    if (!ids.length) throw new BadRequestException('Pick at least one report');
    if (ids.length > MAX_REPORTS) throw new BadRequestException(`One link can cover at most ${MAX_REPORTS} reports`);
    const techKey = (body?.techSignatureKey ?? '').trim() || null;
    if (techKey && !/^maintenance-reports\/[A-Za-z0-9._-]+$/.test(techKey)) throw new BadRequestException('Invalid technician signature');

    const rows = await this.prisma.maintenanceServiceReport.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, kind: true, status: true, signature: true, serviceData: true },
    });
    if (rows.length !== ids.length) throw new NotFoundException('Service report not found');
    if (rows.some((r) => r.kind !== 'SERVICE')) throw new BadRequestException('Only service reports can be sent for signature');
    if (rows.some((r) => r.status === 'completed' || r.signature)) throw new BadRequestException('A selected report is already signed');
    const customers = Array.from(new Set(rows.map(customerOf)));
    if (customers.length > 1) throw new BadRequestException('One link can only cover one customer’s reports');

    // Reuse the newest active link for exactly this set (re-sharing is idempotent).
    const now = new Date();
    const key = [...ids].sort().join(',');
    const candidates = await this.prisma.serviceReportSignLink.findMany({
      where: { organizationId, revokedAt: null, signedAt: null, reportIds: { hasEvery: ids }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'desc' },
    });
    let link = candidates.find((l) => [...l.reportIds].sort().join(',') === key) ?? null;
    if (link && techKey && link.techSignatureKey !== techKey) {
      link = await this.prisma.serviceReportSignLink.update({ where: { id: link.id }, data: { techSignatureKey: techKey } });
    }
    if (!link) {
      link = await this.prisma.serviceReportSignLink.create({
        data: {
          token: randomBytes(32).toString('base64url'),
          organizationId,
          reportIds: ids,
          techSignatureKey: techKey,
          createdBy: userId ?? null,
          expiresAt: new Date(now.getTime() + LINK_WINDOW_MS),
        },
      });
    }
    return { token: link.token, ...this.portalPath(link.token), expiresAt: link.expiresAt, reportCount: ids.length, customerName: customers[0] };
  }

  /** Revoke every open link that covers this report (org-scoped). */
  async revokeForReport(organizationId: string, reportId: string) {
    const r = await this.prisma.serviceReportSignLink.updateMany({
      where: { organizationId, reportIds: { has: reportId }, revokedAt: null, signedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: r.count };
  }

  /** The active link for a report, if any (portal shows it instead of minting again). */
  async activeForReport(organizationId: string, reportId: string) {
    const link = await this.prisma.serviceReportSignLink.findFirst({
      where: { organizationId, reportIds: { has: reportId }, revokedAt: null, signedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: 'desc' },
    });
    return link ? { token: link.token, ...this.portalPath(link.token), expiresAt: link.expiresAt, reportCount: link.reportIds.length } : null;
  }

  // ── public (token) ─────────────────────────────────────────────────────
  private async resolve(token: string) {
    if (!token || token.length < 16) return { link: null, state: 'notfound' as LinkState };
    const link = await this.prisma.serviceReportSignLink.findUnique({ where: { token } });
    if (!link) return { link: null, state: 'notfound' as LinkState };
    let state: LinkState = 'active';
    if (link.signedAt) state = 'signed';
    else if (link.revokedAt) state = 'revoked';
    else if (link.expiresAt && link.expiresAt.getTime() < Date.now()) state = 'expired';
    return { link, state };
  }

  /** The token's reports, re-scoped to the link's org (tenant safety). */
  private loadReports(link: { organizationId: string; reportIds: string[] }) {
    return this.prisma.maintenanceServiceReport.findMany({
      where: { id: { in: link.reportIds }, organizationId: link.organizationId, kind: 'SERVICE' },
      orderBy: { reportNumber: 'asc' },
      select: {
        id: true, reportNumber: true, status: true, signedAt: true, signedByName: true, technicianName: true, serviceData: true, createdAt: true,
        asset: { select: { name: true } },
        inventory: { select: { sku: true } },
      },
    });
  }

  async view(token: string) {
    const { link, state } = await this.resolve(token);
    if (!link || state === 'notfound') return { state: 'notfound' as const };
    const org = await this.prisma.organization.findUnique({ where: { id: link.organizationId }, select: { name: true, logo: true, phoneNumber: true } });
    const base = {
      state,
      organization: { name: org?.name ?? '', logo: org?.logo ?? null, phoneNumber: org?.phoneNumber ?? null },
      expiresAt: link.expiresAt,
      signedAt: link.signedAt,
      signerName: link.signerName,
    };
    if (state === 'revoked' || state === 'expired') return base;
    const rows = await this.loadReports(link);
    const reports = rows.map((r) => {
      const sd: any = r.serviceData ?? {};
      return {
        id: r.id,
        reportNumber: r.reportNumber,
        model: sd.model ?? r.asset?.name ?? null,
        serial: sd.serial ?? r.inventory?.sku ?? null,
        serviceDate: sd.serviceDate ?? null,
        jobLocation: sd.jobLocation ?? null,
        technicianName: r.technicianName ?? null,
        signed: r.status === 'completed',
        signedByName: r.signedByName ?? null,
      };
    });
    const first: any = rows[0]?.serviceData ?? {};
    return {
      ...base,
      customerName: String(first.customerName ?? '').trim() || null,
      suggestedSignerName: String(first.clientSignerName ?? '').trim() || null,
      reports,
    };
  }

  /** PDF of ONE of the token's reports (on demand, same renderer as the email). */
  async pdf(token: string, reportId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { link, state } = await this.resolve(token);
    if (!link || state === 'notfound' || state === 'revoked' || state === 'expired') throw new NotFoundException('Not found');
    if (!link.reportIds.includes(reportId)) throw new NotFoundException('Not found');
    const report = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id: reportId, organizationId: link.organizationId, kind: 'SERVICE' },
      include: {
        asset: { select: { name: true, skuKey: true } },
        inventory: { select: { sku: true, serialNumber: true } },
        organization: { select: { name: true, logo: true } },
      },
    });
    if (!report) throw new NotFoundException('Not found');
    const buffer = await this.reports.renderReportPdf(report);
    return { buffer, filename: `service-report-${report.reportNumber ?? 'draft'}.pdf` };
  }

  async sign(token: string, body: { name?: string; signature?: string }, meta: { ip: string; userAgent: string }) {
    const { link, state } = await this.resolve(token);
    if (!link || state === 'notfound') throw new HttpException('This link is no longer available.', HttpStatus.GONE);
    if (state === 'signed') return { ok: false, alreadySigned: true, message: 'These reports have already been signed.' };
    if (state !== 'active') throw new HttpException('This link is no longer available.', HttpStatus.GONE);

    const name = (body?.name ?? '').trim();
    if (!name) throw new BadRequestException('Please enter the name of the person signing.');
    if (name.length > NAME_MAX) throw new BadRequestException('That name is too long.');
    const signature = (body?.signature ?? '').trim();
    if (!signature.startsWith(SIG_PREFIX)) throw new BadRequestException('A signature is required.');
    const b64 = signature.slice(SIG_PREFIX.length);
    const png = Buffer.from(b64, 'base64');
    if (!png.length || png.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) throw new BadRequestException('The signature could not be read.');
    if (png.length > SIG_MAX_BYTES) throw new BadRequestException('That signature image is too large.');
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new BadRequestException('The signature must be a PNG image.');

    // Claim the link FIRST, atomically: two concurrent submits cannot both win.
    const now = new Date();
    const claim = await this.prisma.serviceReportSignLink.updateMany({
      where: { id: link.id, signedAt: null, revokedAt: null },
      data: { signedAt: now, signerName: name, signerIp: meta.ip || null, userAgent: (meta.userAgent || '').slice(0, 300) || null },
    });
    if (claim.count === 0) return { ok: false, alreadySigned: true, message: 'These reports have already been signed.' };

    try {
      // Same upload the field app does (folder + PNG), so every renderer that
      // reads serviceData.clientSignatureKey draws it exactly as an on-site one.
      const clientKey = await this.uploads.uploadFileInChunks({
        file: { buffer: png, mimetype: 'image/png' } as Express.Multer.File,
        key: `${SIGNATURE_FOLDER}/${randomUUID()}.png`,
      });
      const rows = await this.loadReports(link);
      const results: { reportNumber: number | null; ok: boolean; error?: string }[] = [];
      for (const r of rows) {
        if (r.status === 'completed') {
          results.push({ reportNumber: r.reportNumber, ok: true, error: 'already signed' });
          continue;
        }
        try {
          await this.reports.sign(
            r.id,
            {
              signature: clientKey,
              signedByName: name,
              clientSignatureKey: clientKey,
              ...(link.techSignatureKey ? { techSignatureKey: link.techSignatureKey } : {}),
            },
            link.organizationId,
          );
          results.push({ reportNumber: r.reportNumber, ok: true });
        } catch (e: any) {
          results.push({ reportNumber: r.reportNumber, ok: false, error: e?.message ?? 'failed' });
        }
      }
      const signedCount = results.filter((x) => x.ok && !x.error).length;
      if (!results.some((x) => x.ok)) throw new Error(results.map((x) => x.error).join('; ') || 'no reports');
      this.logger.log(`service-report sign link ${link.id}: ${signedCount} report(s) signed by ${name} (${meta.ip || 'ip?'})`);
      return { ok: true, alreadySigned: false, signedCount, signedAt: now, results };
    } catch (e: any) {
      // Nothing was signed: release the claim so the customer can retry.
      await this.prisma.serviceReportSignLink.update({ where: { id: link.id }, data: { signedAt: null, signerName: null, signerIp: null, userAgent: null } });
      this.logger.error(`service-report sign link ${link.id} failed: ${e?.message}`);
      throw new BadRequestException('The signature could not be saved. Please try again.');
    }
  }
}
