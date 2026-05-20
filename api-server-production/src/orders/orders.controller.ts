import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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

  @Get(':id')
  @Permissions('orders:read')
  async getById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.getById(id, orgId);
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

  @Patch(':id/link')
  @Permissions('orders:update')
  async linkDocument(
    @Param('id') id: string,
    @Body() body: { docKind: 'po' | 'do' | 'invoice'; docId: string; docName: string; templateId?: string; itemIds?: number[] },
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

  @Delete(':id')
  @Permissions('orders:delete')
  async delete(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const orgId = req.userOrganization?.id;
    if (!orgId) throw new Error('User is not assigned to any organization');
    return this.ordersService.delete(id, orgId);
  }
}
