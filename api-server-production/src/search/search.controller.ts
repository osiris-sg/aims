import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { SearchService } from './search.service';

interface RequestWithOrganization {
  userOrganization?: { id: string };
  user?: { id?: string };
}

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
@UseGuards(ClerkAuthGuard)
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @Permissions('documents:read')
  search(@Req() req: RequestWithOrganization, @Query('q') q?: string) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) throw new Error('User is not assigned to any organization');
    return this.service.search(organizationId, q || '', req.user?.id);
  }
}
