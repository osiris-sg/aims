// src/roles/roles.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  async create(createRoleDto: CreateRoleDto) {
    const { permissionIds, ...roleData } = createRoleDto;
    
    return this.prisma.role.create({
      data: {
        ...roleData,
        permissions: permissionIds?.length 
          ? {
              connect: permissionIds.map(id => ({ id })),
            }
          : undefined,
      },
      include: {
        permissions: true,
      },
    });
  }

  async findAll() {
    return this.prisma.role.findMany({
      include: {
        permissions: true,
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.role.findUnique({
      where: { id },
      include: {
        permissions: true,
      },
    });
  }

  async findByName(name: string) {
    return this.prisma.role.findUnique({
      where: { name },
      include: {
        permissions: true,
      },
    });
  }

  async update(id: string, updateRoleDto: UpdateRoleDto) {
    const { permissionIds, ...roleData } = updateRoleDto;
    
    return this.prisma.role.update({
      where: { id },
      data: {
        ...roleData,
        permissions: permissionIds
          ? {
              set: permissionIds.map(id => ({ id })),
            }
          : undefined,
      },
      include: {
        permissions: true,
      },
    });
  }

  async remove(id: string) {
    return this.prisma.role.delete({
      where: { id },
    });
  }
}