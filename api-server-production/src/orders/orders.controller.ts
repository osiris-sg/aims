import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
}

@Controller('orders')
@UseGuards(ClerkAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Permissions('orders:read')
  async list(@Req() req: RequestWithOrganization) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.list(orgId);
  }

  /**
   * Mint a short-lived signed S3 URL for an uploaded supplier doc (DO/Invoice),
   * so the order page can offer a download even though the bucket is private.
   * Declared BEFORE @Get(':id') so Nest doesn't match the literal path segment
   * "supplier-doc-url" as an order id and bomb on Prisma UUID parsing (P2023).
   */
  @Get('supplier-doc-url')
  @Permissions('orders:read')
  async getSupplierDocUrl(
    @Req() req: RequestWithOrganization,
  ) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    const key = (req.query?.key as string) || '';
    return this.ordersService.getSupplierDocDownloadUrl(orgId, key);
  }

  @Get(':id')
  @Permissions('orders:read')
  async getById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.getById(id, orgId);
  }

  // WCT service report on the order (enableWctOrders): the reports the order
  // page offers to link (the order's own first; ?number= finds any by number).
  @Get(':id/report-options')
  @Permissions('orders:read')
  async reportOptions(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.orderReportOptions(id, orgId, (req.query?.number as string) || undefined);
  }

  // WCT: attach an uploaded file (POST /uploads/image first) or link a service report.
  @Post(':id/attachments')
  @Permissions('documents:update')
  async addAttachment(
    @Param('id') id: string,
    @Body() body: { kind?: string; fileKey?: string; fileName?: string; mimeType?: string; label?: string; reportId?: string },
    @Req() req: RequestWithOrganization,
  ) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.addOrderAttachment(id, orgId, body || {}, actorOf(req));
  }

  @Post(':id/attachments/remove')
  @Permissions('documents:update')
  async removeAttachment(@Param('id') id: string, @Body() body: { id: string }, @Req() req: RequestWithOrganization) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.removeOrderAttachment(id, orgId, body?.id);
  }

  // WCT orders hub (2026-11-13): cancel an order that has not started (jobs still draft / scheduled, no invoice).
  @Post(':id/cancel')
  @Permissions('orders:update')
  async cancelOrder(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.ordersService.cancelWctOrder(id, req.userOrganization.id);
  }

  @Post('from-quotation/:quotationId')
  @Permissions('orders:create')
  async createFromQuotation(
    @Param('quotationId') quotationId: string,
    @Req() req: RequestWithOrganization,
  ) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.createFromQuotation(quotationId, orgId);
  }

  @Patch(':id/status')
  @Permissions('orders:update')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Req() req: RequestWithOrganization,
  ) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.updateStatus(id, orgId, body.status);
  }

  @Patch(':id/items')
  @Permissions('orders:update')
  async updateItems(
    @Param('id') id: string,
    @Body() body: { items: any[] },
    @Req() req: RequestWithOrganization,
  ) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.updateItems(id, orgId, body.items);
  }

  @Patch(':id/link')
  @Permissions('orders:update')
  async linkDocument(
    @Param('id') id: string,
    @Body() body: { docKind: 'po' | 'do' | 'invoice' | 'salesOrder'; docId: string; docName: string; templateId?: string; itemIds?: number[] },
    @Req() req: RequestWithOrganization,
  ) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.linkDocument(id, orgId, body.docKind, {
      id: body.docId,
      name: body.docName,
      templateId: body.templateId,
      itemIds: body.itemIds,
    });
  }

  /**
   * Upload a supplier DO or Tax Invoice; auto-detect kind, locate the buyer's
   * PO it reconciles against, and run all checks (items/qty/price/totals, and
   * Points Issued for Route Order POs). Returns a structured verification
   * report rendered by the orders list page.
   */
  @Post('verify-upload')
  @Permissions('orders:read')
  @UseInterceptors(FileInterceptor('file'))
  async verifyUpload(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: RequestWithOrganization,
  ) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.verifySupplierUpload(orgId, file);
  }

  @Delete(':id')
  @Permissions('orders:delete')
  async delete(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.delete(id, orgId);
  }
}

/** Who added it (id + display name from the Clerk user). */
function actorOf(req: any): { id?: string; name?: string } {
  const u: any = req?.user || {};
  return { id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || undefined };
}
