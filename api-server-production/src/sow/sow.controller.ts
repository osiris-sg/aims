import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { SowService, SowData } from './sow.service';
import { DocumentActor } from '../documents/documents.service';

interface ReqWithAdmin extends Request {
  isOsirisAdmin?: boolean;
  user?: any;
}

function actorFromReq(req: any): DocumentActor {
  const u: any = req.user || {};
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return { id: u.id, name: name || undefined, email: u.emailAddresses?.[0]?.emailAddress };
}

/** OSIRIS-INTERNAL SOW builder — every endpoint is osirisadmin-only. */
@Controller('sow')
@UseGuards(ClerkAuthGuard)
export class SowController {
  constructor(private readonly sow: SowService) {}

  @Get('modules')
  modules(@Req() req: ReqWithAdmin) {
    this.sow.assertOsirisAdmin(req);
    return this.sow.listModules();
  }

  @Post('generate')
  generate(@Body() body: any, @Req() req: ReqWithAdmin) {
    this.sow.assertOsirisAdmin(req);
    return this.sow.generate(body);
  }

  // Client sends back the (possibly hand-edited) SowData → rendered PDF.
  @Post('pdf')
  pdf(@Body() body: SowData, @Req() req: ReqWithAdmin) {
    this.sow.assertOsirisAdmin(req);
    return this.sow.pdf(body);
  }

  @Post('create-document')
  createDocument(@Body() body: any, @Req() req: ReqWithAdmin) {
    this.sow.assertOsirisAdmin(req);
    return this.sow.createDocument(body, actorFromReq(req));
  }
}
