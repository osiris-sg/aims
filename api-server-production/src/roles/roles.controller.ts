// src/roles/roles.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @UseGuards(ClerkAuthGuard)
  @Permissions('roles:create')
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.create(createRoleDto);
  }

  @Get()
  @UseGuards(ClerkAuthGuard)
  @Permissions('roles:read')
  findAll() {
    return this.rolesService.findAll();
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