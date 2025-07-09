// src/roles/roles.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @UseGuards(ClerkAuthGuard)
  @Permissions('roles:create')
  create(@Body() createRoleDto: CreateRoleDto, @UserOrganization() userOrganization: any) {
    return this.rolesService.create(createRoleDto, userOrganization.id);
  }

  @Get()
  @UseGuards(ClerkAuthGuard)
  @Permissions('roles:read')
  findAll(@Query() query: any, @UserOrganization() userOrganization: any) {
    return this.rolesService.findAll(query, userOrganization.id);
  }

  @Get(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('roles:read')
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('roles:update')
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.rolesService.update(id, updateRoleDto);
  }

  @Delete(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('roles:delete')
  remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }
}
