import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { GetSupplierDto } from './dto/get-supplier.dto';
import { DeleteSupplierDto } from './dto/delete-supplier.dto';
import { PrismaService } from 'src/common/prisma.service';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async getSuppliers(getSupplierDto: GetSupplierDto, organizationId: string) {
    try {
      const { page, limit, search, filters } = getSupplierDto;
      const skip = (page - 1) * limit;
      const whereClause: any = { organizationId };

      if (search) {
        whereClause.OR = [
          { supplierCode: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (filters?.createdOn?.startDate || filters?.createdOn?.endDate) {
        whereClause.createdAt = {};
        if (filters.createdOn.startDate) {
          whereClause.createdAt.gte = new Date(filters.createdOn.startDate);
        }
        if (filters.createdOn.endDate) {
          whereClause.createdAt.lte = new Date(filters.createdOn.endDate);
        }
      }

      const suppliers = await this.prisma.supplier.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      });

      const totalDocs = await this.prisma.supplier.count({
        where: whereClause,
      });

      const hasNextPage = skip + suppliers.length < totalDocs;
      const hasPreviousPage = page > 1;

      return {
        docs: suppliers,
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

  async getSupplierById(id: string, organizationId: string) {
    try {
      return await this.prisma.supplier.findFirst({
        where: {
          id,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createSupplier(createSupplierDto: CreateSupplierDto, organizationId: string) {
    try {
      const supplierCode = await this.generateSupplierCode(createSupplierDto.name, organizationId);

      const newSupplier = await this.prisma.supplier.create({
        data: {
          ...createSupplierDto,
          supplierCode,
          organizationId,
        },
      });
      return newSupplier;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async generateSupplierCode(supplierName: string, organizationId: string): Promise<string> {
    const firstLetter = supplierName?.trim().charAt(0).toUpperCase() || 'X';
    const prefix = `S${firstLetter}`;

    const existingCount = await this.prisma.supplier.count({
      where: {
        organizationId,
        supplierCode: {
          startsWith: prefix,
        },
      },
    });

    const sequentialNumber = String(existingCount + 1).padStart(3, '0');
    return `${prefix}${sequentialNumber}`;
  }

  async updateSupplier(updateSupplierDto: UpdateSupplierDto, organizationId: string) {
    try {
      const supplier = await this.prisma.supplier.update({
        where: {
          id: updateSupplierDto.id,
          organizationId,
        },
        data: updateSupplierDto,
      });
      return supplier;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteSupplier(deleteSupplierDto: DeleteSupplierDto, organizationId: string) {
    try {
      const supplier = await this.prisma.supplier.delete({
        where: {
          id: deleteSupplierDto.id,
          organizationId,
        },
      });
      return supplier;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
