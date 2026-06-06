import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CostCentersService } from './cost-centers.service';

interface RequestWithOrganization extends Request {
  userOrganization?: { id: string; name: string };
  auth?: { userId: string };
}

function requireOrgId(req: RequestWithOrganization): string {
  const id = req.userOrganization?.id;
  if (!id) throw new Error('User is not assigned to any organization');
  return id;
}

@ApiTags('cost-centers')
@ApiBearerAuth()
@Controller('cost-centers')
@UseGuards(ClerkAuthGuard)
export class CostCentersController {
  constructor(private readonly service: CostCentersService) {}

  @Get()
  @Permissions('accounting:read')
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  list(@Req() req: RequestWithOrganization, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(requireOrgId(req), includeInactive === 'true');
  }

  @Post()
  @Permissions('accounting:create')
  create(@Req() req: RequestWithOrganization, @Body() body: any) {
    return this.service.create(requireOrgId(req), body);
  }

  @Patch(':id')
  @Permissions('accounting:update')
  update(@Req() req: RequestWithOrganization, @Param('id') id: string, @Body() body: any) {
    return this.service.update(requireOrgId(req), id, body);
  }

  @Delete(':id')
  @Permissions('accounting:delete')
  remove(@Req() req: RequestWithOrganization, @Param('id') id: string) {
    return this.service.remove(requireOrgId(req), id);
  }

  @Post('suggest')
  @Permissions('accounting:read')
  @ApiOperation({ summary: 'LLM-suggest the best cost center for a free-form description' })
  suggest(@Req() req: RequestWithOrganization, @Body() body: { description: string }) {
    return this.service.suggest(requireOrgId(req), body.description);
  }
}
