import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../decorators/public.decorator';
import { PublicSignService } from './public-sign.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string };
}
function orgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

/**
 * Client e-signature surface. No @Controller prefix: the office handlers live
 * under /documents/:id/sign-link (authenticated), the client handlers under
 * /public/sign/:token (@Public — token is the only credential).
 */
@ApiTags('public-sign')
@Controller()
export class PublicSignController {
  constructor(private readonly service: PublicSignService) {}

  @UseGuards(ClerkAuthGuard)
  @Permissions('documents:update')
  @Post('documents/:id/sign-link')
  @ApiOperation({ summary: 'Mint (or reuse) the client e-sign link for a quotation' })
  create(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.createForDocument(id, orgId(req));
  }

  @UseGuards(ClerkAuthGuard)
  @Permissions('documents:read-one')
  @Get('documents/:id/sign-link')
  status(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.statusForDocument(id, orgId(req));
  }

  @UseGuards(ClerkAuthGuard)
  @Permissions('documents:update')
  @Post('documents/:id/ensure-project')
  @ApiOperation({ summary: 'Create/link the project for an accepted quotation' })
  ensureProject(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.ensureProjectForDocument(id, orgId(req));
  }

  @UseGuards(ClerkAuthGuard)
  @Permissions('documents:update')
  // Designer counter-signature (CIEL 09-01): after the client signs, the
  // designer adds their own signature to the confirmed quotation.
  @Post('documents/:id/designer-signature')
  designerSignature(
    @Param('id') id: string,
    @Body() body: { signatureImage: string; name?: string; saveToProfile?: boolean },
    @Req() req: any,
  ) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.service.addDesignerSignature(id, organizationId, body || ({} as any), req.user?.id);
  }

  @Post('documents/:id/sign-link/revoke')
  revoke(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    return this.service.revokeForDocument(id, orgId(req));
  }

  @Public()
  @Get('public/sign/:token')
  @ApiOperation({ summary: 'Public: quotation to sign (by token)' })
  get(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Public()
  @Post('public/sign/:token')
  @ApiOperation({ summary: 'Public: submit the client signature' })
  sign(@Param('token') token: string, @Body() body: { signerName?: string; signatureDataUrl?: string; agreed?: boolean }, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    return this.service.sign(token, body || {}, { ip, userAgent: req.headers['user-agent'] as string });
  }
}
