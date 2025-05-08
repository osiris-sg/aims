import { HttpStatus, HttpException, Injectable } from '@nestjs/common';
import { GetAssetDto } from './dto/get-assets.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { PrismaService } from 'src/common/prisma.service';
import { DeleteAssetDto } from './dto/delete-asset.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  async getAssets(getAssetDto: GetAssetDto) {
    try {
      const { organizationId, page, limit, search, filters } = getAssetDto;
      const skip = (page - 1) * limit;

      const whereClause: any = { organizationId };

      if (search) {
        whereClause.OR = [{ name: { contains: search, mode: 'insensitive' } }, { skuKey: { contains: search, mode: 'insensitive' } }];
      }

      // Status filter
      if (filters?.status && filters.status !== '') {
        whereClause.status = filters.status;
      }

      // Category filter
      if (filters?.category && filters.category !== '') {
        whereClause.categoryId = filters.category;
      }

      // TODO: Check Instock status here

      const assets = await this.prisma.asset.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          inventories: {
            where: {
              status: 'INSTOCK', // Change this to match your "in stock" logic
            },
            select: {
              id: true, // we only need this to count manually
            },
          },
        },
      });

      const assetsWithInStockCount = assets.map((asset) => ({
        ...asset,
        inStockInventoryCount: asset.inventories.length,
      }));

      const totalDocs = await this.prisma.asset.count({ where: whereClause });

      return {
        docs: assetsWithInStockCount,
        hasNextPage: skip + assets.length < totalDocs,
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

  async getAssetBySKUKEY(skuKey: string) {
    try {
      const asset = await this.prisma.asset.findUnique({ where: { skuKey } });
      if (!asset) throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      return asset;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAssetById(id: string) {
    try {
      const asset = await this.prisma.asset.findUnique({ where: { id } });
      if (!asset) throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      return asset;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createAssets(createAssetDto: CreateAssetDto) {
    try {
      const asset = await this.prisma.asset.create({
        data: createAssetDto,
      });
      return asset;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Handle unique constraint failure (P2002)
        if (error.code === 'P2002') {
          const target = (error.meta?.target as string[])?.join(', ') || 'field';
          throw new HttpException(`Asset with the same ${target} already exists.`, HttpStatus.BAD_REQUEST);
        }
      }

      // Default error
      throw new HttpException('An unexpected error occurred while creating the asset.', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateAssets(updateAssetDto: UpdateAssetDto) {
    try {
      const { id, ...updateData } = updateAssetDto;

      if (!id) {
        throw new HttpException('Asset ID is required', HttpStatus.BAD_REQUEST);
      }

      const asset = await this.prisma.asset.update({
        where: { id },
        data: updateData,
      });

      return asset;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteAssets(deleteAssetDto: DeleteAssetDto) {
    try {
      const assetInInventory = await this.prisma.inventory.count({
        where: { assetId: deleteAssetDto.id },
      });

      if (assetInInventory > 0) {
        throw new HttpException('This asset is associated with an inventory record. Remove the association and try again.', HttpStatus.BAD_REQUEST);
      }

      const asset = await this.prisma.asset.delete({ where: { id: deleteAssetDto.id } });
      return asset;
    } catch (error) {
      throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async checkSkuKey(skuKey: string): Promise<{ isAvailable: boolean }> {
    try {
      const asset = await this.prisma.asset.findUnique({ where: { skuKey } });

      // If the asset exists, the SKU key is not available
      if (asset) {
        return { isAvailable: false };
      } else {
        return { isAvailable: true };
      }
    } catch {
      throw new HttpException('An error occurred while checking the SKU key', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
