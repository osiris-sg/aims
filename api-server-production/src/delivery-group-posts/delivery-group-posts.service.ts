import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { PdfGeneratorService } from '../common/services/pdf-generator.service';
import { S3Service } from '../common/services/s3.service';
import { isOrgFeatureEnabled } from '../common/org-features';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { PublicDocumentService } from '../public-document/public-document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionLogService } from '../action-log/action-log.service';
import { DELIVERY_GROUP_POSTS_FLAG, enqueueDeliveryGroupPost, groupPostsKick } from './enqueue';

/**
 * Delivery group posts (2026-09-30). Rows are queued at each delivery sign-off
 * (./enqueue.ts). This service:
 *   1. renders the SIGNED DO(s) to PDF from the portal's view-only page, one
 *      post at a time (PENDING → READY), every minute or right after a queue;
 *   2. serves the post-only worker (whatsapp-post-bridge): jobs, an atomic
 *      claim with a lease, done/failed, its group list and a heartbeat;
 *   3. serves the portal: group dropdowns, a run's post status, retry, and the
 *      on-demand "Download signed DO".
 *
 * WA_POST_BRIDGES on the API binds each worker token to the org(s) it posts
 * for: {"<token>": {"orgIds": ["<org id>"], "label": "Osiris"}}.
 * WA_POST_PAUSED=true is the API-side kill switch (no jobs handed out).
 */
interface PostBridge {
  token: string;
  orgIds: string[];
  label: string;
}

const LEASE_MS = 10 * 60_000; // a claimed post the worker never acked is re-offered after this
const RENDER_LEASE_MS = 5 * 60_000; // a render the API died during is retried after this
const MAX_ATTEMPTS = 5;
const HEARTBEAT_SILENCE_MS = 5 * 60_000;
// The view-only page's DO sheet (portal app/guest/do/[token]/page.tsx).
const DO_SHEET = '[data-print-paper][data-print-sheet="do"]';

@Injectable()
export class DeliveryGroupPostsService implements OnModuleInit {
  private readonly logger = new Logger(DeliveryGroupPostsService.name);
  private parsed: { raw: string; bridges: PostBridge[] } | null = null;
  private rendering = false;
  private readonly beats = new Map<string, { at: number; alerted: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfGeneratorService,
    private readonly s3: S3Service,
    private readonly publicDocs: PublicDocumentService,
    private readonly notifications: NotificationsService,
    private readonly actionLog: ActionLogService,
  ) {}

  onModuleInit() {
    groupPostsKick.on('kick', () => void this.renderSweep());
  }

  // ── 1. Render the signed DO ────────────────────────────────────────────────

  /** Every minute (and right after a sign-off): render queued posts, one at a
   *  time. Headless Chrome is heavy; posts are a handful a day. */
  @Cron('* * * * *')
  async renderSweep(): Promise<number> {
    if (this.rendering) return 0;
    this.rendering = true;
    let done = 0;
    try {
      for (let i = 0; i < 5; i++) {
        const row = await this.prisma.deliveryGroupPost.findFirst({
          where: {
            OR: [{ status: 'PENDING' }, { status: 'RENDERING', updatedAt: { lt: new Date(Date.now() - RENDER_LEASE_MS) } }],
          },
          orderBy: { createdAt: 'asc' },
        });
        if (!row) break;
        // Atomic: only one process renders a post.
        const claimed = await this.prisma.deliveryGroupPost.updateMany({
          where: { id: row.id, organizationId: row.organizationId, status: row.status, updatedAt: row.updatedAt },
          data: { status: 'RENDERING' },
        });
        if (claimed.count !== 1) continue;
        await runAsOrg(row.organizationId, () => this.renderOne(row));
        done++;
      }
    } catch (e: any) {
      this.logger.error(`render sweep failed: ${e?.message}`);
    } finally {
      this.rendering = false;
    }
    return done;
  }

