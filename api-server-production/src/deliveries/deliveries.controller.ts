import { Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { AddDeliveryItemDto } from './dto/add-delivery-item.dto';
import { CreateDoFromDeliveryDto, LinkDeliveryDto } from './dto/link-delivery.dto';

interface ClerkRequest extends Request {
  user?: { id?: string };
}

/**
 * Standalone Delivery runs (phase 1 backend). Field endpoints reuse the
 * maintenance-reports permissions (same rider persona); office link/create-DO
 * reuse documents:create-basic (same office persona that makes DOs).
 */
@ApiTags('deliveries')
@Controller('deliveries')
@UseGuards(ClerkAuthGuard)
export class DeliveriesController {
  constructor(private readonly service: DeliveriesService) {}

  @Post()
  @Permissions('maintenance-reports:create')
  create(
    @Body() dto: CreateDeliveryDto,
    @UserOrganization() org: { id: string },
    @Req() req: ClerkRequest,
  ) {
    const riderUserId = req.user?.id;
    if (!riderUserId) throw new UnauthorizedException('Missing authenticated user');
    return this.service.create(dto, org.id, riderUserId);
  }

  @Post(':id/items')
  @Permissions('maintenance-reports:create')
  addItem(
    @Param('id') id: string,
    @Body() dto: AddDeliveryItemDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.addItem(id, dto, org.id);
  }

  @Get()
  @Permissions('maintenance-reports:read')
  list(
    @UserOrganization() org: { id: string },
    @Query('unlinked') unlinked?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(org.id, {
      unlinked: unlinked === 'true' || unlinked === '1',
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @Permissions('maintenance-reports:read')
  findById(@Param('id') id: string, @UserOrganization() org: { id: string }) {
    return this.service.findById(id, org.id);
  }

  @Post(':id/link')
  @Permissions('documents:create-basic')
  link(
    @Param('id') id: string,
    @Body() dto: LinkDeliveryDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.link(id, dto.documentId, org.id);
  }

  @Post(':id/create-do')
  @Permissions('documents:create-basic')
  createDo(
    @Param('id') id: string,
    @Body() dto: CreateDoFromDeliveryDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.createDoFromDelivery(id, org.id, dto.documentTemplateId);
  }

  @Post(':id/cancel')
  @Permissions('maintenance-reports:create')
  cancel(@Param('id') id: string, @UserOrganization() org: { id: string }) {
    return this.service.cancel(id, org.id);
  }
}
