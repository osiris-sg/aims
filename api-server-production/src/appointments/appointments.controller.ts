import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../decorators/public.decorator';
import { AppointmentsService } from './appointments.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
  user?: { id?: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}
function actorName(req: RequestWithOrganization): string | null {
  const u: any = req.user || {};
  return u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || null;
}

/** PUBLIC (no login): the client-facing booking page's data + booking. */
@ApiTags('appointments')
@Controller()
export class PublicBookingController {
  constructor(private readonly service: AppointmentsService) {}

  @Public()
  @Get('public/booking/:token')
  slots(@Param('token') token: string) {
    return this.service.publicSlots(token);
  }

  @Public()
  @Post('public/booking/:token/book')
  book(@Param('token') token: string, @Body() dto: { name: string; phone: string; note?: string | null; startAt: string }) {
    return this.service.publicBook(token, dto || ({} as any));
  }
}

/** Designer appointment schedule — rides projects permissions (same crowd). */
@ApiTags('appointments')
@ApiBearerAuth()
@Controller('appointments')
@UseGuards(ClerkAuthGuard)
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService) {}

  @Get()
  @Permissions('projects:read')
  list(@Req() req: RequestWithOrganization, @Query('from') from?: string, @Query('to') to?: string) {
    return this.service.list(orgId(req), req.user?.id, from, to);
  }

  @Post()
  @Permissions('projects:read')
  create(@Req() req: RequestWithOrganization, @Body() dto: any) {
    return this.service.create(orgId(req), req.user!.id!, actorName(req), dto || {});
  }

  @Patch(':id/cancel')
  @Permissions('projects:read')
  cancel(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.cancel(orgId(req), req.user?.id, id);
  }

  @Post('booking-link')
  @Permissions('projects:read')
  bookingLink(@Req() req: RequestWithOrganization) {
    return this.service.bookingLink(orgId(req), req.user!.id!, actorName(req));
  }

  @Delete('booking-link')
  @Permissions('projects:read')
  revokeBookingLink(@Req() req: RequestWithOrganization) {
    return this.service.revokeBookingLink(orgId(req), req.user!.id!);
  }
}
