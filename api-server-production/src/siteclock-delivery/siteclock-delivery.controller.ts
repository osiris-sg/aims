import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { randomBytes } from 'crypto';
import { Public } from '../decorators/public.decorator';
import { PrismaService } from '../common/prisma.service';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { SiteClockInboundGuard } from '../job-photos/siteclock-inbound.guard';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { MaintenanceReportsService } from '../maintenance-reports/maintenance-reports.service';
import { DeliveryGroupPostsService } from '../delivery-group-posts/delivery-group-posts.service';
import { UploadsService } from '../uploads/uploads.service';
import { SiteClockWorkerGuard } from './siteclock-worker.guard';

/** The org flags the field delivery pages read (the SiteClock app mirrors their wording and steps). */
const FIELD_FLAGS = ['enableWctOrders', 'enableWctFinishModes', 'enableWctOrderInvoice', 'enableRealDoOnSchedule', 'enableQuotationToDelivery', 'enableJobFields'] as const;
/** Upload folders the field pages use (helpers/imageUploader.ts keys: <folder>/<8 hex>.<ext>). */
const UPLOAD_FOLDERS = new Set(['do-start', 'do-ack', 'do-install', 'do-stamped', 'maintenance-reports']);
const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type WorkerReq = {
  userOrganization: { id: string };
  siteclockWorker: { userId: string; siteclockUserId: string; name: string | null };
  siteclockJob?: { deliveryId: string; linkId: string; externalRef: string };
};

/**
 * SiteClock worker delivery API (2026-11-06, flag enableSiteClockDeliveries).
 *
 * The SiteClock app's Delivery section is a native clone of the SiteJobs
 * delivery pages; this is what it calls, through SiteClock's backend only
 * (server to server: the org's inbound key + X-SiteClock-Worker-Id, see
 * SiteClockWorkerGuard). Every route is the SiteJobs route of the same name,
 * calling the SAME service method with the same arguments, so DO, invoice,
 * WhatsApp group post, statuses and the SiteClock job itself behave exactly as
 * when the job is done in SiteJobs. Differences, all deliberate:
 *   - a run is addressed by the SiteClock job's externalRef (the guard proves
 *     the job is this worker's), never by a run id the phone could change;
 *   - the acting user is the AIMS member behind the SiteClock worker;
 *   - no scanning: units are reached through the lines AIMS already has;
 *   - the DO comes back as the server-rendered PDF (renderSignedDo, the file
 *     the WhatsApp post attaches), for the phone's share sheet.
 * Answers use the app's usual { success, data } envelope, like SiteJobs gets.
 * Every POST / PATCH takes an Idempotency-Key (the phone's offline queue resends).
 */
