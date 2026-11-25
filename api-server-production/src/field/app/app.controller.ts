import { Body, Controller, Delete, Get, Header, Param, Post, Query, Req, Res, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { Public } from '../../decorators/public.decorator';
import { fieldAudit } from '../common/field-audit';
import { App, AppCtx, FieldAppGuard } from './app-context';
import { FieldAppService, MAX_LEAVE_DOCUMENTS, type Upload } from './app.service';

const MAX_BYTES = 8 * 1024 * 1024;
const image = { limits: { fileSize: MAX_BYTES, files: 1 }, fileFilter: (_r: any, f: any, cb: any) => cb(null, String(f.mimetype).startsWith('image/')) };
const imageOrPdf = { limits: { fileSize: MAX_BYTES, files: MAX_LEAVE_DOCUMENTS }, fileFilter: (_r: any, f: any, cb: any) => cb(null, String(f.mimetype).startsWith('image/') || f.mimetype === 'application/pdf') };

function sendBytes(res: Response, file: { buffer: Buffer; contentType: string }) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(file.buffer);
}

/** Build numbers the app checks itself against (FIELD_APP_* env; 0 = no forced update). No sign-in needed. */
@ApiTags('field-app')
@Controller('field/app')
export class FieldAppVersionController {
  @Public()
  @Get('app-version')
  version(@Query('platform') platform?: string) {
    const n = (k: string) => Number(process.env[k] || 0) || 0;
    const a = { latest: n('FIELD_APP_LATEST_BUILD_ANDROID'), min: n('FIELD_APP_MIN_BUILD_ANDROID') };
    const i = { latest: n('FIELD_APP_LATEST_BUILD_IOS'), min: n('FIELD_APP_MIN_BUILD_IOS') };
    const pick = platform === 'android' ? a : platform === 'ios' ? i : { latest: Math.min(a.latest, i.latest), min: Math.min(a.min, i.min) };
    return { latestBuild: pick.latest, minBuild: pick.min, androidUrl: process.env.FIELD_APP_ANDROID_URL || null, iosUrl: process.env.FIELD_APP_IOS_URL || null, latestBuildAndroid: a.latest, latestBuildIos: i.latest };
  }
}

/**
 * The AIMS phone app's worker side (HR). Signed in with the person's own AIMS login (Clerk phone code); the
 * guard needs the HR module on for the org and the login to be one of its workers.
 */
@ApiTags('field-app')
@ApiBearerAuth()
@Controller('field/app')
@UseGuards(ClerkAuthGuard, FieldAppGuard)
export class FieldAppController {
  constructor(private readonly svc: FieldAppService) {}

  // ── Me ──
  @Get('auth/me')
  @Header('Cache-Control', 'no-store')
  me(@App() ctx: AppCtx) {
    return this.svc.me(ctx);
  }

  @Post('auth/device')
  async device(@App() ctx: AppCtx, @Body() body: any, @Req() req: any) {
    const { audit, ...out } = await this.svc.device(ctx, body);
    if (audit) fieldAudit(req, audit.action, { entity: 'Worker', entityId: ctx.worker.id, before: audit.before, after: audit.after });
    return out;
  }

  @Post('auth/fcm-token')
  fcm(@App() ctx: AppCtx, @Body() body: any) {
    return this.svc.fcmToken(ctx, body);
  }

  @Delete('auth/account')
  forget(@App() ctx: AppCtx, @Req() req: any) {
    fieldAudit(req, 'DEVICE_UNLINK', { entity: 'Worker', entityId: ctx.worker.id });
    return this.svc.forgetDevice(ctx);
  }

  // ── Terms ──
  @Get('terms')
  terms(@App() ctx: AppCtx) {
    return this.svc.terms(ctx);
  }

  @Post('terms/accept')
  async acceptTerms(@App() ctx: AppCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.acceptTerms(ctx, body);
    fieldAudit(req, 'TERMS_ACCEPT', { entity: 'Worker', entityId: ctx.worker.id, after: { version: out.version, acceptedAt: out.acceptedAt } });
    return out;
  }

  // ── Clock in / out ──
  @Post('punches')
  @UseInterceptors(FileInterceptor('photo', image))
  async punch(@App() ctx: AppCtx, @Body() body: any, @UploadedFile() file: Upload | undefined, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.svc.punch(ctx, body, file);
    res.status(out.status);
    const p: any = out.body.punch;
    fieldAudit(req, p.type === 'IN' ? 'PUNCH_IN' : 'PUNCH_OUT', { entity: 'Punch', entityId: p.id, after: { siteId: p.siteId, status: p.status, flagReason: p.flagReason, jobId: p.jobId, duplicate: 'duplicate' in out.body } });
    return out.body;
  }

  @Post('punches/group')
  @UseInterceptors(FileInterceptor('photo', image))
  async punchGroup(@App() ctx: AppCtx, @Body() body: any, @UploadedFile() file: Upload | undefined, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const out = await this.svc.punchGroup(ctx, body, file);
    res.status(out.status);
    fieldAudit(req, 'PUNCH_GROUP', { entity: 'Job', entityId: out.audit.jobId, after: out.audit });
    return out.body;
  }

