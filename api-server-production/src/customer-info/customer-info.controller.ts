import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { UserOrganization } from '../auth/decorators/user-organization.decorator';
import { CustomerInfoService } from './customer-info.service';
import { CreateCustomerInfoRequestDto } from './dto/customer-info.dto';

interface ClerkRequest {
  user?: { id?: string };
}

/**
 * Office (authenticated) surface for Customer Information collection requests.
 * Reads are gated by customer-info:read; mint/revoke/regenerate by
 * customer-info:create. Org is injected by the guard; createdBy is the Clerk
 * user id of the minter.
 */
@Controller('customer-info')
export class CustomerInfoController {
  constructor(private readonly service: CustomerInfoService) {}

  @Get()
  @Permissions('customer-info:read')
  list(
    @UserOrganization() org: { id: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listRequests(org.id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status: status || undefined,
    });
  }

  @Get(':id')
  @Permissions('customer-info:read')
  detail(@Param('id') id: string, @UserOrganization() org: { id: string }) {
    return this.service.getRequest(id, org.id);
  }

  @Post()
  @Permissions('customer-info:create')
  create(
    @Body() dto: CreateCustomerInfoRequestDto,
    @UserOrganization() org: { id: string },
    @Req() req: ClerkRequest,
  ) {
    return this.service.createRequest(org.id, dto, req.user?.id ?? null);
  }

  @Post(':id/revoke')
  @Permissions('customer-info:create')
  revoke(@Param('id') id: string, @UserOrganization() org: { id: string }) {
    return this.service.revokeRequest(id, org.id);
  }

  @Post(':id/regenerate')
  @Permissions('customer-info:create')
  regenerate(@Param('id') id: string, @UserOrganization() org: { id: string }, @Req() req: ClerkRequest) {
    return this.service.regenerateRequest(id, org.id, req.user?.id ?? null);
  }
}
