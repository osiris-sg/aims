// src/permissions/permissions.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async create(createPermissionDto: CreatePermissionDto) {
    return this.prisma.permission.create({
      data: createPermissionDto,
    });
  }

  async findAll() {
    return this.prisma.permission.findMany();
  }

  async findOne(id: string) {
    return this.prisma.permission.findUnique({
      where: { id },
    });
  }

  async update(id: string, updatePermissionDto: UpdatePermissionDto) {
    return this.prisma.permission.update({
      where: { id },
      data: updatePermissionDto,
    });
  }

  async remove(id: string) {
    return this.prisma.permission.delete({
      where: { id },
    });
  }
}