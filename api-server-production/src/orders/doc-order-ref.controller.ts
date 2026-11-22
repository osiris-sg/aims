import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { DocOrderRefService } from './doc-order-ref.service';
import { DocLinksService } from './doc-links.service';

/**
 * Reference = order link (round 39, WCT group, enableWctOrders; doc-order-ref.service.ts). Own prefix so no
 * /orders/:id route can swallow these paths. Activity Log: POST .../link = LINK, .../unlink = UNLINK (VERB_ACTIONS),
 * each with what was linked to which order in the result.
 */
@Controller('order-refs')
@UseGuards(ClerkAuthGuard)
export class DocOrderRefController {
  constructor(
    private readonly refs: DocOrderRefService,
    private readonly links: DocLinksService,
  ) {}

  private orgId(req: any): string {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return orgId;
  }

  private actor(req: any) {
    const u: any = req?.user || {};
    return { id: u.id ?? null, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.emailAddresses?.[0]?.emailAddress || u.email || null };
  }

  @Get('options')
  @Permissions('documents:read')
  options(@Req() req: any, @Query('q') q?: string, @Query('customerId') customerId?: string, @Query('all') all?: string) {
    return this.refs.options(this.orgId(req), { q, customerId, all });
  }

  @Get('doc/:documentId')
  @Permissions('documents:read')
  docLink(@Param('documentId') documentId: string, @Req() req: any) {
    return this.refs.docLink(this.orgId(req), documentId);
  }

  // Link Document (2026-11-22, doc-links.service.ts): the picker's tab, the row's pills, link / unlink, the doc chain.
  @Get('picker')
  @Permissions('documents:read')
  picker(@Req() req: any, @Query('documentId') documentId?: string, @Query('kind') kind?: string, @Query('q') q?: string) {
    return this.links.picker(this.orgId(req), { documentId, kind, q });
  }

  @Get('links/:documentId')
  @Permissions('documents:read')
  docLinks(@Param('documentId') documentId: string, @Req() req: any) {
    return this.links.links(this.orgId(req), documentId);
  }

  @Get('chain/:documentId')
  @Permissions('documents:read')
  chain(@Param('documentId') documentId: string, @Req() req: any) {
    return this.links.chain(this.orgId(req), documentId, { userId: req.user?.id ?? null, isAdmin: !!req.isOsirisAdmin });
  }

  // Activity Log: link-document = LINK, unlink-document = UNLINK (VERB_ACTIONS), with what was linked in the result.
  @Post('link-document')
  @Permissions('documents:update')
  async linkDocument(@Body() body: any, @Req() req: any) {
    const out: any = await this.links.link(this.orgId(req), body || {}, this.actor(req));
    req.actionLogResult = { linked: out.docName, to: out.mode === 'order' ? out.orderNumber : out.targetName, via: out.mode === 'order' && out.targetName !== out.orderNumber ? out.targetName : null, direct: out.mode === 'direct', ...(out.createdOrder ? { createdOrder: true } : {}), ...(out.already ? { already: true } : {}) };
    return out;
  }

  @Post('unlink-document')
  @Permissions('documents:update')
  async unlinkDocument(@Body() body: any, @Req() req: any) {
    const out: any = await this.links.unlink(this.orgId(req), body || {}, this.actor(req));
    req.actionLogResult = { unlinked: out.docName, from: out.mode === 'order' ? out.orderNumber : out.targetName, direct: out.mode === 'direct' };
    return out;
  }

  @Get('remaining-lines/:orderId')
  @Permissions('documents:read')
  remainingLines(@Param('orderId') orderId: string, @Req() req: any) {
    return this.refs.remainingLines(this.orgId(req), orderId);
  }

  @Post('link')
  @Permissions('documents:update')
  async link(@Body() body: any, @Req() req: any) {
    const out: any = await this.refs.link(this.orgId(req), body || {}, this.actor(req));
    req.actionLogResult = { linked: `${out.kind === 'INVOICE' ? 'Invoice' : 'DO'} ${out.docName ?? ''}`.trim(), order: out.orderNumber, quotation: out.quotationName ?? null, createdOrder: !!out.createdOrder, ...(out.already ? { already: true } : {}) };
    return out;
  }

  @Post('unlink')
  @Permissions('documents:update')
  async unlink(@Body() body: any, @Req() req: any) {
    const out: any = await this.refs.unlink(this.orgId(req), body || {}, this.actor(req));
    req.actionLogResult = { unlinked: `${out.kind === 'INVOICE' ? 'Invoice' : 'DO'} ${out.docName ?? ''}`.trim(), order: out.orderNumber };
    return out;
  }
}
