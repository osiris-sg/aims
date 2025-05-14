// src/users/users.controller.ts
import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':userId/roles')
  @UseGuards(ClerkAuthGuard)
  @Permissions('users:assign-role')
  assignRole(
    @Param('userId') userId: string,
    @Body() body: { roleId: string },
  ) {
    return this.usersService.assignRoleToUser(userId, body.roleId);
  }

  @Delete(':userId/roles/:roleId')
  @UseGuards(ClerkAuthGuard)
  @Permissions('users:remove-role')
  removeRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ) {
    return this.usersService.removeRoleFromUser(userId, roleId);
  }

  @Get(':userId/roles')
  @UseGuards(ClerkAuthGuard)
  @Permissions('users:read-roles')
  getUserRoles(@Param('userId') userId: string) {
    return this.usersService.getUserRoles(userId);
  }
}