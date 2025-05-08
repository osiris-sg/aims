import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { GetCustomerDto } from './dto/get-customer.dto';
import { DeleteCustomerDto } from './dto/delete-customer.dto';
import { PrismaService } from 'src/common/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async getCustomers(getCustomerDto: GetCustomerDto) {
    try {
      const { organizationId, page, limit, search, filters } = getCustomerDto;
      const skip = (page - 1) * limit;
      const whereClause: any = { organizationId };
      // Search filter
      if (search) {
        whereClause.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },

          // Add more fields as needed
        ];
      }

      // Date range filter
      if (filters?.createdOn?.startDate || filters?.createdOn?.endDate) {
        whereClause.createdAt = {};

        if (filters.createdOn.startDate) {
          whereClause.createdAt.gte = new Date(filters.createdOn.startDate);
        }

        if (filters.createdOn.endDate) {
          whereClause.createdAt.lte = new Date(filters.createdOn.endDate);
        }
      }

      const customers = await this.prisma.customer.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      });

      const totalDocs = await this.prisma.customer.count({
        where: {
          organizationId: organizationId,
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
      });

      const hasNextPage = skip + customers.length < totalDocs;
      const hasPreviousPage = page > 1;

      return {
        docs: customers,
        hasNextPage,
        hasPreviousPage,
        page,
        limit,
        totalPagesCount: Math.ceil(totalDocs / limit),
        totalDocuments: totalDocs,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getCustomerById(id: string) {
    try {
      return await this.prisma.customer.findUnique({ where: { id } });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createCustomers(createCustomerDto: CreateCustomerDto) {
    try {
      const newCustomer = await this.prisma.customer.create({
        data: createCustomerDto,
      });
      return newCustomer;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateCustomers(updateCustomerDto: UpdateCustomerDto) {
    try {
      const customer = await this.prisma.customer.update({
        where: { id: updateCustomerDto.id },
        data: updateCustomerDto,
      });
      return customer;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteCustomers(deleteCustomerDto: DeleteCustomerDto) {
    try {
      const customer = await this.prisma.customer.delete({
        where: { id: deleteCustomerDto.id },
      });
      return customer;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