  private async renderOne(row: any) {
    try {
      const pdfKeys: string[] = [];
      for (const documentId of row.documentIds as string[]) {
        const { buffer, fileName } = await this.renderSignedDo(row.organizationId, documentId);
        const key = `delivery-posts/${row.organizationId}/${row.id}/${fileName}`;
        await this.s3.uploadFile(key, buffer, 'application/pdf');
        pdfKeys.push(key);
      }
      await this.prisma.deliveryGroupPost.updateMany({
        where: { id: row.id, organizationId: row.organizationId },
        data: { status: 'READY', pdfKeys, renderedAt: new Date(), error: null },
      });
      this.actionLog.system('delivery-group-posts', 'RENDER', 'delivery', {
        organizationId: row.organizationId,
        resourceId: row.deliveryId,
        details: { postId: row.id, pdfKeys },
      });
    } catch (e: any) {
      const attempts = (row.attempts ?? 0) + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await this.prisma.deliveryGroupPost.updateMany({
        where: { id: row.id, organizationId: row.organizationId },
        data: { status: failed ? 'FAILED' : 'PENDING', attempts, error: `PDF: ${String(e?.message || e).slice(0, 400)}` },
      });
      this.logger.warn(`post ${row.id}: DO render failed (${attempts}/${MAX_ATTEMPTS}): ${e?.message}`);
      this.actionLog.system('delivery-group-posts', 'ERROR', 'delivery', {
        organizationId: row.organizationId,
        resourceId: row.deliveryId,
        status: 'FAILURE',
        details: { postId: row.id, attempts, error: String(e?.message || e).slice(0, 400) },
      });
    }
  }

