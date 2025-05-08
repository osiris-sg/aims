import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { DeleteInventoryDto } from './dto/delete-inventory.dto';
import { GetInventoryDto } from './dto/get-inventory.dto';
import * as QRCode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/common/prisma.service';

@Injectable()
export class InventoriesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async getInventories(getInventoryDto: GetInventoryDto) {
    try {
      const { page, limit, search, organizationId, filters } = getInventoryDto;

      const skip = (page - 1) * limit;

      console.log('received category:', filters?.category);

      const whereClause: any = { organizationId };

      // Search filter
      if (search) {
        whereClause.OR = [
          { sku: { contains: search, mode: 'insensitive' } },
          { asset: { name: { contains: search, mode: 'insensitive' } } },
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

      // Status filter
      if (filters?.status && filters.status !== '') {
        whereClause.status = filters.status;
      }

      // Category filter
      if (filters?.category && filters.category !== '') {
        whereClause.category = filters.category;
      }

      const docs = await this.prisma.inventory.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      const totalDocs = await this.prisma.inventory.count({ where: whereClause });

      return {
        docs,
        hasNextPage: skip + docs.length < totalDocs,
        hasPreviousPage: page > 1,
        page,
        limit,
        totalPagesCount: Math.ceil(totalDocs / limit),
        totalDocuments: totalDocs,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoriesByStatus(organizationId: string, status?: string) {
    try {
      const inventories = await this.prisma.inventory.findMany({
        where: {
          organizationId,
          ...(status && {
            status: {
              equals: status,
              mode: 'insensitive',
            },
          }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return inventories;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoryById(id: string) {
    try {
      return await this.prisma.inventory.findUnique({ where: { id } });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoryBySku(sku: string) {
    try {
      return await this.prisma.inventory.findFirst({ where: { sku } });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoriesByAsset(assetId: string) {
    try {
      const inventories = await this.prisma.inventory.findMany({
        where: { assetId },
        orderBy: { createdAt: 'desc' },
      });

      const statusCounts = inventories.reduce(
        (counts, inventory) => {
          if (inventory.status) {
            counts[inventory.status] = (counts[inventory.status] || 0) + 1;
          }
          return counts;
        },
        { INSTOCK: 0, RENTAL: 0, RESERVED: 0, MAINTAINANCE: 0, SOLD: 0 },
      );

      return { inventories, statusCounts };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoriesByIds({ inventoryIds }: { inventoryIds: string[] }) {
    try {
      return await this.prisma.inventory.findMany({
        where: { id: { in: inventoryIds } },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async generateSkuRange(assetId: string, quantity: number, organizationId: string) {
    try {
      const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
      if (!asset) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      }

      const skuKey = asset.skuKey || 'INV';

      const lastInventory = await this.prisma.inventory.findFirst({
        where: { assetId, organizationId, sku: { startsWith: `${skuKey}-` } },
        orderBy: { sku: 'desc' },
      });

      let startSkuNumber = 1;
      if (lastInventory && lastInventory.sku) {
        const lastSkuNumber = parseInt(lastInventory.sku.split('-').pop(), 10);
        if (!isNaN(lastSkuNumber)) {
          startSkuNumber = lastSkuNumber + 1;
        }
      }

      return Array.from({ length: quantity }, (_, i) => `${skuKey}-${(startSkuNumber + i).toString().padStart(3, '0')}`);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createInventories(createInventoryDto: CreateInventoryDto) {
    try {
      const { assetId, quantity, organizationId, status } = createInventoryDto;
      const skuRange = await this.generateSkuRange(assetId, quantity, organizationId);

      const inventoryItems = skuRange.map((sku) => ({
        ...createInventoryDto,
        assetId,
        sku,
        status,
      }));

      const createdItems = await this.prisma.inventory.createMany({
        data: inventoryItems,
        skipDuplicates: true,
      });

      return { createdItems, skuRange, inventoryItems };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async updateInventories(updateInventoryDto: UpdateInventoryDto) {
    try {
      return await this.prisma.inventory.update({
        where: { id: updateInventoryDto.id },
        data: updateInventoryDto,
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteInventories(deleteInventoryDto: DeleteInventoryDto) {
    try {
      return await this.prisma.inventory.delete({
        where: { id: deleteInventoryDto.id },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async generateQRCode(sku: string) {
    try {
      const baseUrl = this.configService.get<string>('APP_URL');
      const itemUrl = `${baseUrl}/scan/${sku}`;
      return { qrCode: await QRCode.toDataURL(itemUrl) };
    } catch (error) {
      throw new HttpException(`QR Code generation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
