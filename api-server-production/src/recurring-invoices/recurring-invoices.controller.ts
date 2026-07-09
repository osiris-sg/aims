import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RecurringInvoicesService } from './recurring-invoices.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
  userId?: string;
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('recurring-invoices')
@ApiBearerAuth()
@Controller('recurring-invoices')
@UseGuards(ClerkAuthGuard)
export class RecurringInvoicesController {
  constructor(private readonly service: RecurringInvoicesService) {}

  @Get()
  @Permissions('documents:read')
  list(@Req() req: RequestWithOrganization) {
    return this.service.list(orgId(req));
  }

  @Get(':id')
  @Permissions('documents:read')
  findOne(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.findOne(orgId(req), id);
  }

  @Post()
  @Permissions('accounting:update')
  create(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.create(orgId(req), body, req.userId);
  }

  @Patch(':id')
  @Permissions('accounting:update')
  update(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: any) {
    return this.service.update(orgId(req), id, body);
  }

  @Delete(':id')
  @Permissions('accounting:update')
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(orgId(req), id);
  }

  // Lazy scheduler — the Finance Hub / recurring page calls this on load.
  @Post('run-due')
  @Permissions('documents:read')
  runDue(@Req() req: RequestWithOrganization) {
    return this.service.runDue(orgId(req));
  }

  // Manual "generate now" for one template (uses its current nextRunDate wording).
  @Post(':id/generate-now')
  @Permissions('accounting:update')
  async generateNow(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    const org = orgId(req);
    const t = await this.service.findOne(org, id);
    const doc = await this.service.generateOne(org, t, new Date(), req.userId);
    return { ok: true, documentId: doc.id };
  }
}
