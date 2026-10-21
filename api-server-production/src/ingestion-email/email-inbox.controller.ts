import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { EmailTriageService, InboxState, IntakeTarget } from './email-triage.service';
import { StoredEmailMeta } from './email-store';
import { S3Service } from '../common/services/s3.service';
import { TradeExtractService } from '../shipments/trade-extract.service';

interface Req2 extends Request {
  userOrganization?: { id: string; name: string };
  user?: { id?: string; firstName?: string | null; lastName?: string | null; emailAddresses?: { emailAddress: string }[] };
}

const TABS: InboxState[] = ['SUGGESTED', 'UNMATCHED', 'PROCESSED', 'UNSURE'];

/**
 * Shipments → Inbox: the triaged intake emails. Suggested (TRIAGE mode plans
 * waiting to be accepted), Unmatched (no / ambiguous order or shipment —
 * assign by hand), Processed (done — Undo), Unsure (review within 14 days,
 * then purged). Not-shipment mail is purged at triage and never listed.
 */
@ApiTags('email-inbox')
@ApiBearerAuth()
@Controller('email-inbox')
@UseGuards(ClerkAuthGuard)
export class EmailInboxController {
  constructor(
    private readonly triage: EmailTriageService,
    private readonly s3: S3Service,
    private readonly extract: TradeExtractService,
  ) {}

