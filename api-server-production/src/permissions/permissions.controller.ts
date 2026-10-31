// src/permissions/permissions.controller.ts
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

// Round AW: the permission catalogue is shared by every org — only a platform
// admin (osirisadmin) changes it. Reading it stays as it was (the role editor lists it).
const platformOnly = (req: any) => {
  if (!req?.isOsirisAdmin) throw new ForbiddenException('Only Osiris can change the permission catalogue');
};

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @UseGuards(ClerkAuthGuard)
  @Permissions('permissions:create')
  create(@Body() createPermissionDto: CreatePermissionDto, @Req() req: any) {
    platformOnly(req);
    return this.permissionsService.create(createPermissionDto);
  }

  @Get()
  @UseGuards(ClerkAuthGuard)
  @Permissions('permissions:read')
  findAll() {
    return this.permissionsService.findAll();
  }

  @Get(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('permissions:read')
  findOne(@Param('id') id: string) {
    return this.permissionsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('permissions:update')
  update(@Param('id') id: string, @Body() updatePermissionDto: UpdatePermissionDto, @Req() req: any) {
    platformOnly(req);
    return this.permissionsService.update(id, updatePermissionDto);
  }

  @Delete(':id')
  @UseGuards(ClerkAuthGuard)
  @Permissions('permissions:delete')
  remove(@Param('id') id: string, @Req() req: any) {
    platformOnly(req);
    return this.permissionsService.remove(id);
  }
}
