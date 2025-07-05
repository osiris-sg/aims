import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { DeleteCategoryDto } from './dto/delete-category.dto';
import { PrismaService } from 'src/common/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto, organizationId: string) {
    console.log('Create Category DTO:', createCategoryDto);
    try {
      return await this.prisma.category.create({
        data: {
          ...createCategoryDto,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findAll(organizationId: string) {
    return await this.prisma.category.findMany({
      where: { organizationId },
    });
  }

  async findOne(id: string, organizationId: string) {
    return await this.prisma.category.findFirst({
      where: {
        id,
        organizationId,
      },
    });
  }

  async findByOrganization(organizationId: string) {
    return await this.prisma.category.findMany({
      where: { organizationId },
    });
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto, organizationId: string) {
    try {
      return await this.prisma.category.update({
        where: {
          id,
          organizationId,
        },
        data: updateCategoryDto,
      });
    } catch (error) {
      throw new HttpException('Category not found', HttpStatus.NOT_FOUND);
    }
  }

  async deleteCategory(deleteCategoryDto: DeleteCategoryDto, organizationId: string) {
    try {
      const assetCount = await this.prisma.asset.count({
        where: {
          categoryId: deleteCategoryDto.id,
          organizationId,
        },
      });

      if (assetCount > 0) {
        throw new HttpException('This category is assigned to an asset. Remove the asset association and try again.', HttpStatus.BAD_REQUEST);
      }

      return await this.prisma.category.delete({
        where: {
          id: deleteCategoryDto.id,
          organizationId,
        },
      });
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
