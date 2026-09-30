import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { DeliveryGroupPostsService } from './delivery-group-posts.service';

/** Portal side of delivery group posts: group pickers, post status, retry and
 *  the signed-DO download. */
@ApiTags('delivery-group-posts')
@Controller('delivery-group-posts')
export class DeliveryGroupPostsController {
  constructor(private readonly posts: DeliveryGroupPostsService) {}

  /** The groups the posting number is in (reported by the worker). */
  @Get('groups')
  @Permissions('projects:read')
  groups(@UserOrganization() org: { id: string }) {
    return this.posts.groups(org.id);
  }

  @Get('current')
  @Permissions('projects:read')
  current(@UserOrganization() org: { id: string }, @Query('projectId') projectId?: string, @Query('customerId') customerId?: string) {
    return this.posts.currentGroups(org.id, { projectId, customerId });
  }

  @Put('project/:id/group')
  @Permissions('projects:update')
  setProject(@UserOrganization() org: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() body: { groupId?: string | null }) {
    return this.posts.setProjectGroup(org.id, id, body?.groupId || null);
  }

  @Put('customer/:id/group')
  @Permissions('customers:update')
  setCustomer(@UserOrganization() org: { id: string }, @Param('id', ParseUUIDPipe) id: string, @Body() body: { groupId?: string | null }) {
    return this.posts.setCustomerGroup(org.id, id, body?.groupId || null);
  }

  @Put('ops-group')
  @Permissions('organizations:update')
  setOps(@UserOrganization() org: { id: string }, @Body() body: { groupId?: string | null }) {
    return this.posts.setOpsGroup(org.id, body?.groupId || null);
  }

  @Get('delivery/:deliveryId')
  @Permissions('maintenance-reports:read')
  forDelivery(@UserOrganization() org: { id: string }, @Param('deliveryId', ParseUUIDPipe) deliveryId: string) {
    return this.posts.postsForDelivery(org.id, deliveryId);
  }

  @Post(':id/retry')
  @Permissions('maintenance-reports:create')
  retry(@UserOrganization() org: { id: string }, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.retry(org.id, id);
  }

  /** "Download signed DO": the DO as signed, rendered now. */
  @Get('delivery/:deliveryId/signed-do')
  @Permissions('maintenance-reports:read')
  async signedDo(
    @UserOrganization() org: { id: string },
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
    @Query('documentId', ParseUUIDPipe) documentId: string,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.posts.signedDoForDelivery(org.id, deliveryId, documentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
