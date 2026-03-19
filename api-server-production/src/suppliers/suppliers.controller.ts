import { Controller, Post, Body, Delete, Put, Get, Param, Req, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { GetSupplierDto } from './dto/get-supplier.dto';
import { DeleteSupplierDto } from './dto/delete-supplier.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Request } from 'express';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@Controller('suppliers')
@UseGuards(ClerkAuthGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @Permissions('suppliers:read')
  async getSuppliers(@Body() getSupplierDto: GetSupplierDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.suppliersService.getSuppliers(getSupplierDto, organizationId);
  }

  @Get(':id')
  @Permissions('suppliers:read-one')
  async getSupplierById(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.suppliersService.getSupplierById(id, organizationId);
  }

  @Post('create')
  @Permissions('suppliers:create')
  async createSupplier(@Body() createSupplierDto: CreateSupplierDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.suppliersService.createSupplier(createSupplierDto, organizationId);
  }

  @Put('update')
  @Permissions('suppliers:update')
  async updateSupplier(@Body() updateSupplierDto: UpdateSupplierDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.suppliersService.updateSupplier(updateSupplierDto, organizationId);
  }

  @Delete('delete')
  @Permissions('suppliers:delete')
  async deleteSupplier(@Body() deleteSupplierDto: DeleteSupplierDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return await this.suppliersService.deleteSupplier(deleteSupplierDto, organizationId);
  }
}
