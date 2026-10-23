import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ShortLinksService } from './short-links.service';

interface GoRequest {
  userOrganization?: { id: string } | null;
  isOsirisAdmin?: boolean;
}

/** GET /go/:token → { path } for the signed-in caller; 404 for anything else (round AD). */
@Controller('go')
@UseGuards(ClerkAuthGuard)
export class ShortLinksController {
  constructor(private readonly links: ShortLinksService) {}

  @Get(':token')
  async resolve(@Param('token') token: string, @Req() req: GoRequest) {
    const r = await this.links.resolve(String(token ?? '').toLowerCase(), { organizationId: req.userOrganization?.id ?? null, isOsirisAdmin: !!req.isOsirisAdmin });
    if (!r) throw new NotFoundException('This link has expired or is not yours');
    return { path: r.path };
  }
}
