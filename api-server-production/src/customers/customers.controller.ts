import { Controller, Post, Body, Delete, Put, Get, Param, Req, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { GetCustomerDto } from './dto/get-customer.dto';
import { DeleteCustomerDto } from './dto/delete-customer.dto';
import { CreateSiteOfficeDto } from './dto/create-site-office.dto';
import { UpdateSiteOfficeDto } from './dto/update-site-office-dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@Controller('customers')
@UseGuards(ClerkAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @Permissions('customers:read')
  async getCustomers(@Body() getCustomerDto: GetCustomerDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.getCustomers(getCustomerDto, organizationId);
  }

  @Get(':id')
  @Permissions('customers:read-one')
  async getCustomerById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.getCustomerById(id, organizationId);
  }

  @Post('create')
  @Permissions('customers:create')
  async createCustomers(@Body() createCustomerDto: CreateCustomerDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.createCustomers(createCustomerDto, organizationId);
  }

  @Put('update')
  @Permissions('customers:update')
  async updateCustomers(@Body() updateCustomerDto: UpdateCustomerDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.updateCustomers(updateCustomerDto, organizationId);
  }

  @Delete('delete')
  @Permissions('customers:delete')
  async deleteCustomers(@Body() deleteCustomerDto: DeleteCustomerDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.deleteCustomers(deleteCustomerDto, organizationId);
  }

  @Get(':customerId/site-offices')
  @Permissions('customers:read')
  async getSiteOffices(@Param('customerId') customerId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.getSiteOffices(customerId, organizationId);
  }

  @Post(':customerId/site-offices')
  @Permissions('customers:create')
  async createSiteOffice(@Param('customerId') customerId: string, @Body() createSiteOfficeDto: CreateSiteOfficeDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    const siteOfficePayload = {
      ...createSiteOfficeDto,
      customerId,
    };

    return await this.customersService.createSiteOffice(siteOfficePayload, organizationId);
  }

  @Put('site-offices/:id')
  @Permissions('customers:update')
  async updateSiteOffice(@Param('id') id: string, @Body() updateSiteOfficeDto: UpdateSiteOfficeDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }

    const siteOfficeUpdatePayload = {
      ...updateSiteOfficeDto,
      id,
    };

    return await this.customersService.updateSiteOffice(siteOfficeUpdatePayload, organizationId);
  }

  @Delete('site-offices/:id')
  @Permissions('customers:delete')
  async deleteSiteOffice(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.deleteSiteOffice(id, organizationId);
  }

  @Get('site-offices/:id')
  @Permissions('customers:read')
  async getSiteOfficeById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.getSiteOfficeById(id, organizationId);
  }
}
