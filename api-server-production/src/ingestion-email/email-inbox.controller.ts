import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { EmailTriageService, InboxState } from './email-triage.service';

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
  constructor(private readonly triage: EmailTriageService) {}

  private org(req: Req2) {
    const id = req.userOrganization?.id;
    if (!id) throw new BadRequestException('No organization');
    return id;
  }
  private actor(req: Req2) {
    const u = req.user;
    return { id: u?.id ?? null, name: [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.emailAddresses?.[0]?.emailAddress || null };
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
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() body: { orderId?: string | null; shipmentId?: string | null }, @Req() req: Req2) {
    return this.triage.assign(this.org(req), id, body ?? {});
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
    return this.triage.dismiss(this.org(req), id);
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
