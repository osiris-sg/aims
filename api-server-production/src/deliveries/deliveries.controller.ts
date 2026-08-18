import { Body, Controller, Get, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { AddDeliveryItemDto } from './dto/add-delivery-item.dto';
import { CreateDoFromDeliveryDto, LinkDeliveryDto } from './dto/link-delivery.dto';
import { AckAllDto, AddItemPhotosDto, AssignDeliveryItemDto, SetDeploymentTypeDto, SkipInstallDto } from './dto/assign-delivery.dto';
import { ScheduleDeliveryDto, ClaimScheduledDto } from './dto/schedule-delivery.dto';
import { ScheduleReturnDto } from './dto/schedule-return.dto';

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

  // Office: pre-create a scheduled run (asset-only items, no rider, nothing
  // reserved). Same office persona as link/create-do.
  @Post('scheduled')
  @Permissions('documents:create-basic')
  createScheduled(@Body() dto: ScheduleDeliveryDto, @UserOrganization() org: { id: string }) {
    return this.service.createScheduled(dto, org.id);
  }

  // Office: edit a still-scheduled delivery run (same form, prefilled). Rejected
  // once a rider has started (status no longer 'scheduled'). Regenerates the DO.
  @Patch('scheduled/:id')
  @Permissions('documents:create-basic')
  updateScheduled(
    @Param('id') id: string,
    @Body() dto: ScheduleDeliveryDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.updateScheduled(id, dto, org.id);
  }

  // Office: pre-create a scheduled RETURN run for specific units. No document is
  // created (RDO minted at completion only) and nothing is reserved.
  @Post('scheduled-return')
  @Permissions('documents:create-basic')
  createScheduledReturn(@Body() dto: ScheduleReturnDto, @UserOrganization() org: { id: string }) {
    return this.service.createScheduledReturn(dto, org.id);
  }

  // Field: a rider claims a scheduled run by scanning a matching unit — binds +
  // reserves it, sets the rider, starts the run.
  @Post(':id/claim-scheduled')
  @Permissions('maintenance-reports:create')
  claimScheduled(
    @Param('id') id: string,
    @Body() dto: ClaimScheduledDto,
    @UserOrganization() org: { id: string },
    @Req() req: ClerkRequest,
  ) {
    const riderUserId = req.user?.id;
    if (!riderUserId) throw new UnauthorizedException('Missing authenticated user');
    return this.service.claimScheduled(id, dto, org.id, riderUserId);
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
    @Req() req: ClerkRequest,
    @Query('unlinked') unlinked?: string,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Query('unfinished') unfinished?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const isMine = mine === 'true' || mine === '1';
    return this.service.list(org.id, {
      unlinked: unlinked === 'true' || unlinked === '1',
      status,
      // Rider resume view — scope to the caller's own runs.
      mine: isMine,
      riderUserId: isMine ? req.user?.id : undefined,
      unfinished: unfinished === 'true' || unfinished === '1',
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
    return this.service.link(id, dto.documentId, org.id, dto.itemIds);
  }

  @Post(':id/create-do')
  @Permissions('documents:create-basic')
  createDo(
    @Param('id') id: string,
    @Body() dto: CreateDoFromDeliveryDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.createDoFromDelivery(id, org.id, dto.documentTemplateId, dto.itemIds);
  }

  @Post(':id/assign')
  @Permissions('maintenance-reports:create')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignDeliveryItemDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.assignItem(id, dto, org.id);
  }

  // Office: set a delivered unit's RENTAL/SALE intent (writes the item's active
  // ProjectDeployment.type only — DO-confirm/ack still own the status flip).
  @Post(':id/items/deployment-type')
  @Permissions('documents:create-basic')
  setDeploymentType(
    @Param('id') id: string,
    @Body() dto: SetDeploymentTypeDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.setItemDeploymentType(id, dto.inventoryId, dto.type, org.id);
  }

  @Post(':id/items/skip-install')
  @Permissions('maintenance-reports:create')
  skipInstall(
    @Param('id') id: string,
    @Body() dto: SkipInstallDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.skipInstall(id, dto.inventoryId, org.id);
  }

  // Field: acknowledge EVERY delivering unit on the run at once with one
  // signature + photo + GPS (one DO_ACK MSR per unit carrying the shared proof).
  @Post(':id/ack-all')
  @Permissions('maintenance-reports:create')
  ackAll(
    @Param('id') id: string,
    @Body() dto: AckAllDto,
    @UserOrganization() org: { id: string },
    @Req() req: ClerkRequest,
  ) {
    const riderUserId = req.user?.id;
    if (!riderUserId) throw new UnauthorizedException('Missing authenticated user');
    return this.service.acknowledgeAll(id, dto, org.id, riderUserId);
  }

  // Mark a FREE-TYPED item delivered (no unit to scan). Keyed by DeliveryItem.id;
  // the service rejects any row that carries an assetId/inventoryId.
  @Post(':id/items/:itemId/deliver')
  @Permissions('maintenance-reports:create')
  markFreeTypedDelivered(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.markFreeTypedDelivered(id, itemId, org.id);
  }

  @Post(':id/items/photos')
  @Permissions('maintenance-reports:create')
  addItemPhotos(
    @Param('id') id: string,
    @Body() dto: AddItemPhotosDto,
    @UserOrganization() org: { id: string },
  ) {
    return this.service.addItemPhotos(id, { inventoryId: dto.inventoryId, photos: dto.photos }, org.id);
  }

  @Post(':id/cancel')
  @Permissions('maintenance-reports:create')
  cancel(@Param('id') id: string, @UserOrganization() org: { id: string }) {
    return this.service.cancel(id, org.id);
  }
}
