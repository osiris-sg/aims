import { Controller, Post, Body, Delete, Put, Get, Param, Req, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { GetCustomerDto } from './dto/get-customer.dto';
import { DeleteCustomerDto } from './dto/delete-customer.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';

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
  async getCustomers(@Body() getCustomerDto: GetCustomerDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.getCustomers(getCustomerDto, organizationId);
  }

  @Get(':id')
  async getCustomerById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.getCustomerById(id, organizationId);
  }

  @Post('create')
  async createCustomers(@Body() createCustomerDto: CreateCustomerDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.createCustomers(createCustomerDto, organizationId);
  }

  @Put('update')
  async updateCustomers(@Body() updateCustomerDto: UpdateCustomerDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.updateCustomers(updateCustomerDto, organizationId);
  }

  @Delete('delete')
  async deleteCustomers(@Body() deleteCustomerDto: DeleteCustomerDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.customersService.deleteCustomers(deleteCustomerDto, organizationId);
  }
}
