import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
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
}
