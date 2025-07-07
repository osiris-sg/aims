import { Controller, Get, UseGuards, Req, Post, Body, Patch, Delete, Param } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

// Extend Request type to include userOrganization and isOsirisAdmin
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
  isOsirisAdmin?: boolean;
}

@Controller('organizations')
@UseGuards(ClerkAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get('user')
  @Permissions('organizations:read-user')
  async getUserOrganization(@Req() req: RequestWithOrganization) {
    const organization = req.userOrganization;

    if (!organization) {
      return {
        success: false,
        message: 'User is not assigned to any organization',
        data: null,
      };
    }

    return {
      success: true,
      message: 'User organization retrieved successfully',
      data: organization,
    };
  }

  @Post()
  @Permissions('organizations:create')
  async createOrganization(@Body() createOrganizationDto: CreateOrganizationDto) {
    return this.organizationsService.create(createOrganizationDto);
  }

  @Get()
  @Permissions('organizations:read')
  async getOrganizations() {
    return this.organizationsService.findAll();
  }

  @Get(':id')
  @Permissions('organizations:read-one')
  async getOrganizationById(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  @Permissions('organizations:update')
  async updateOrganization(@Param('id') id: string, @Body() updateOrganizationDto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, updateOrganizationDto);
  }

  @Delete(':id')
  @Permissions('organizations:delete')
  async deleteOrganization(@Param('id') id: string) {
    return this.organizationsService.remove(id);
  }
}
