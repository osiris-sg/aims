import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateCustomerDto, CustomerContactDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { GetCustomerDto } from './dto/get-customer.dto';
import { DeleteCustomerDto } from './dto/delete-customer.dto';
import { PrismaService } from 'src/common/prisma.service';
import { CreateSiteOfficeDto } from './dto/create-site-office.dto';
import { UpdateSiteOfficeDto } from './dto/update-site-office-dto';
import { createClerkClient } from '@clerk/backend';

@Injectable()
export class CustomersService {
  private clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  constructor(private prisma: PrismaService) {}

  async getCustomers(getCustomerDto: GetCustomerDto, organizationId: string) {
    try {
      const { page, limit, search, filters } = getCustomerDto;
      const skip = (page - 1) * limit;
      const whereClause: any = { organizationId };

      // Search filter
      if (search) {
        whereClause.OR = [
          { customerCode: { contains: search, mode: 'insensitive' } },
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
        include: {
          salesman: true,
          contacts: true,
        },
      });

      // Enrich customers with salesman names from Clerk
      const customersWithSalesmanNames = await Promise.all(
        customers.map(async (customer) => {
          if (customer.salesman) {
            let salesmanName = customer.salesman.salesmanCode || 'Unknown';
            try {
              const clerkUser = await this.clerkClient.users.getUser(customer.salesman.userId);
              salesmanName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || clerkUser.username || customer.salesman.salesmanCode || 'Unknown';
            } catch (error) {
              console.error(`Error fetching Clerk user ${customer.salesman.userId}:`, error);
            }
            return {
              ...customer,
              salesman: {
                ...customer.salesman,
                name: salesmanName,
              },
            };
          }
          return customer;
        })
      );

      const totalDocs = await this.prisma.customer.count({
        where: whereClause,
      });

      const hasNextPage = skip + customersWithSalesmanNames.length < totalDocs;
      const hasPreviousPage = page > 1;

      return {
        docs: customersWithSalesmanNames,
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
        include: {
          salesman: true,
          contacts: { orderBy: { createdAt: 'asc' } },
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createCustomers(createCustomerDto: CreateCustomerDto, organizationId: string) {
    try {
      console.log('Creating customer with data:', createCustomerDto, 'and organizationId:', organizationId);

      // Generate customer code: C + first letter of name + 3-digit sequential number
      const customerCode = await this.generateCustomerCode(createCustomerDto.name, organizationId);

      const { contacts, ...customerData } = createCustomerDto;
      const cleanContacts = (contacts || []).filter(
        (c) => c.name && c.name.trim() !== '',
      );

      const newCustomer = await this.prisma.customer.create({
        data: {
          ...customerData,
          customerCode,
          organizationId, // Automatically assign to user's organization
          ...(cleanContacts.length > 0
            ? {
                contacts: {
                  create: cleanContacts.map((c) => ({
                    name: c.name,
                    phone: c.phone ?? null,
                    email: c.email ?? null,
                    designation: c.designation ?? null,
                    isPrimary: !!c.isPrimary,
                  })),
                },
              }
            : {}),
        },
        include: { contacts: true },
      });
      return newCustomer;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Generate customer code in format: C + first letter of name + 3-digit sequential number
   * Example: CA001, CA002, CB001, etc.
   */
  private async generateCustomerCode(customerName: string, organizationId: string): Promise<string> {
    // Get the first letter of the customer name (uppercase), default to 'X' if empty
    const firstLetter = customerName?.trim().charAt(0).toUpperCase() || 'X';
    const prefix = `C${firstLetter}`;

    // Count existing customers with the same prefix in this organization
    const existingCount = await this.prisma.customer.count({
      where: {
        organizationId,
        customerCode: {
          startsWith: prefix,
        },
      },
    });

    // Generate the sequential number (3 digits, padded with zeros)
    const sequentialNumber = String(existingCount + 1).padStart(3, '0');

    return `${prefix}${sequentialNumber}`;
  }

  async updateCustomers(updateCustomerDto: UpdateCustomerDto, organizationId: string) {
    try {
      const { id, contacts, ...customerData } = updateCustomerDto;

      await this.prisma.customer.update({
        where: {
          id,
          organizationId, // Ensure user can only update customers in their organization
        },
        data: customerData,
      });

      // When contacts are provided, replace the customer's POC list wholesale
      // (mirrors the site-office contactDetails replace-on-update pattern).
      if (contacts) {
        await this.prisma.customerContact.deleteMany({ where: { customerId: id } });
        const cleanContacts = contacts.filter(
          (c) => c.name && c.name.trim() !== '',
        );
        if (cleanContacts.length > 0) {
          await this.prisma.customerContact.createMany({
            data: cleanContacts.map((c) => ({
              name: c.name,
              phone: c.phone ?? null,
              email: c.email ?? null,
              designation: c.designation ?? null,
              isPrimary: !!c.isPrimary,
              customerId: id,
            })),
          });
        }
      }

      return await this.prisma.customer.findFirst({
        where: { id, organizationId },
        include: { contacts: { orderBy: { createdAt: 'asc' } } },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Create a single Point-of-Contact for an existing customer (additive).
  // Tenant-guarded: the customer must belong to the caller's organization.
  async createCustomerContact(
    customerId: string,
    dto: CustomerContactDto,
    organizationId: string,
  ) {
    try {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, organizationId },
        select: { id: true },
      });
      if (!customer) {
        throw new HttpException('Customer not found', HttpStatus.NOT_FOUND);
      }
      if (!dto.name || dto.name.trim() === '') {
        throw new HttpException('Contact name is required', HttpStatus.BAD_REQUEST);
      }
      return await this.prisma.customerContact.create({
        data: {
          name: dto.name,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          designation: dto.designation ?? null,
          isPrimary: !!dto.isPrimary,
          customerId,
        },
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
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

  /**
   * Get all salesmen (users with salesmanCode) in the organization
   */
  async getSalesmen(organizationId: string) {
    try {
      const salesmen = await this.prisma.userOrganization.findMany({
        where: {
          organizationId,
          isActive: true,
          salesmanCode: {
            not: null,
          },
        },
        orderBy: {
          salesmanCode: 'asc',
        },
      });

      // Fetch user details from Clerk for each salesman
      const salesmenWithNames = await Promise.all(
        salesmen.map(async (s) => {
          let name = s.salesmanCode || 'Unknown';
          try {
            const clerkUser = await this.clerkClient.users.getUser(s.userId);
            name = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || clerkUser.username || s.salesmanCode || 'Unknown';
          } catch (error) {
            console.error(`Error fetching Clerk user ${s.userId}:`, error);
          }
          return {
            id: s.id,
            salesmanCode: s.salesmanCode,
            userId: s.userId,
            name,
          };
        })
      );

      return salesmenWithNames;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