  /** The SIGNED DO exactly as the field app prints it: headless Chrome on the
   *  portal's view-only page (a vo_ token can never sign). */
  async renderSignedDo(organizationId: string, documentId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { name: true } });
    if (!doc) throw new NotFoundException('Delivery order not found');
    const link: any = await this.publicDocs.getOrCreateViewOnlyLink(documentId, organizationId);
    if (!link?.url || !/^https?:\/\//.test(link.url)) throw new Error('PORTAL_URL is not configured, so the DO page cannot be opened');
    const buffer = await this.pdf.generatePdfFromUrl(link.url, {
      waitForSelector: DO_SHEET,
      fitToPage: { selector: DO_SHEET, bandMm: 285 },
      timeoutMs: 60_000,
    });
    const safe = String(doc.name || 'DO').replace(/[^a-zA-Z0-9._-]/g, '_');
    return { buffer, fileName: `${safe}-signed.pdf` };
  }

  // ── 2. The post worker ─────────────────────────────────────────────────────

  private bridges(): PostBridge[] {
    const raw = process.env.WA_POST_BRIDGES || '';
    if (this.parsed?.raw === raw) return this.parsed.bridges;
    let bridges: PostBridge[] = [];
    try {
      const obj = raw ? JSON.parse(raw) : {};
      bridges = Object.entries<any>(obj)
        .filter(([t, v]) => t && Array.isArray(v?.orgIds) && v.orgIds.length)
        .map(([token, v]) => ({ token, orgIds: v.orgIds.map(String), label: String(v.label || 'post bridge') }));
    } catch (e: any) {
      this.logger.error(`WA_POST_BRIDGES is not valid JSON: ${e?.message}`);
    }
    this.parsed = { raw, bridges };
    return bridges;
  }

  bridgeFor(token: string | undefined): PostBridge {
    const t = String(token || '');
    const hit = t
      ? this.bridges().find((b) => b.token.length === t.length && timingSafeEqual(Buffer.from(b.token), Buffer.from(t)))
      : undefined;
    if (!hit) throw new UnauthorizedException('Invalid post bridge token');
    return hit;
  }

  private paused() {
    return /^(1|true|yes)$/i.test(process.env.WA_POST_PAUSED || '');
  }

  private async liveOrgs(bridge: PostBridge): Promise<string[]> {
    const out: string[] = [];
    for (const org of bridge.orgIds) if (await isOrgFeatureEnabled(this.prisma, org, DELIVERY_GROUP_POSTS_FLAG)) out.push(org);
    return out;
  }

  private async url(key: string): Promise<string> {
    return /^https?:\/\//.test(key) ? key : this.s3.getSignedUrl(key, 3600);
  }

  /** Posts ready to send (and ones whose lease ran out). Nothing while paused
   *  or for an org whose flag is off. */
  async jobs(token: string | undefined) {
    const bridge = this.bridgeFor(token);
    if (this.paused()) return { paused: true, jobs: [] };
    const orgs = await this.liveOrgs(bridge);
    if (!orgs.length) return { paused: false, jobs: [] };
    const rows = await this.prisma.deliveryGroupPost.findMany({
      where: {
        organizationId: { in: orgs },
        OR: [{ status: 'READY' }, { status: 'CLAIMED', claimedAt: { lt: new Date(Date.now() - LEASE_MS) } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    const jobs = [];
    for (const r of rows) {
      jobs.push({
        id: r.id,
        groupId: r.groupId,
        groupName: r.groupName,
        caption: r.caption,
        photos: await Promise.all(r.photoKeys.map(async (k, i) => ({ url: await this.url(k), filename: `photo-${i + 1}.jpg` }))),
        documents: await Promise.all(r.pdfKeys.map(async (k) => ({ url: await this.url(k), filename: k.split('/').pop() || 'DO.pdf' }))),
      });
    }
    return { paused: false, jobs };
  }

  /** Atomic claim with a lease: exactly one worker gets a post. */
  async claim(token: string | undefined, id: string) {
    const bridge = this.bridgeFor(token);
    if (this.paused()) return { claimed: false, reason: 'paused' };
    const orgs = await this.liveOrgs(bridge);
    if (!orgs.length) return { claimed: false, reason: 'disabled' };
    const r = await this.prisma.deliveryGroupPost.updateMany({
      where: {
        id,
        organizationId: { in: orgs },
        OR: [{ status: 'READY' }, { status: 'CLAIMED', claimedAt: { lt: new Date(Date.now() - LEASE_MS) } }],
      },
      data: { status: 'CLAIMED', claimedAt: new Date(), claimedBy: bridge.label, attempts: { increment: 1 } },
    });
    return { claimed: r.count === 1 };
  }

  /** The worker's report. ok → SENT (idempotent). A failure goes back to
   *  READY until MAX_ATTEMPTS, then FAILED. */
  async done(token: string | undefined, id: string, body: { ok?: boolean; error?: string; messageIds?: string[]; resumed?: boolean }) {
    const bridge = this.bridgeFor(token);
    const row = await this.prisma.deliveryGroupPost.findFirst({ where: { id, organizationId: { in: bridge.orgIds } } });
    if (!row) throw new NotFoundException('Post not found');
    if (row.status === 'SENT') return { status: 'SENT' };
    if (row.status !== 'CLAIMED') throw new BadRequestException(`Post is ${row.status}, not claimed`);
    if (body?.ok) {
      await this.prisma.deliveryGroupPost.updateMany({
        where: { id, organizationId: row.organizationId, status: 'CLAIMED' },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          messageIds: (body.messageIds || []).map(String).slice(0, 40),
          error: body.resumed ? 'Sent before a worker restart; acknowledged on resume, not re-sent' : null,
        },
      });
      return { status: 'SENT' };
    }
    const failed = row.attempts >= MAX_ATTEMPTS;
    await this.prisma.deliveryGroupPost.updateMany({
      where: { id, organizationId: row.organizationId, status: 'CLAIMED' },
      data: { status: failed ? 'FAILED' : 'READY', error: `WhatsApp: ${String(body?.error || 'unknown').slice(0, 400)}` },
    });
    return { status: failed ? 'FAILED' : 'READY' };
  }

  /** The worker's current group list → the dropdown cache of each of its orgs. */
  async reportGroups(token: string | undefined, groups: Array<{ id?: string; name?: string }>) {
    const bridge = this.bridgeFor(token);
    const clean = (Array.isArray(groups) ? groups : [])
      .filter((g) => g?.id && String(g.id).endsWith('@g.us'))
      .map((g) => ({ id: String(g.id), name: String(g.name || g.id).slice(0, 200) }))
      .slice(0, 500);
    const now = new Date();
    for (const organizationId of bridge.orgIds) {
      await runAsOrg(organizationId, async () => {
        for (const g of clean) {
          await this.prisma.whatsAppGroup.upsert({
            where: { organizationId_groupId: { organizationId, groupId: g.id } },
            update: { name: g.name, lastSeenAt: now },
            create: { organizationId, groupId: g.id, name: g.name, lastSeenAt: now },
          });
        }
      });
    }
    return { ok: true, groups: clean.length };
  }

  heartbeat(token: string | undefined) {
    const bridge = this.bridgeFor(token);
    const prev = this.beats.get(bridge.token);
    if (prev?.alerted) {
      for (const organizationId of bridge.orgIds) {
        this.actionLog.system('wa-post-bridge', 'ONLINE', 'delivery-group-posts', { organizationId, details: { bridge: bridge.label } });
      }
    }
    this.beats.set(bridge.token, { at: Date.now(), alerted: false });
    return { ok: true };
  }

  /** A worker that checked in and then went quiet for 5 minutes rings the
   *  office bell once per outage (armed by its first heartbeat since start). */
  @Interval(60_000)
  async checkHeartbeats(now = Date.now()): Promise<number> {
    let rung = 0;
    for (const b of this.bridges()) {
      const beat = this.beats.get(b.token);
      if (!beat || beat.alerted || now - beat.at < HEARTBEAT_SILENCE_MS) continue;
      beat.alerted = true;
      const mins = Math.round((now - beat.at) / 60_000);
      for (const organizationId of b.orgIds) {
        rung++;
        await runAsOrg(organizationId, () =>
          this.notifications.emit({
            organizationId,
            kind: 'WA_POST_BRIDGE_DOWN',
            title: `WhatsApp posting (${b.label}) is offline`,
            body: `No check-in for ${mins} minutes. Signed deliveries are queued and will be posted to their groups when it is back.`,
            entityType: 'wa-post-bridge',
            entityId: `${b.label}:${new Date(beat.at).toISOString()}`,
          }),
        );
        this.actionLog.system('wa-post-bridge', 'OFFLINE', 'delivery-group-posts', { organizationId, details: { bridge: b.label, silentMinutes: mins } });
      }
    }
    return rung;
  }

  // ── 3. Portal ──────────────────────────────────────────────────────────────

  async groups(organizationId: string) {
    return this.prisma.whatsAppGroup.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { groupId: true, name: true, lastSeenAt: true },
    });
  }

  /** A group picked in the portal must be one the worker reported. */
  private async pickGroup(organizationId: string, groupId: string | null | undefined) {
    if (!groupId) return { id: null, name: null };
    const g = await this.prisma.whatsAppGroup.findFirst({ where: { organizationId, groupId }, select: { groupId: true, name: true } });
    if (!g) throw new BadRequestException('That WhatsApp group is not one the posting number is in');
    return { id: g.groupId, name: g.name };
  }

  async setProjectGroup(organizationId: string, projectId: string, groupId: string | null) {
    const g = await this.pickGroup(organizationId, groupId);
    const r = await this.prisma.project.updateMany({
      where: { id: projectId, organizationId },
      data: { whatsappGroupId: g.id, whatsappGroupName: g.name },
    });
    if (!r.count) throw new NotFoundException('Project not found');
    return { whatsappGroupId: g.id, whatsappGroupName: g.name };
  }

  async setCustomerGroup(organizationId: string, customerId: string, groupId: string | null) {
    const g = await this.pickGroup(organizationId, groupId);
    const r = await this.prisma.customer.updateMany({
      where: { id: customerId, organizationId },
      data: { whatsappGroupId: g.id, whatsappGroupName: g.name },
    });
    if (!r.count) throw new NotFoundException('Customer not found');
    return { whatsappGroupId: g.id, whatsappGroupName: g.name };
  }

  async setOpsGroup(organizationId: string, groupId: string | null) {
    const g = await this.pickGroup(organizationId, groupId);
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { deliveryOpsGroupId: g.id, deliveryOpsGroupName: g.name },
    });
    return { deliveryOpsGroupId: g.id, deliveryOpsGroupName: g.name };
  }

  async currentGroups(organizationId: string, target: { projectId?: string; customerId?: string }) {
    if (target.projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: target.projectId, organizationId }, select: { whatsappGroupId: true, whatsappGroupName: true } });
      return { groupId: p?.whatsappGroupId ?? null, groupName: p?.whatsappGroupName ?? null };
    }
    if (target.customerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: target.customerId, organizationId }, select: { whatsappGroupId: true, whatsappGroupName: true } });
      return { groupId: c?.whatsappGroupId ?? null, groupName: c?.whatsappGroupName ?? null };
    }
    const o = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { deliveryOpsGroupId: true, deliveryOpsGroupName: true } });
    return { groupId: o?.deliveryOpsGroupId ?? null, groupName: o?.deliveryOpsGroupName ?? null };
  }

  async postsForDelivery(organizationId: string, deliveryId: string) {
    return this.prisma.deliveryGroupPost.findMany({
      where: { organizationId, deliveryId },
      orderBy: { signedAt: 'asc' },
      select: { id: true, status: true, tripNumber: true, final: true, groupName: true, groupSource: true, signedAt: true, sentAt: true, error: true, attempts: true },
    });
  }

  /** Office retry: a FAILED post, or a SKIPPED one after a group was mapped.
   *  The group is resolved again (the project may have one now). */
  async retry(organizationId: string, postId: string) {
    const row = await this.prisma.deliveryGroupPost.findFirst({ where: { id: postId, organizationId } });
    if (!row) throw new NotFoundException('Post not found');
    if (!['FAILED', 'SKIPPED'].includes(row.status)) throw new BadRequestException(`This post is ${row.status}`);
    const run = await this.prisma.delivery.findFirst({ where: { id: row.deliveryId, organizationId }, select: { projectId: true, customerId: true } });
    const project = run?.projectId ? await this.prisma.project.findFirst({ where: { id: run.projectId, organizationId }, select: { whatsappGroupId: true, whatsappGroupName: true } }) : null;
    const customer = run?.customerId ? await this.prisma.customer.findFirst({ where: { id: run.customerId, organizationId }, select: { whatsappGroupId: true, whatsappGroupName: true } }) : null;
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { deliveryOpsGroupId: true, deliveryOpsGroupName: true } });
    const g = project?.whatsappGroupId
      ? { id: project.whatsappGroupId, name: project.whatsappGroupName, source: 'project' }
      : customer?.whatsappGroupId
        ? { id: customer.whatsappGroupId, name: customer.whatsappGroupName, source: 'customer' }
        : org?.deliveryOpsGroupId
          ? { id: org.deliveryOpsGroupId, name: org.deliveryOpsGroupName, source: 'ops' }
          : null;
    if (!g) throw new BadRequestException('Pick a WhatsApp group on the project (or customer) first');
    await this.prisma.deliveryGroupPost.updateMany({
      where: { id: postId, organizationId, status: row.status },
      data: {
        status: row.pdfKeys.length || !row.documentIds.length ? 'READY' : 'PENDING',
        groupId: g.id,
        groupName: g.name,
        groupSource: g.source,
        attempts: 0,
        error: null,
      },
    });
    groupPostsKick.emit('kick');
    return { ok: true };
  }

  /** "Download signed DO": rendered on demand, always current. The DO must
   *  belong to this run. */
  async signedDoForDelivery(organizationId: string, deliveryId: string, documentId: string) {
    const linked = await this.prisma.deliveryItem.findFirst({ where: { deliveryId, documentId, delivery: { is: { organizationId } } }, select: { id: true } });
    if (!linked) throw new ForbiddenException('That DO is not on this delivery');
    return this.renderSignedDo(organizationId, documentId);
  }

  /** For tests and the office: queue a sign-off's post by hand. */
  enqueue(organizationId: string, deliveryId: string, signedItemIds: string[]) {
    return enqueueDeliveryGroupPost(this.prisma, organizationId, deliveryId, signedItemIds, this.logger);
  }
}
