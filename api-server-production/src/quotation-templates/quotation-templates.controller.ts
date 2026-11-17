import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { QuotationTemplatesService } from './quotation-templates.service';

interface Req2 extends Request {
  userOrganization?: { id: string; name?: string };
  user?: any;
}

function actorOf(req: Req2) {
  const u: any = req.user || {};
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return { id: u.id, name: name || undefined, email: u.emailAddresses?.[0]?.emailAddress };
}

/**
 * Quotation templates (features.enableQuotationTemplates). Reads are GETs; every
 * write is a plain POST / PATCH / DELETE on a :id, so the Activity Log records
 * CREATE / UPDATE / DELETE rows with the template id; "use" logs as CREATE (it
 * creates the quotation, whose own history row names it).
 */
@ApiTags('quotation-templates')
@Controller('quotation-templates')
@UseGuards(ClerkAuthGuard)
export class QuotationTemplatesController {
  constructor(private readonly service: QuotationTemplatesService) {}

  @Get()
  @Permissions('documents:read')
  list(@Req() req: Req2) {
    return this.service.list(req.userOrganization?.id as string);
  }

  @Get(':id')
  @Permissions('documents:read')
  get(@Param('id') id: string, @Req() req: Req2) {
    return this.service.get(id, req.userOrganization?.id as string);
  }

  @Post()
  @Permissions('documents:update')
  create(@Body() body: any, @Req() req: Req2) {
    return this.service.create(body ?? {}, req.userOrganization?.id as string, actorOf(req));
  }

  @Patch(':id')
  @Permissions('documents:update')
  update(@Param('id') id: string, @Body() body: any, @Req() req: Req2) {
    return this.service.update(id, body ?? {}, req.userOrganization?.id as string, actorOf(req));
  }

  /** Hides the template; the request is the Activity Log row. */
  @Delete(':id')
  @Permissions('documents:update')
  hide(@Param('id') id: string, @Req() req: Req2) {
    return this.service.hide(id, req.userOrganization?.id as string, actorOf(req));
  }

  /** Body { documentTemplateId, type?, numberFormatId? }: a new draft quotation with the template's lines. */
  @Post(':id/use')
  @Permissions('documents:create-basic')
  use(@Param('id') id: string, @Body() body: any, @Req() req: Req2) {
    return this.service.use(id, body ?? {}, req.userOrganization?.id as string, actorOf(req));
  }
}
