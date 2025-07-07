import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { DeleteCategoryDto } from './dto/delete-category.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Request } from 'express';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@ApiTags('categories')
@Controller('categories')
@UseGuards(ClerkAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post('create')
  @Permissions('categories:create')
  async create(@Body() createCategoryDto: CreateCategoryDto, @Req() req: RequestWithOrganization) {
    console.log('Body:', createCategoryDto);
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.categoriesService.create(createCategoryDto, organizationId);
  }

  @Get()
  @Permissions('categories:read')
  async findAll(@Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.categoriesService.findAll(organizationId);
  }

  @Get(':id')
  @Permissions('categories:read-one')
  async findOne(@Param('id') id: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.categoriesService.findOne(id, organizationId);
  }

  @Patch(':id')
  @Permissions('categories:update')
  async update(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.categoriesService.update(id, updateCategoryDto, organizationId);
  }

  @Delete('delete')
  @Permissions('categories:delete')
  async deleteCategory(@Body() deleteCategoryDto: DeleteCategoryDto, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.categoriesService.deleteCategory(deleteCategoryDto, organizationId);
  }
}
