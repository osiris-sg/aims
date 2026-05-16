import { HttpStatus, HttpException, Injectable } from '@nestjs/common';
import { GetAssetDto } from './dto/get-assets.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { PrismaService } from 'src/common/prisma.service';
import { DeleteAssetDto } from './dto/delete-asset.dto';
import { AdjustQuantityDto, AdjustmentType } from './dto/adjust-quantity.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  async getAssets(getAssetDto: GetAssetDto, userOrganizationId: string) {
    try {
      const { page, limit, search, filters, searchMode } = getAssetDto as any;
      const skip = (page - 1) * limit;

      const whereClause: any = {
        organizationId: userOrganizationId,
        deletedAt: null,
      };

      if (search) {
        if (searchMode === 'code') {
          whereClause.skuKey = { contains: search, mode: 'insensitive' };
        } else if (searchMode === 'description') {
          whereClause.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ];
        } else if (searchMode === 'category') {
          whereClause.category = { name: { contains: search, mode: 'insensitive' } };
        } else {
          whereClause.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { skuKey: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ];
        }
      }

      // Category filter - handle both string and array
      if (filters?.category) {
        if (Array.isArray(filters.category)) {
          // If it's an array with items, filter by those categories
          if (filters.category.length > 0) {
            whereClause.categoryId = { in: filters.category };
          }
          // If empty array, don't add any filter (show all)
        } else if (filters.category !== '') {
          // If it's a non-empty string, filter by that category
          whereClause.categoryId = filters.category;
        }
      }

      // Filter by tracking mode
      if (filters?.isTracked !== undefined) {
        whereClause.isTracked = filters.isTracked;
      }

      const assets = await this.prisma.asset.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
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
        // stockCount shows inventory count for tracked assets, quantity for untracked products
        stockCount: asset.isTracked ? asset.inventories.length : (asset.quantity ?? 0),
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
          uom: createAssetDto.uom || 'PCS',
          organizationId: userOrganizationId, // Automatically set user's organization
        },
      });

      // Find DO and RDO templates
      const templates = await this.prisma.documentTemplate.findMany({
        where: {
          type: { in: ['DO', 'RDO'] },
          organizationId: userOrganizationId,
        },
        select: { id: true },
      });

      // Create AssetTemplateTag entries
      await this.prisma.assetTemplateTag.createMany({
        data: templates.map((template) => ({
          assetId: asset.id,
          templateId: template.id,
        })),
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

  async getAssetByNfcUid(uid: string, userOrganizationId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { nfcTagUid: uid, organizationId: userOrganizationId, deletedAt: null },
      include: { category: { select: { id: true, name: true } } },
    });
    if (!asset) {
      throw new HttpException('No asset bound to this NFC tag', HttpStatus.NOT_FOUND);
    }
    return asset;
  }

  async bindNfcTag(assetId: string, uid: string, userOrganizationId: string) {
    if (!uid?.trim()) {
      throw new HttpException('NFC UID is required', HttpStatus.BAD_REQUEST);
    }
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, organizationId: userOrganizationId, deletedAt: null },
    });
    if (!asset) throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);

    if (asset.nfcTagUid === uid) return asset; // idempotent

    const conflict = await this.prisma.asset.findUnique({ where: { nfcTagUid: uid } });
    if (conflict && conflict.id !== assetId) {
      throw new HttpException(
        `NFC tag is already bound to asset ${conflict.skuKey}`,
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.asset.update({
      where: { id: assetId },
      data: { nfcTagUid: uid },
    });
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

  async getAssetsHierarchy(userOrganizationId: string) {
    try {
      // Get all root assets (no parent) with their complete hierarchy
      const rootAssets = await this.prisma.asset.findMany({
        where: {
          organizationId: userOrganizationId,
          deletedAt: null,
          parentAssetId: null, // Root assets only
        },
        include: {
          category: {
            select: { name: true },
          },
          inventories: {
            where: { status: 'instock' },
            select: { id: true },
          },
          subAssets: {
            where: { deletedAt: null },
            include: {
              category: { select: { name: true } },
              inventories: {
                where: { status: 'instock' },
                select: { id: true },
              },
              subAssets: {
                where: { deletedAt: null },
                include: {
                  category: { select: { name: true } },
                  inventories: {
                    where: { status: 'instock' },
                    select: { id: true },
                  },
                  subAssets: {
                    where: { deletedAt: null },
                    include: {
                      category: { select: { name: true } },
                      inventories: {
                        where: { status: 'instock' },
                        select: { id: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Transform to include inventory counts
      const transformAssetWithCounts = (asset: any): any => ({
        ...asset,
        instockInventoryCount: asset.inventories?.length || 0,
        subAssets: asset.subAssets?.map(transformAssetWithCounts) || [],
      });

      return rootAssets.map(transformAssetWithCounts);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAssetParts(assetId: string, userOrganizationId: string) {
    try {
      // Verify the asset exists and belongs to the user's organization
      const parentAsset = await this.prisma.asset.findFirst({
        where: {
          id: assetId,
          organizationId: userOrganizationId,
          deletedAt: null,
        },
      });

      if (!parentAsset) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      }

      // Get all direct parts of this asset with their sub-parts
      const parts = await this.prisma.asset.findMany({
        where: {
          parentAssetId: assetId,
          organizationId: userOrganizationId,
          deletedAt: null,
        },
        include: {
          category: {
            select: { name: true },
          },
          inventories: {
            where: { status: 'instock' },
            select: { id: true },
          },
          subAssets: {
            where: { deletedAt: null },
            include: {
              category: { select: { name: true } },
              inventories: {
                where: { status: 'instock' },
                select: { id: true },
              },
              subAssets: {
                where: { deletedAt: null },
                include: {
                  category: { select: { name: true } },
                  inventories: {
                    where: { status: 'instock' },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Transform to include inventory counts
      const transformAssetWithCounts = (asset: any): any => ({
        ...asset,
        instockInventoryCount: asset.inventories?.length || 0,
        subAssets: asset.subAssets?.map(transformAssetWithCounts) || [],
      });

      return parts.map(transformAssetWithCounts);
    } catch (error) {
      throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async updateAssetParent(assetId: string, parentAssetId: string | null, userOrganizationId: string) {
    try {
      // Verify the asset exists and belongs to the user's organization
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: assetId,
          organizationId: userOrganizationId,
          deletedAt: null,
        },
      });

      if (!asset) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      }

      // If setting a parent, verify the parent exists and prevent circular references
      if (parentAssetId) {
        const parentAsset = await this.prisma.asset.findFirst({
          where: {
            id: parentAssetId,
            organizationId: userOrganizationId,
            deletedAt: null,
          },
        });

        if (!parentAsset) {
          throw new HttpException('Parent asset not found', HttpStatus.NOT_FOUND);
        }

        // Check for circular reference by walking up the parent chain
        await this.checkCircularReference(assetId, parentAssetId, userOrganizationId);
      }

      // Update the asset's parent
      const updatedAsset = await this.prisma.asset.update({
        where: { id: assetId },
        data: { parentAssetId },
        include: {
          parentAsset: {
            select: { id: true, name: true, skuKey: true },
          },
          subAssets: {
            select: { id: true, name: true, skuKey: true },
          },
        },
      });

      return updatedAsset;
    } catch (error) {
      throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAssetAncestors(assetId: string, userOrganizationId: string) {
    try {
      const ancestors = [];
      let currentAssetId = assetId;

      while (currentAssetId) {
        const asset = await this.prisma.asset.findFirst({
          where: {
            id: currentAssetId,
            organizationId: userOrganizationId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            skuKey: true,
            parentAssetId: true,
          },
        });

        if (!asset) break;

        if (asset.id !== assetId) {
          // Don't include the asset itself
          ancestors.unshift(asset); // Add to beginning to maintain order
        }

        currentAssetId = asset.parentAssetId;
      }

      return ancestors;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getAssetDescendants(assetId: string, userOrganizationId: string) {
    try {
      // Get all descendants recursively
      const getDescendantsRecursive = async (parentId: string): Promise<any[]> => {
        const children = await this.prisma.asset.findMany({
          where: {
            parentAssetId: parentId,
            organizationId: userOrganizationId,
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            skuKey: true,
            parentAssetId: true,
          },
        });

        const descendants = [];
        for (const child of children) {
          descendants.push(child);
          const childDescendants = await getDescendantsRecursive(child.id);
          descendants.push(...childDescendants);
        }

        return descendants;
      };

      return await getDescendantsRecursive(assetId);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async checkCircularReference(assetId: string, proposedParentId: string, userOrganizationId: string) {
    const descendants = await this.getAssetDescendants(assetId, userOrganizationId);
    const descendantIds = descendants.map((d) => d.id);

    if (descendantIds.includes(proposedParentId)) {
      throw new HttpException('Cannot set parent: This would create a circular reference', HttpStatus.BAD_REQUEST);
    }
  }

  async canSwitchTrackingMode(assetId: string, userOrganizationId: string) {
    try {
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: assetId,
          organizationId: userOrganizationId,
          deletedAt: null,
        },
        include: {
          inventories: {
            select: { id: true },
          },
        },
      });

      if (!asset) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      }

      // Can always switch from untracked to tracked
      // Can only switch from tracked to untracked if there are no inventory items
      const canSwitch = !asset.isTracked || asset.inventories.length === 0;
      const reason = !canSwitch
        ? 'Cannot switch to untracked mode: Asset has existing inventory items. Remove all inventory items first.'
        : null;

      return {
        canSwitch,
        reason,
        currentMode: asset.isTracked ? 'tracked' : 'untracked',
        inventoryCount: asset.inventories.length,
      };
    } catch (error) {
      throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async adjustQuantity(adjustQuantityDto: AdjustQuantityDto, userOrganizationId: string, adjustedBy: string) {
    try {
      const { assetId, amount, type, reason } = adjustQuantityDto;

      // Get the asset and verify it's untracked
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: assetId,
          organizationId: userOrganizationId,
          deletedAt: null,
        },
      });

      if (!asset) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      }

      if (asset.isTracked) {
        throw new HttpException('Cannot adjust quantity for tracked assets. Use inventory management instead.', HttpStatus.BAD_REQUEST);
      }

      const previousQty = asset.quantity ?? 0;
      let newQty: number;

      switch (type) {
        case AdjustmentType.ADD:
          newQty = previousQty + amount;
          break;
        case AdjustmentType.SUBTRACT:
          newQty = previousQty - amount;
          if (newQty < 0) {
            throw new HttpException('Quantity cannot go below zero', HttpStatus.BAD_REQUEST);
          }
          break;
        case AdjustmentType.SET:
          newQty = amount;
          break;
        default:
          throw new HttpException('Invalid adjustment type', HttpStatus.BAD_REQUEST);
      }

      // Use transaction to update quantity and create history record
      const result = await this.prisma.$transaction(async (tx) => {
        // Update the asset quantity
        const updatedAsset = await tx.asset.update({
          where: { id: assetId },
          data: { quantity: newQty },
        });

        // Create quantity adjustment history record
        const adjustment = await tx.quantityAdjustment.create({
          data: {
            assetId,
            previousQty,
            newQty,
            adjustmentType: type,
            amount,
            reason,
            adjustedBy,
            organizationId: userOrganizationId,
          },
        });

        return { asset: updatedAsset, adjustment };
      });

      return result;
    } catch (error) {
      throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getQuantityHistory(assetId: string, userOrganizationId: string, page = 1, limit = 20) {
    try {
      // Verify asset exists and belongs to org
      const asset = await this.prisma.asset.findFirst({
        where: {
          id: assetId,
          organizationId: userOrganizationId,
          deletedAt: null,
        },
      });

      if (!asset) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
      }

      const skip = (page - 1) * limit;

      const [adjustments, totalDocs] = await Promise.all([
        this.prisma.quantityAdjustment.findMany({
          where: {
            assetId,
            organizationId: userOrganizationId,
          },
          orderBy: { adjustedAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.quantityAdjustment.count({
          where: {
            assetId,
            organizationId: userOrganizationId,
          },
        }),
      ]);

      return {
        docs: adjustments,
        hasNextPage: skip + adjustments.length < totalDocs,
        hasPreviousPage: page > 1,
        page,
        limit,
        totalPagesCount: Math.ceil(totalDocs / limit),
        totalDocuments: totalDocs,
      };
    } catch (error) {
      throw new HttpException(error.message, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
