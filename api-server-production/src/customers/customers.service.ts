import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { GetCustomerDto } from './dto/get-customer.dto';
import { DeleteCustomerDto } from './dto/delete-customer.dto';
import { PrismaService } from 'src/common/prisma.service';
import { CreateSiteOfficeDto } from './dto/create-site-office.dto';
import { UpdateSiteOfficeDto } from './dto/update-site-office-dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async getCustomers(getCustomerDto: GetCustomerDto, organizationId: string) {
    try {
      const { page, limit, search, filters } = getCustomerDto;
      const skip = (page - 1) * limit;
      const whereClause: any = { organizationId };

      // Search filter
      if (search) {
        whereClause.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
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
        where: whereClause,
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

  async getCustomerById(id: string, organizationId: string) {
    try {
      return await this.prisma.customer.findFirst({
        where: {
          id,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createCustomers(createCustomerDto: CreateCustomerDto, organizationId: string) {
    try {
      const newCustomer = await this.prisma.customer.create({
        data: {
          ...createCustomerDto,
          organizationId, // Automatically assign to user's organization
        },
      });
      return newCustomer;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateCustomers(updateCustomerDto: UpdateCustomerDto, organizationId: string) {
    try {
      const customer = await this.prisma.customer.update({
        where: {
          id: updateCustomerDto.id,
          organizationId, // Ensure user can only update customers in their organization
        },
        data: updateCustomerDto,
      });
      return customer;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteCustomers(deleteCustomerDto: DeleteCustomerDto, organizationId: string) {
    try {
      const customer = await this.prisma.customer.delete({
        where: {
          id: deleteCustomerDto.id,
          organizationId, // Ensure user can only delete customers in their organization
        },
      });
      return customer;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async getSiteOffices(customerId: string, organizationId: string) {
    try {
      return await this.prisma.siteOffice.findMany({
        where: {
          customerId,
          customer: {
            organizationId,
          },
        },
        include: {
          contactDetails: true,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getSiteOfficeById(siteOfficeId: string, organizationId: string) {
    try {
      return await this.prisma.siteOffice.findFirst({
        where: {
          id: siteOfficeId,
          customer: {
            organizationId,
          },
        },
        include: {
          contactDetails: true,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createSiteOffice(data: CreateSiteOfficeDto, organizationId: string) {
    try {
      console.log('Creating site office with data:', data, 'and organizationId:', organizationId);
      const customer = await this.prisma.customer.findFirst({
        where: {
          id: data.customerId,
          organizationId,
        },
      });

      if (!customer) {
        throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
      }

      return await this.prisma.siteOffice.create({
        data: {
          name: data.name,
          address: data.address,
          customerId: data.customerId,
          contactDetails:
            data.contactDetails && data.contactDetails.length > 0
              ? {
                  create: data.contactDetails.filter(
                    (detail) => (detail.name && detail.name.trim() !== '') || (detail.email && detail.email.trim() !== '') || (detail.phone && detail.phone.trim() !== ''),
                  ),
                }
              : undefined,
        },
        include: {
          contactDetails: true,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateSiteOffice(data: UpdateSiteOfficeDto, organizationId: string) {
    try {
      const siteOffice = await this.prisma.siteOffice.findFirst({
        where: {
          id: data.id,
          customer: {
            organizationId,
          },
        },
      });

      if (!siteOffice) {
        throw new HttpException('Site office not found', HttpStatus.NOT_FOUND);
      }

      // Update scalar fields first
      const updatedSiteOffice = await this.prisma.siteOffice.update({
        where: { id: data.id },
        data: {
          name: data.name,
          address: data.address,
        },
      });

      // If contact details are provided, replace existing ones
      if (data.contactDetails) {
        await this.prisma.contactDetail.deleteMany({
          where: {
            siteOfficeId: data.id,
          },
        });

        await this.prisma.contactDetail.createMany({
          data: data.contactDetails.map((detail) => ({
            ...detail,
            siteOfficeId: data.id,
          })),
        });
      }

      // Return the updated site office with contact details
      return await this.prisma.siteOffice.findUnique({
        where: { id: data.id },
        include: {
          contactDetails: true,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteSiteOffice(siteOfficeId: string, organizationId: string) {
    try {
      const siteOffice = await this.prisma.siteOffice.findFirst({
        where: {
          id: siteOfficeId,
          customer: {
            organizationId,
          },
        },
      });

      if (!siteOffice) {
        throw new HttpException('Site office not found', HttpStatus.NOT_FOUND);
      }

      return await this.prisma.siteOffice.delete({
        where: { id: siteOfficeId },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

// SiteOffice CRUD methods