  private org(req: Req2) {
    const id = req.userOrganization?.id;
    if (!id) throw new BadRequestException('No organization');
    return id;
  }
  private actor(req: Req2) {
    const u = req.user;
    return { id: u?.id ?? null, name: [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.emailAddresses?.[0]?.emailAddress || null };
  }

  @Get('filter-preview')
  @Permissions('shipments:read')
  @ApiOperation({ summary: "Sender filter preview: what the filter kept / would drop in the last N days (from-domain + subject only)." })
  filterPreview(@Query('days') days: string | undefined, @Req() req: Req2) {
    const n = Number(days);
    return this.triage.filterPreview(this.org(req), Number.isInteger(n) && n > 0 && n <= 90 ? n : 30);
  }

  @Get('stats')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Accept-rate over the last N days (default 30): accepted as-is, changed, rejected, ignored, auto-applied.' })
  stats(@Query('days') days: string | undefined, @Req() req: Req2) {
    const n = Number(days);
    return this.triage.stats(this.org(req), Number.isInteger(n) && n > 0 && n <= 365 ? n : 30);
  }

  @Get(':id/message')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Round T: the whole email (headers, text, defused HTML, attachments with download URLs) — the portal email view' })
  message(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.message(this.org(req), id);
  }

  @Get(':id/thread')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Round T: the thread of an email, oldest → newest' })
  thread(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.thread(this.org(req), id);
  }

  @Get(':id/attachments/:index/url')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Round T: a 1-hour download URL for one stored attachment' })
  attachmentUrl(@Param('id', ParseUUIDPipe) id: string, @Param('index') index: string, @Req() req: Req2) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0) throw new BadRequestException('index must be a whole number');
    return this.triage.attachmentUrl(this.org(req), id, i);
  }

  @Post(':id/preview')
  @Permissions('shipments:read')
  @ApiOperation({ summary: '"Change order…" preview: what choosing these orders / shipments would file and fill (nothing is saved).' })
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() body: { targets?: IntakeTarget[] }, @Req() req: Req2) {
    const t = cleanAssign(body ?? {}).targets;
    if (!t?.length) throw new BadRequestException('Pick at least one order or shipment');
    return this.triage.preview(this.org(req), id, t);
  }

  @Post(':id/ignore')
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Ignore: keep the email, mark it handled (Processed), file nothing.' })
  ignore(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.ignore(this.org(req), id, this.actor(req));
  }

  @Get('hidden')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Round Q: emails hidden as obvious non-shipment mail (calendar / auto-reply / newsletter) — from-domain + subject 60 only.' })
  hidden(@Req() req: Req2) {
    return this.triage.hidden(this.org(req));
  }

  @Post(':id/unhide')
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Round Q: bring a hidden email back to the inbox (matched again, never auto-applied).' })
  unhide(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.unhide(this.org(req), id);
  }

  @Post('backlog')
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Round Q: classify every unprocessed email (dry run unless apply=true): hide / auto-link / history / no order / confirm / pick. Never files a document.' })
  backlog(@Query('apply') apply: string | undefined, @Req() req: Req2) {
    return this.triage.backlog(this.org(req), apply === 'true');
  }

  @Post(':id/pi-prefill')
  @Permissions('shipments:create')
  @ApiOperation({ summary: 'Round Q: "Create order from this thread" — read the email\'s PI attachment with the PI extractor (the same as "New orders from PIs"); the order form starts from it.' })
  async piPrefill(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    const org = this.org(req);
    const row = await this.triage.row(org, id);
    const pi = row.attachments.find((a) => a.docType === 'PI') ?? row.attachments.find((a) => /\bPI\b|_PI_|proforma/i.test(a.name) && /\.pdf$/i.test(a.name));
    if (!pi) throw new BadRequestException('This email has no PI attachment');
    const meta = ((await this.triage.rawMeta(org, id)) ?? {}) as Partial<StoredEmailMeta>;
    const att = meta.attachments?.[pi.index];
    if (!att) throw new BadRequestException('The PI attachment is no longer stored');
    const buf = await this.s3.downloadFile(att.key);
    return this.extract.extract(org, 'PI', { file: { originalname: att.name, mimetype: att.contentType || 'application/pdf', size: buf.length, buffer: buf } as Express.Multer.File }, this.actor(req) as any);
  }

  @Get('threads')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Round P: the inbox as threads — UNPROCESSED (to confirm, with the reason) or PROCESSED (done, with who / when). Message-ID chain, else the subject.' })
  threads(@Query('tab') tab: string | undefined, @Req() req: Req2) {
    return this.triage.threads(this.org(req), tab === 'PROCESSED' ? 'PROCESSED' : 'UNPROCESSED');
  }

  @Get('dashboard')
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Round P: the Sales dashboard — emails to confirm (newest threads) and what was filed by itself in the last 3 days.' })
  dashboard(@Req() req: Req2) {
    return this.triage.dashboard(this.org(req));
  }

  @Get()
  @Permissions('shipments:read')
  @ApiOperation({ summary: 'Triaged intake emails for one inbox tab (SUGGESTED | UNMATCHED | PROCESSED | UNSURE), with tab counts.' })
  list(@Query('tab') tab: string | undefined, @Req() req: Req2) {
    const t = (TABS.includes(tab as InboxState) ? tab : 'SUGGESTED') as InboxState;
    return this.triage.inbox(this.org(req), t);
  }

  @Post(':id/accept')
  @Permissions('shipments:update')
  @ApiOperation({ summary: "Do a suggested email's plan: attach its files, fill empty fields, tick sent sub-tasks." })
  accept(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.accept(this.org(req), id, this.actor(req));
  }

  @Post(':id/assign')
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Match an email to an order or shipment by hand, then plan it (AUTO mode also does it).' })
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() body: { orderId?: string | null; shipmentId?: string | null; targets?: IntakeTarget[]; accept?: boolean }, @Req() req: Req2) {
    return this.triage.assign(this.org(req), id, cleanAssign(body), this.actor(req));
  }

  @Post(':id/undo')
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Undo what an email did: remove its files (reopening the steps they completed), clear its fields, untick its sub-tasks.' })
  undo(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.undo(this.org(req), id, this.actor(req));
  }

  @Get(':id/pi-table-plan')
  @Permissions('shipments:read')
  @ApiOperation({ summary: "Vedanta's PI table: the order each row would fill and the blank PI fields (read-only)." })
  piTable(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.piTablePlan(this.org(req), id);
  }

  @Post(':id/pi-table')
  @Permissions('shipments:update')
  @ApiOperation({ summary: "Vedanta's PI table: fill the PI fields on the month's matching orders (attach each PI to step 1)." })
  applyPiTable(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.applyPiTable(this.org(req), id, this.actor(req));
  }

  @Post(':id/dismiss')
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Not shipment mail: delete the stored email and attachments now (a hashed Message-ID is kept).' })
  dismiss(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    return this.triage.dismiss(this.org(req), id, this.actor(req));
  }

  @Post(':id/retriage')
  @Permissions('shipments:update')
  @ApiOperation({ summary: 'Run the AI triage again on a stored email (not on one that did something — undo first).' })
  async retriage(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req2) {
    const org = this.org(req);
    const row = await this.triage.row(org, id);
    if (row.canUndo) throw new BadRequestException('Undo what this email did first');
    await this.triage.triage(org, id);
    return this.triage.row(org, id);
  }
}

const UUID = /^[0-9a-f-]{36}$/i;
/** Assign / preview body: ids validated, at most 10 targets, attachment indexes as small integers. */
function cleanAssign(body: { orderId?: unknown; shipmentId?: unknown; targets?: unknown; accept?: unknown }): { orderId?: string | null; shipmentId?: string | null; targets?: IntakeTarget[]; accept?: boolean } {
  const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
  const targets = Array.isArray(body.targets)
    ? body.targets.slice(0, 10).map((t: any) => ({
        orderId: id(t?.orderId),
        shipmentId: id(t?.shipmentId),
        ...(Array.isArray(t?.attachmentIndexes) ? { attachmentIndexes: t.attachmentIndexes.filter((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < 100) } : {}),
      }))
    : undefined;
  if (targets?.some((t) => !t.orderId && !t.shipmentId)) throw new BadRequestException('Each target needs an order or a shipment');
  return { orderId: id(body.orderId), shipmentId: id(body.shipmentId), ...(targets ? { targets } : {}), accept: body.accept === true };
}
