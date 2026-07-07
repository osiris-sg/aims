import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { DocumentNumberingService } from './document-numbering.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('document-numbering')
@ApiBearerAuth()
@Controller('document-numbering')
@UseGuards(ClerkAuthGuard)
export class DocumentNumberingController {
  constructor(private readonly service: DocumentNumberingService) {}

  // Read is used by the document create flow (variant picker) → documents:read.
  @Get()
  @Permissions('documents:read')
  list(@Req() req: RequestWithOrganization, @Query('documentType') documentType?: string) {
    return this.service.list(orgId(req), documentType);
  }

  // Stateless preview for the builder UI — formats a pattern with a sample serial
  // and today's date; does NOT touch any counter.
  @Post('preview')
  @Permissions('documents:read')
  preview(@Body() body: { pattern: string; sampleSerial?: number }) {
    return { preview: DocumentNumberingService.format(body?.pattern || '', body?.sampleSerial ?? 1, new Date()) };
  }

  // Mutations are Accounting Setup (accountant/admin) → accounting:update.
  @Post()
  @Permissions('accounting:update')
  create(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.create(orgId(req), body);
  }

  // Create the variant for every document type at once (uses the {DOC} token).
  @Post('apply-all')
  @Permissions('accounting:update')
  applyAll(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.applyToAll(orgId(req), body);
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
}
