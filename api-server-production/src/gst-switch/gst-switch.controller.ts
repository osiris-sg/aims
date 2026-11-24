import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { GstSwitchService } from './gst-switch.service';

/** GST switch with company move (WCT group, 2026-11-24; gst-switch.service.ts). */
@Controller('gst-switch')
@UseGuards(ClerkAuthGuard)
export class GstSwitchController {
  constructor(private readonly svc: GstSwitchService) {}

  private org(req: any): string {
    const id = req.userOrganization?.id;
    if (!id) throw new HttpException('User is not assigned to any organization', HttpStatus.FORBIDDEN);
    return id;
  }

  /** A document moved out of this company by the switch: where it went (and, with access there, its link). */
  @Get('where/:documentId')
  @Permissions('documents:read')
  where(@Param('documentId') id: string, @Req() req: any) {
    return this.svc.whereMoved(id, this.org(req), { userId: req.user?.id ?? null, isAdmin: !!req.isOsirisAdmin });
  }

  @Get(':invoiceId')
  @Permissions('documents:read')
  state(@Param('invoiceId') id: string, @Req() req: any) {
    return this.svc.state(id, this.org(req));
  }

  @Get(':invoiceId/preview')
  @Permissions('documents:update')
  preview(@Param('invoiceId') id: string, @Query('gst') gst: string, @Req() req: any) {
    return this.svc.preview(id, this.org(req), gst === 'true' || gst === '1');
  }

  @Post(':invoiceId/move')
  @Permissions('documents:update')
  async move(@Param('invoiceId') id: string, @Body() body: { gst?: boolean }, @Req() req: any) {
    if (typeof body?.gst !== 'boolean') throw new HttpException('Say gst: true or false', HttpStatus.BAD_REQUEST);
    const u: any = req.user || {};
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    const out = await this.svc.move(id, this.org(req), body.gst, { id: u.id, name: name || undefined, email: u.emailAddresses?.[0]?.emailAddress, isAdmin: !!req.isOsirisAdmin });
    req.actionLogResult = { moved: out.moved, to: (out as any).to?.name, renamed: ((out as any).renamed ?? []).map((r: any) => `${r.from} > ${r.to}`), creditNotes: (out as any).creditNotes };
    return out;
  }
}
