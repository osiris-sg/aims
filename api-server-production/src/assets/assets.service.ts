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

  async getAssets(getAssetDto: GetAssetDto, userOrganizationId: string) {
    try {
      const { page, limit, search, filters } = getAssetDto;
      const skip = (page - 1) * limit;

      const whereClause: any = {
        organizationId: userOrganizationId, // Use user's organization
        deletedAt: null,
      };

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

      // TODO: Check instock status here

      const assets = await this.prisma.asset.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          inventories: {
            where: {
              status: 'instock', // Change this to match your "in stock" logic
            },
            select: {
              id: true, // we only need this to count manually
            },
          },
        },
      });

      const assetsWithinstockCount = assets.map((asset) => ({
        ...asset,
        instockInventoryCount: asset.inventories.length,
      }));

      const totalDocs = await this.prisma.asset.count({ where: whereClause });

      return {
        docs: assetsWithinstockCount,
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

  async getAssetBySKUKEY(skuKey: string, userOrganizationId: string) {
    try {
      const asset = await this.prisma.asset.findFirst({
        where: {
          skuKey,
          organizationId: userOrganizationId, // Use user's organization
          deletedAt: null,
        },
      });
      if (!asset) throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      return asset;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAssetById(id: string, userOrganizationId: string) {
    try {
      const asset = await this.prisma.asset.findFirst({
        where: {
          id,
          organizationId: userOrganizationId, // Use user's organization
        },
      });
      if (!asset) throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      return asset;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createAssets(createAssetDto: CreateAssetDto, userOrganizationId: string) {
    try {
      const asset = await this.prisma.asset.create({
        data: {
          ...createAssetDto,
          organizationId: userOrganizationId, // Automatically set user's organization
        },
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

  async updateAssets(updateAssetDto: UpdateAssetDto, userOrganizationId: string) {
    try {
      const { id, ...updateData } = updateAssetDto;

      if (!id) {
        throw new HttpException('Asset ID is required', HttpStatus.BAD_REQUEST);
      }

      const asset = await this.prisma.asset.update({
        where: {
          id,
          organizationId: userOrganizationId, // Ensure user can only update their organization's assets
        },
        data: updateData,
      });

      return asset;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async deleteAssets(deleteAssetDto: DeleteAssetDto, userOrganizationId: string) {
    try {
      const assetInInventory = await this.prisma.inventory.count({
        where: { assetId: deleteAssetDto.id },
      });

      if (assetInInventory > 0) {
        throw new HttpException('This asset is associated with an inventory record. Remove the association and try again.', HttpStatus.BAD_REQUEST);
      }

      const asset = await this.prisma.asset.update({
        where: {
          id: deleteAssetDto.id,
          organizationId: userOrganizationId, // Ensure user can only delete their organization's assets
        },
        data: { deletedAt: new Date() },
      });
      return asset;
    } catch (error) {
      throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async checkSkuKey(skuKey: string, userOrganizationId: string): Promise<{ isAvailable: boolean }> {
    try {
      const asset = await this.prisma.asset.findFirst({
        where: {
          skuKey,
          organizationId: userOrganizationId, // Check within user's organization
          deletedAt: null,
        },
      });

      // If the asset exists, the SKU key is not available
      if (asset) {
        console.log('Asset found', asset, 'SKU KEY SUBMITTED:', skuKey);
        return { isAvailable: false };
      } else {
        console.log('SKU KEY SUBMITTED:', skuKey);
        return { isAvailable: true };
      }
    } catch {
      throw new HttpException('An error occurred while checking the SKU key', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
