import { Controller, Post, Body, Delete, Put, Get, Param } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { GetCustomerDto } from './dto/get-customer.dto';
import { DeleteCustomerDto } from './dto/delete-customer.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  async getCustomers(@Body() getCustomerDto: GetCustomerDto) {
    return await this.customersService.getCustomers(getCustomerDto);
  }

  @Get(':id')
  async getCustomerById(@Param('id') id: string) {
    return await this.customersService.getCustomerById(id);
  }

  @Post('create')
  async createCustomers(@Body() createCustomerDto: CreateCustomerDto) {
    return await this.customersService.createCustomers(createCustomerDto);
  }

  @Put('update')
  async updateCustomers(@Body() updateCustomerDto: UpdateCustomerDto) {
    return await this.customersService.updateCustomers(updateCustomerDto);
  }

  @Delete('delete')
  async deleteCustomers(@Body() deleteCustomerDto: DeleteCustomerDto) {
    return await this.customersService.deleteCustomers(deleteCustomerDto);
  }
}
