import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { NotificationsService } from './notifications.service';

interface ClerkRequest extends Request {
  user?: { id?: string };
}

/**
 * Header-bell notifications. Auth-only (no @Permissions): every endpoint is
 * scoped to the CALLER'S OWN rows in the active org, so there is nothing to
 * gate — a user can only ever read/clear their own notifications. Audience is
 * enforced at write time in NotificationsService (documents:read holders).
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(ClerkAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(
    @UserOrganization() org: { id: string },
    @Req() req: ClerkRequest,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Missing authenticated user');
    const n = limit ? Math.min(parseInt(limit, 10) || 20, 100) : 20;
    return this.service.list(userId, org.id, n);
  }

  @Post(':id/read')
  markRead(
    @Param('id') id: string,
    @UserOrganization() org: { id: string },
    @Req() req: ClerkRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Missing authenticated user');
    return this.service.markRead(id, userId, org.id);
  }

  @Post('read-all')
  markAllRead(@UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('Missing authenticated user');
    return this.service.markAllRead(userId, org.id);
  }
}
