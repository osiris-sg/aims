import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { JobPhotosService } from './job-photos.service';

/** Office: job photos from SiteClock on the delivery and order pages (orgs with the SiteClock link). */
@ApiTags('job photos')
@Controller()
@UseGuards(ClerkAuthGuard)
export class JobPhotosController {
  constructor(private readonly photos: JobPhotosService) {}

  @Get('deliveries/:id/job-photos')
  @Permissions('maintenance-reports:read')
  forDelivery(@Param('id', ParseUUIDPipe) id: string, @UserOrganization() org: { id: string }) {
    return this.photos.forDelivery(org.id, id);
  }

  @Get('orders/:id/job-photos')
  @Permissions('orders:read')
  forOrder(@Param('id', ParseUUIDPipe) id: string, @UserOrganization() org: { id: string }) {
    return this.photos.forOrder(org.id, id);
  }

  // Admins hide a photo in AIMS (kept, logged); same permission as Verify / Reject.
  @Post('job-photos/:id/hide')
  @Permissions('documents:update')
  hide(@Param('id', ParseUUIDPipe) id: string, @UserOrganization() org: { id: string }, @Req() req: any) {
    const u: any = req?.user || {};
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || undefined;
    return this.photos.hide(org.id, id, { id: u.id, name });
  }

  // The office sorts a photo SiteClock sent unsorted (or corrects its type); same permission as Hide.
  @Patch('job-photos/:id/tag')
  @Permissions('documents:update')
  setTag(@Param('id', ParseUUIDPipe) id: string, @Body() body: { tag?: string }, @UserOrganization() org: { id: string }, @Req() req: any) {
    const u: any = req?.user || {};
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username || undefined;
    return this.photos.setTag(org.id, id, body?.tag ?? '', { id: u.id, name });
  }
}
