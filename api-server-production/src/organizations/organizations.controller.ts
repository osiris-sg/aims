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
  @UseGuards(ClerkAuthGuard)
  @Permissions('organizations:create')
  async createOrganization(@Body() createOrganizationDto: CreateOrganizationDto) {
    try {
      const organization = await this.organizationsService.create(createOrganizationDto);
      return {
        success: true,
        message: 'Organization created successfully',
        data: organization,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to create organization',
        data: null,
      };
    }
  }

  @Get()
  @UseGuards(ClerkAuthGuard)
  @Permissions('organizations:read')
  async getOrganizations() {
    try {
      const organizations = await this.organizationsService.findAll();
      return {
        success: true,
        message: 'Organizations retrieved successfully',
        data: organizations,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to retrieve organizations',
        data: null,
      };
    }
  }

  @Get('salesmen/list')
  @UseGuards(ClerkAuthGuard)
  async getSalesmen(@Req() req: RequestWithOrganization) {
    console.log('=== GET /organizations/salesmen/list ===');
    console.log('Request user:', (req as any).user?.id);
    console.log('User organization:', req.userOrganization);

    try {
      const organization = req.userOrganization;

      if (!organization) {
        console.log('No organization found for user');
        return {
          success: false,
          message: 'User is not assigned to any organization',
          data: [],
        };
      }

      console.log('Fetching salesmen for organization:', organization.id);
      const salesmen = await this.organizationsService.getSalesmenByOrganization(organization.id);
      console.log('Salesmen found:', salesmen.length);
      console.log('Salesmen data:', JSON.stringify(salesmen, null, 2));

      return {
        success: true,
        message: 'Salesmen retrieved successfully',
        data: salesmen,
      };
    } catch (error: any) {
      console.error('Error fetching salesmen:', error);
      return {
        success: false,
        message: error.message || 'Failed to retrieve salesmen',
        data: [],
      };
    }
  }

  @Get(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('organizations:read-one')
  async getOrganizationById(@Param('id') id: string) {
    try {
      const organization = await this.organizationsService.findOne(id);
      if (!organization) {
        return {
          success: false,
          message: 'Organization not found',
          data: null,
        };
      }
      return {
        success: true,
        message: 'Organization retrieved successfully',
        data: organization,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to retrieve organization',
        data: null,
      };
    }
  }

  @Patch(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('organizations:update')
  async updateOrganization(@Param('id') id: string, @Body() updateOrganizationDto: UpdateOrganizationDto) {
    try {
      const organization = await this.organizationsService.update(id, updateOrganizationDto);
      return {
        success: true,
        message: 'Organization updated successfully',
        data: organization,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to update organization',
        data: null,
      };
    }
  }

  @Delete(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('organizations:delete')
  async deleteOrganization(@Param('id') id: string) {
    try {
      await this.organizationsService.remove(id);
      return {
        success: true,
        message: 'Organization deleted successfully',
        data: null,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Failed to delete organization',
        data: null,
      };
    }
  }

}
