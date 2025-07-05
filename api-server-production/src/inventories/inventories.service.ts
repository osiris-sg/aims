import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { DeleteInventoryDto } from './dto/delete-inventory.dto';
import { GetInventoryDto } from './dto/get-inventory.dto';
import * as QRCode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/common/prisma.service';
import { InventoryStatus } from '@prisma/client';

@Injectable()
export class InventoriesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async getInventories(getInventoryDto: GetInventoryDto, organizationId: string) {
    try {
      const { page, limit, search, filters } = getInventoryDto;

      const skip = (page - 1) * limit;

      console.log('received category:', filters?.category);

      const whereClause: any = { organizationId };

      // Search filter
      if (search) {
        whereClause.OR = [{ sku: { contains: search, mode: 'insensitive' } }, { asset: { name: { contains: search, mode: 'insensitive' } } }];
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
      if (filters?.status !== undefined && filters.status !== null) {
        whereClause.status = filters.status as InventoryStatus;
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
            status: status as InventoryStatus,
          }),
        },
        orderBy: { createdAt: 'desc' },
      });
      return inventories;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoryById(id: string, organizationId: string) {
    try {
      return await this.prisma.inventory.findFirst({
        where: {
          id,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoryBySku(sku: string, organizationId: string) {
    try {
      return await this.prisma.inventory.findFirst({
        where: {
          sku,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoriesByAsset(assetId: string, organizationId: string) {
    try {
      const inventories = await this.prisma.inventory.findMany({
        where: {
          assetId,
          organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });

      const statusCounts = inventories.reduce(
        (counts, inventory) => {
          if (inventory.status) {
            counts[inventory.status] = (counts[inventory.status] || 0) + 1;
          }
          return counts;
        },
        {
          [InventoryStatus.instock]: 0,
          [InventoryStatus.rental]: 0,
          [InventoryStatus.reserved]: 0,
          [InventoryStatus.maintenance]: 0,
          [InventoryStatus.sold]: 0,
        },
      );
      return { inventories, statusCounts };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getInventoriesByIds({ inventoryIds }: { inventoryIds: string[] }, organizationId: string) {
    try {
      return await this.prisma.inventory.findMany({
        where: {
          id: { in: inventoryIds },
          organizationId,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async generateSkuRange(assetId: string, quantity: number, organizationId: string) {
    try {
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: assetId,
          organizationId,
        },
      });
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

  async createInventories(createInventoryDto: CreateInventoryDto, organizationId: string) {
    try {
      const { assetId, quantity, status } = createInventoryDto;
      const skuRange = await this.generateSkuRange(assetId, quantity, organizationId);

      const inventoryItems = skuRange.map((sku) => ({
        ...createInventoryDto,
        assetId,
        sku,
        organizationId, // Automatically assign to user's organization
        status: status as InventoryStatus,
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

  async updateInventories(updateInventoryDto: UpdateInventoryDto, organizationId: string) {
    try {
      return await this.prisma.inventory.update({
        where: {
          id: updateInventoryDto.id,
          organizationId, // Ensure user can only update inventories in their organization
        },
        data: {
          ...updateInventoryDto,
          status: updateInventoryDto.status as InventoryStatus,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteInventories(deleteInventoryDto: DeleteInventoryDto, organizationId: string) {
    try {
      return await this.prisma.inventory.delete({
        where: {
          id: deleteInventoryDto.id,
          organizationId, // Ensure user can only delete inventories in their organization
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async generateQRCode(sku: string, organizationId: string) {
    try {
      // Verify the inventory belongs to the user's organization
      const inventory = await this.prisma.inventory.findFirst({
        where: {
          sku,
          organizationId,
        },
      });

      if (!inventory) {
        throw new HttpException('Inventory not found', HttpStatus.NOT_FOUND);
      }

      const baseUrl = this.configService.get<string>('APP_URL');
      const itemUrl = `${baseUrl}/scan/${sku}`;
      return { qrCode: await QRCode.toDataURL(itemUrl) };
    } catch (error) {
      throw new HttpException(`QR Code generation failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