  @Get('punches/mine')
  @Header('Cache-Control', 'no-store')
  punchesMine(@App() ctx: AppCtx) {
    return this.svc.punchesMine(ctx);
  }

  @Get('punches/:id/photo')
  async punchPhoto(@App() ctx: AppCtx, @Param('id') id: string, @Res() res: Response) {
    sendBytes(res, await this.svc.punchPhoto(ctx, id));
  }

  // ── My hours ──
  @Get('timesheets/mine')
  @Header('Cache-Control', 'no-store')
  timesheetsMine(@App() ctx: AppCtx) {
    return this.svc.timesheetsMine(ctx);
  }

  @Post('timesheets/missed-request')
  async missed(@App() ctx: AppCtx, @Body() body: any, @Req() req: any) {
    const out = await this.svc.missedRequest(ctx, body);
    fieldAudit(req, 'ENTRY_MISSED_REQUEST', { entity: 'TimeEntry', entityId: out.entry.id, after: out.entry });
    return out;
  }

  @Get('schedules/mine')
  scheduleMine(@App() ctx: AppCtx, @Query('siteId') siteId?: string) {
    return this.svc.scheduleMine(ctx, siteId);
  }

  // ── Leave ──
  @Get('leave/types')
  leaveTypes(@App() ctx: AppCtx) {
    return this.svc.leaveTypes(ctx);
  }

  @Get('leave/balances/mine')
  leaveBalances(@App() ctx: AppCtx, @Query('year') year?: string) {
    return this.svc.leaveBalances(ctx, year);
  }

  @Get('leave/requests/mine')
  @Header('Cache-Control', 'no-store')
  leaveMine(@App() ctx: AppCtx) {
    return this.svc.leaveMine(ctx);
  }

  @Post('leave/requests')
  @UseInterceptors(FilesInterceptor('document', MAX_LEAVE_DOCUMENTS, imageOrPdf))
  async leaveRequest(@App() ctx: AppCtx, @Body() body: any, @UploadedFiles() files: Upload[] | undefined, @Req() req: any) {
    const out = await this.svc.leaveRequest(ctx, body, files ?? []);
    fieldAudit(req, 'LEAVE_REQUEST', { entity: 'LeaveRequest', entityId: out.request.id, after: { typeId: out.request.typeId, startDate: out.request.startDate, endDate: out.request.endDate, halfDay: out.request.halfDay } });
    return out;
  }

  @Post('leave/requests/:id/cancel')
  async leaveCancel(@App() ctx: AppCtx, @Param('id') id: string, @Req() req: any) {
    const { before, ...out } = await this.svc.leaveCancel(ctx, id);
    fieldAudit(req, 'LEAVE_CANCELLED_BY_WORKER', { entity: 'LeaveRequest', entityId: id, before, after: { status: 'CANCELLED' } });
    return out;
  }

  @Get('leave/requests/:id/document')
  async leaveDocument0(@App() ctx: AppCtx, @Param('id') id: string, @Res() res: Response) {
    sendBytes(res, await this.svc.leaveDocument(ctx, id, 0));
  }

  @Get('leave/requests/:id/documents/:n')
  async leaveDocument(@App() ctx: AppCtx, @Param('id') id: string, @Param('n') n: string, @Res() res: Response) {
    sendBytes(res, await this.svc.leaveDocument(ctx, id, Number(n)));
  }

  // ── Photo on record ──
  @Get('photos/mine')
  @Header('Cache-Control', 'no-store')
  photoMine(@App() ctx: AppCtx) {
    return this.svc.photoMine(ctx);
  }

  @Get('photos/mine/current')
  async photoCurrent(@App() ctx: AppCtx, @Res() res: Response) {
    sendBytes(res, await this.svc.photoCurrent(ctx));
  }

  @Get('photos/mine/pending')
  async photoPending(@App() ctx: AppCtx, @Res() res: Response) {
    sendBytes(res, await this.svc.photoPending(ctx));
  }

  @Post('photos/mine')
  @UseInterceptors(FileInterceptor('photo', image))
  async photoSubmit(@App() ctx: AppCtx, @UploadedFile() file: Upload | undefined, @Req() req: any) {
    const out = await this.svc.photoSubmit(ctx, file);
    fieldAudit(req, 'PHOTO_SUBMIT', { entity: 'Worker', entityId: ctx.worker.id, after: { photoUpdateId: out.photoUpdateId } });
    return out.status;
  }

  @Delete('photos/mine')
  photoWithdraw(@App() ctx: AppCtx) {
    return this.svc.photoWithdraw(ctx);
  }

  // ── My payslip, my jobs ──
  @Get('payroll/me')
  @Header('Cache-Control', 'no-store')
  payslip(@App() ctx: AppCtx, @Query('month') month?: string) {
    return this.svc.payslip(ctx, month);
  }

  @Get('jobs/mine')
  @Header('Cache-Control', 'no-store')
  jobsMine(@App() ctx: AppCtx, @Query() q: any) {
    return this.svc.jobsMine(ctx, q);
  }
}