@ApiTags('integrations siteclock')
@Controller('integrations/siteclock/delivery')
@Public()
@UseGuards(SiteClockInboundGuard, SiteClockWorkerGuard)
export class SiteClockDeliveryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveriesService,
    private readonly reports: MaintenanceReportsService,
    private readonly posts: DeliveryGroupPostsService,
    private readonly uploads: UploadsService,
  ) {}

  private run(req: WorkerReq) {
    if (!req.siteclockJob) throw new NotFoundException('This job is not on your schedule.');
    return req.siteclockJob.deliveryId;
  }
  private org = (req: WorkerReq) => req.userOrganization.id;
  private me = (req: WorkerReq) => req.siteclockWorker.userId;
  /** The worker's name rides on the proof like SiteJobs' technicianName / riderName. */
  private named<T extends Record<string, any>>(req: WorkerReq, dto: T, key: 'technicianName' | 'riderName' = 'technicianName'): T {
    const name = req.siteclockWorker.name;
    return (name && !dto?.[key] ? { ...(dto ?? {}), [key]: name } : (dto ?? {})) as T;
  }

  /** A report the worker may touch: on this job's run (job routes), or on any run on their schedule / their own (pending sign). */
  private async ownReport(req: WorkerReq, reportId: string) {
    const r = await this.prisma.maintenanceServiceReport.findFirst({
      where: { id: reportId, organizationId: this.org(req) },
      select: { id: true, deliveryId: true, technicianUserId: true },
    });
    if (!r) throw new NotFoundException('Report not found');
    if (req.siteclockJob) {
      if (r.deliveryId !== req.siteclockJob.deliveryId) throw new NotFoundException('Report not found');
      return r;
    }
    if (r.technicianUserId === this.me(req)) return r;
    const runs = await this.workerRunIds(req);
    if (!r.deliveryId || !runs.includes(r.deliveryId)) throw new NotFoundException('Report not found');
    return r;
  }

  private async workerRunIds(req: WorkerReq): Promise<string[]> {
    const links = await this.prisma.deliverySiteClockJob.findMany({
      where: { organizationId: this.org(req), workerId: req.siteclockWorker.siteclockUserId, lastPushedStatus: { not: 'CANCELLED' } },
      select: { deliveryId: true },
    });
    return links.map((l) => l.deliveryId);
  }

  // ── the run ────────────────────────────────────────────────────────────────

  @Get('jobs/:ref')
  @ApiOperation({ summary: 'The run behind the job (GET /deliveries/:id), plus the org flags the field pages read and who the worker is.' })
  async getRun(@Req() req: WorkerReq) {
    const id = this.run(req);
    const org = this.org(req);
    const run: any = await this.deliveries.findById(id, org);
    if (run?.verificationState) run.verification = await this.deliveries.verificationOf(id, org);
    const jobFields = run?.id ? await this.deliveries.jobFieldsOf(id, org) : null;
    if (jobFields) run.jobFields = jobFields;
    const ui = await this.prisma.organizationUIConfig.findUnique({ where: { organizationId: org }, select: { features: true } });
    const features = (ui?.features as any) || {};
    return {
      run,
      features: Object.fromEntries(FIELD_FLAGS.map((k) => [k, features[k] === true])),
      worker: { userId: this.me(req), name: req.siteclockWorker.name },
    };
  }

  @Post('jobs/:ref/claim-return')
  @UseInterceptors(IdempotencyInterceptor)
  claimReturn(@Req() req: WorkerReq, @Body() body: { riderName?: string }) {
    return this.deliveries.claimReturn(this.run(req), this.named(req, body, 'riderName'), this.org(req), this.me(req));
  }

  // ── SiteClock's own flow (2026-11-10) ──────────────────────────────────────

  @Post('jobs/:ref/start')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      "SiteClock's one Start: starts every ticked line together and skips the rest. No condition photos per line (the app takes optional job photos at the end). A resend starts nothing twice: lines already started are left as they are.",
  })
  async startTicked(@Req() req: WorkerReq, @Body() body: { itemIds?: string[] }) {
    const deliveryId = this.run(req);
    const org = this.org(req);
    const ticked = new Set((Array.isArray(body?.itemIds) ? body.itemIds : []).map((x) => String(x)));
    if (!ticked.size) throw new BadRequestException('Tick at least one item to start.');
    const run = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId: org },
      select: {
        status: true,
        direction: true,
        items: { select: { id: true, assetId: true, inventoryId: true, description: true, deliveryStatus: true, skippedAt: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!run) throw new NotFoundException('Job not found');
    if (run.status === 'cancelled' || run.status === 'completed') throw new BadRequestException(`This job is ${run.status}.`);
    if ([...ticked].some((id) => !run.items.some((i) => i.id === id))) throw new BadRequestException('An item is no longer on this job. Pull down to refresh, then start again.');
    const waiting = run.items.filter((i) => i.deliveryStatus === 'not_delivered');
    const toStart = waiting.filter((i) => ticked.has(i.id));
    if (toStart.some((i) => !i.inventoryId && i.assetId)) {
      throw new BadRequestException('A ticked item still needs its unit scanned in the AIMS field app. Untick it to start the rest.');
    }
    const isReturn = run.direction === 'RETURN';
    // A RETURN still `scheduled` is claimed first, as on SiteJobs' run page.
    if (isReturn && run.status === 'scheduled') await this.deliveries.claimReturn(deliveryId, this.named(req, {}, 'riderName'), org, this.me(req));
    for (const it of toStart) {
      if (it.skippedAt) await this.deliveries.unskipItem(deliveryId, it.id, org);
      if (it.inventoryId) {
        await this.reports.create(
          this.named(req, {
            assetId: it.assetId,
            inventoryId: it.inventoryId,
            kind: 'DO_START',
            deliveryId,
            deferPhotos: true,
            description: isReturn ? 'Return started (SiteClock)' : 'Started in SiteClock',
          }) as any,
          org,
          this.me(req),
        );
      } else {
        await this.deliveries.startFreeTypedItem(deliveryId, it.id, this.named(req, {}), org, this.me(req), { photoGate: false });
      }
    }
    // Unticked = skipped ("not now"): the job stays open for them after the sign-off.
    const toSkip = waiting.filter((i) => !ticked.has(i.id) && !i.skippedAt);
    for (const it of toSkip) await this.deliveries.skipItem(deliveryId, it.id, org);
    (req as any).actionLogResult = { started: toStart.length, skipped: toSkip.length };
    return { started: toStart.length, skipped: toSkip.length };
  }

  @Post('jobs/:ref/not-finished')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: "\"Can't finish today\": the worker's reason goes on the job's Activity Log; the job stays open." })
  async notFinished(@Req() req: WorkerReq, @Body() body: { reason?: string }) {
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequestException("Say why the job can't be finished today.");
    const run = await this.prisma.delivery.findFirst({ where: { id: this.run(req), organizationId: this.org(req) }, select: { deliveryNumber: true, status: true } });
    if (!run) throw new NotFoundException('Job not found');
    if (run.status === 'completed' || run.status === 'cancelled') throw new BadRequestException(`This job is already ${run.status}.`);
    (req as any).actionLogResult = { reason: reason.slice(0, 500), deliveryNumber: run.deliveryNumber, jobStatus: run.status };
    return { logged: true, deliveryNumber: run.deliveryNumber };
  }

  // ── lines ──────────────────────────────────────────────────────────────────

  @Post('jobs/:ref/items/:itemId/start')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Start a line with no unit (free-typed / service): condition photos per its class, DO_START. Claims a scheduled run.' })
  startItem(@Req() req: WorkerReq, @Param('itemId') itemId: string, @Body() body: { photos?: string[]; angles?: string[]; technicianName?: string; latitude?: number; longitude?: number }) {
    return this.deliveries.startFreeTypedItem(this.run(req), itemId, this.named(req, body), this.org(req), this.me(req));
  }

  @Post('jobs/:ref/items/:itemId/end')
  @UseInterceptors(IdempotencyInterceptor)
  async endItem(@Req() req: WorkerReq, @Param('itemId') itemId: string, @Body() body: Record<string, any>) {
    await this.deliveries.assertNotHandedOff(this.run(req), this.org(req));
    return this.deliveries.endFreeTypedItem(this.run(req), itemId, this.named(req, body), this.org(req), this.me(req));
  }

  @Post('jobs/:ref/units/:inventoryId/start')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Start a unit already on the run (its line has the unit): DO_START with the condition photos (POST /maintenance-reports kind DO_START).' })
  async startUnit(@Req() req: WorkerReq, @Param('inventoryId') inventoryId: string, @Body() body: { photos?: string[]; angles?: string[]; photoDamaged?: boolean[]; photoComments?: string[]; latitude?: number; longitude?: number; description?: string }) {
    const deliveryId = this.run(req);
    const line = await this.prisma.deliveryItem.findFirst({ where: { deliveryId, inventoryId }, select: { assetId: true } });
    if (!line?.assetId) throw new BadRequestException('That unit is not on this job.');
    // A RETURN still `scheduled` is claimed before its first unit starts, as on SiteJobs' run page.
    const run = await this.prisma.delivery.findFirst({ where: { id: deliveryId, organizationId: this.org(req) }, select: { status: true, direction: true } });
    if (run?.direction === 'RETURN' && run.status === 'scheduled') await this.deliveries.claimReturn(deliveryId, this.named(req, {}, 'riderName'), this.org(req), this.me(req));
    return this.reports.create(
      this.named(req, {
        ...body,
        assetId: line.assetId,
        inventoryId,
        kind: 'DO_START',
        deliveryId,
        description: body.description || (run?.direction === 'RETURN' ? 'Return started' : 'Delivery started (added to run)'),
      }) as any,
      this.org(req),
      this.me(req),
    );
  }

  @Post('jobs/:ref/units/:inventoryId/deliver')
  @UseInterceptors(IdempotencyInterceptor)
  async deliverUnit(@Req() req: WorkerReq, @Param('inventoryId') inventoryId: string, @Body() body: Record<string, any>) {
    await this.deliveries.assertNotHandedOff(this.run(req), this.org(req));
    return this.deliveries.markUnitDelivered(this.run(req), inventoryId, this.named(req, body) as any, this.org(req), this.me(req));
  }

  @Post('jobs/:ref/units/:inventoryId/collect-return')
  @UseInterceptors(IdempotencyInterceptor)
  collectReturn(@Req() req: WorkerReq, @Param('inventoryId') inventoryId: string, @Body() body: Record<string, any>) {
    return this.deliveries.acknowledgeReturnUnit(this.run(req), inventoryId, this.named(req, body) as any, this.org(req), this.me(req));
  }

  @Post('jobs/:ref/items/photos')
  @UseInterceptors(IdempotencyInterceptor)
  addPhotos(@Req() req: WorkerReq, @Body() body: { inventoryId?: string; photos?: string[] }) {
    return this.deliveries.addItemPhotos(this.run(req), { inventoryId: body?.inventoryId as any, photos: body?.photos ?? [] }, this.org(req));
  }

  @Post('jobs/:ref/items/:itemId/skip')
  @UseInterceptors(IdempotencyInterceptor)
  skip(@Req() req: WorkerReq, @Param('itemId') itemId: string) {
    return this.deliveries.skipItem(this.run(req), itemId, this.org(req));
  }

  @Post('jobs/:ref/items/:itemId/unskip')
  @UseInterceptors(IdempotencyInterceptor)
  unskip(@Req() req: WorkerReq, @Param('itemId') itemId: string) {
    return this.deliveries.unskipItem(this.run(req), itemId, this.org(req));
  }

  @Post('jobs/:ref/ack-all')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'End every delivering line (outbound: delivered; return: collected), no signature.' })
  async ackAll(@Req() req: WorkerReq, @Body() body: Record<string, any>) {
    await this.deliveries.assertNotHandedOff(this.run(req), this.org(req));
    return this.deliveries.acknowledgeAll(this.run(req), this.named(req, body) as any, this.org(req), this.me(req));
  }

  // ── who's delivering ───────────────────────────────────────────────────────

  @Post('jobs/:ref/handoff')
  @UseInterceptors(IdempotencyInterceptor)
  handoff(@Req() req: WorkerReq, @Body() body: { mode?: string; vehicleNumber?: string; itemIds?: string[] }) {
    // No baseUrl from the phone: the driver link uses the portal's own origin (PORTAL_URL).
    return this.deliveries.handoffTrip(this.run(req), { mode: body?.mode, vehicleNumber: body?.vehicleNumber, itemIds: body?.itemIds }, this.org(req), this.me(req));
  }

  @Get('jobs/:ref/handoff/current')
  getHandoff(@Req() req: WorkerReq) {
    return this.deliveries.getHandoff(this.run(req), this.org(req), null);
  }

  @Get('jobs/:ref/handoff/status')
  getHandoffStatus(@Req() req: WorkerReq) {
    return this.deliveries.getHandoffStatus(this.run(req), this.org(req));
  }

  // ── sign-off ───────────────────────────────────────────────────────────────

  @Post('jobs/:ref/finalize')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Customer sign-off (full, or partial for what is handed over), or a WCT finish mode. Completes the run as SiteJobs does.' })
  async finalize(@Req() req: WorkerReq, @Body() body: Record<string, any>) {
    await this.deliveries.assertNotHandedOff(this.run(req), this.org(req));
    return this.deliveries.finalizeRun(this.run(req), this.named(req, body) as any, this.org(req), this.me(req), { allowPartial: true });
  }

  @Post('jobs/:ref/finalize-return')
  @UseInterceptors(IdempotencyInterceptor)
  finalizeReturn(@Req() req: WorkerReq, @Body() body: Record<string, any>) {
    return this.deliveries.finalizeReturn(this.run(req), this.named(req, body) as any, this.org(req));
  }

  // ── the DO ─────────────────────────────────────────────────────────────────

  private async runDo(req: WorkerReq, doId: string) {
    const onRun = await this.prisma.deliveryItem.findFirst({ where: { deliveryId: this.run(req), documentId: doId }, select: { id: true } });
    if (!onRun) throw new NotFoundException('That delivery order is not on this job.');
  }

  @Get('jobs/:ref/do/:doId/view')
  @ApiOperation({ summary: 'The DO as the field "View DO" page reads it (GET /maintenance-reports/do-view/:doId).' })
  async doView(@Req() req: WorkerReq, @Param('doId') doId: string) {
    await this.runDo(req, doId);
    return this.reports.getDoView(doId, this.org(req));
  }

  @Get('jobs/:ref/do/:doId/pdf')
  @ApiOperation({ summary: 'The DO PDF, the same file the WhatsApp group post attaches (for Save / Share).' })
  async doPdf(@Req() req: WorkerReq, @Param('doId') doId: string, @Res() res: Response) {
    await this.runDo(req, doId);
    const { buffer, fileName } = await this.posts.renderSignedDo(this.org(req), doId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
    res.send(buffer);
  }

  // ── service report (WCT service jobs) ──────────────────────────────────────

  @Post('jobs/:ref/reports')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'A SERVICE report on this job (POST /maintenance-reports, deliveryId forced to the run).' })
  createReport(@Req() req: WorkerReq, @Body() body: Record<string, any>) {
    if (body?.kind && body.kind !== 'SERVICE') throw new BadRequestException('Only a service report can be created here.');
    return this.reports.create(this.named(req, { ...body, kind: 'SERVICE', deliveryId: this.run(req) }) as any, this.org(req), this.me(req));
  }

  @Get('jobs/:ref/reports/:reportId')
  async getReport(@Req() req: WorkerReq, @Param('reportId') reportId: string) {
    await this.ownReport(req, reportId);
    return this.reports.findById(reportId, this.org(req));
  }

  @Get('jobs/:ref/reports/:reportId/pdf')
  @ApiOperation({ summary: "The service report PDF, the file emailed to the customer (the field page's Print report / Download PDF)." })
  async reportPdf(@Req() req: WorkerReq, @Param('reportId') reportId: string, @Res() res: Response) {
    await this.ownReport(req, reportId);
    const { buffer, filename } = await this.reports.getReportPdf(reportId, this.org(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${String(filename).replace(/"/g, '')}"`);
    res.send(buffer);
  }

  @Patch('jobs/:ref/reports/:reportId/draft')
  @UseInterceptors(IdempotencyInterceptor)
  async saveDraft(@Req() req: WorkerReq, @Param('reportId') reportId: string, @Body() body: { draft?: Record<string, any> }) {
    await this.ownReport(req, reportId);
    return this.reports.saveDraft(reportId, body?.draft ?? {}, this.org(req));
  }

  @Post('jobs/:ref/reports/:reportId/complete')
  @UseInterceptors(IdempotencyInterceptor)
  async completeReport(@Req() req: WorkerReq, @Param('reportId') reportId: string, @Body() body: Record<string, any>) {
    await this.ownReport(req, reportId);
    return this.reports.completeScheduled(reportId, this.named(req, body ?? {}), this.org(req), this.me(req));
  }

  // ── pending sign (reports waiting for the customer's signature) ────────────

  @Get('pending-sign')
  @ApiOperation({ summary: "Service reports awaiting a signature on the worker's jobs or written by them (the field app's Pending Sign list)." })
  async pendingSign(@Req() req: WorkerReq) {
    const page = await this.reports.findAllService(this.org(req), 1, 100, undefined, 'draft');
    const runs = new Set(await this.workerRunIds(req));
    const docs = (page.docs as any[]).filter((d) => d.technicianUserId === this.me(req) || (d.deliveryId && runs.has(d.deliveryId)));
    return { ...page, docs, total: docs.length, hasNextPage: false };
  }

  @Get('reports/:reportId')
  async getPendingReport(@Req() req: WorkerReq, @Param('reportId') reportId: string) {
    await this.ownReport(req, reportId);
    return this.reports.findById(reportId, this.org(req));
  }

  @Post('reports/:reportId/sign')
  @UseInterceptors(IdempotencyInterceptor)
  async signReport(@Req() req: WorkerReq, @Param('reportId') reportId: string, @Body() body: Record<string, any>) {
    await this.ownReport(req, reportId);
    return this.reports.sign(reportId, body as any, this.org(req));
  }

  // ── photos ─────────────────────────────────────────────────────────────────

  @Post('uploads/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }), IdempotencyInterceptor)
  @ApiOperation({ summary: 'Store a photo (multipart file + folder) and return its key, as POST /uploads/image does for SiteJobs.' })
  async uploadImage(@UploadedFile() file: Express.Multer.File, @Body() body: { folder?: string }, @Query('folder') folderQ?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded');
    const folder = String(body?.folder ?? folderQ ?? '').trim();
    if (!UPLOAD_FOLDERS.has(folder)) throw new BadRequestException(`folder must be one of ${[...UPLOAD_FOLDERS].join(', ')}`);
    const ext = IMAGE_EXT[file.mimetype];
    if (!ext) throw new BadRequestException('Only JPEG, PNG, WebP or HEIC photos');
    const key = `${folder}/${randomBytes(4).toString('hex')}.${ext}`;
    return { Key: await this.uploads.uploadFileInChunks({ file, key }) };
  }
}
