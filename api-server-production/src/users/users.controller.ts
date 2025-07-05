// src/users/users.controller.ts
import { Controller, Get, Post, Delete, Patch, Param, Body, UseGuards, Query, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { GetUsersDto } from './dto/get-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Request } from 'express';

// Extend Request type to include userOrganization
interface RequestWithOrganization extends Request {
  userOrganization?: {
    id: string;
    name: string;
  };
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':userId/roles')
  @UseGuards(ClerkAuthGuard)
  @Permissions('users:assign-role')
  assignRole(@Param('userId') userId: string, @Body() body: { roleId: string }, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.usersService.assignRoleToUser(userId, body.roleId, organizationId);
  }

  @Delete(':userId/roles/:roleId')
  @UseGuards(ClerkAuthGuard)
  @Permissions('users:remove-role')
  removeRole(@Param('userId') userId: string, @Param('roleId') roleId: string, @Req() req: RequestWithOrganization) {
    const organizationId = req.userOrganization?.id;
    if (!organizationId) {
      throw new Error('User is not assigned to any organization');
    }
    return this.usersService.removeRoleFromUser(userId, roleId, organizationId);
  }

  @Get(':userId/roles')
  @UseGuards(ClerkAuthGuard)
  @Permissions('users:read-roles')
  getUserRoles(@Param('userId') userId: string) {
    return this.usersService.getUserRoles(userId);
  }

  @Post()
  // @UseGuards(ClerkAuthGuard)
  // @Permissions('users:create')
  @ApiOperation({ summary: 'Create a new user with role assignments' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  @ApiBody({ type: CreateUserDto })
  createUser(@Body() createUserDto: CreateUserDto, @Req() req: RequestWithOrganization) {
    // If organizationId is not provided in DTO, get it from user's organization
    if (!createUserDto.organizationId) {
      createUserDto.organizationId = req.userOrganization?.id;
    }
    return this.usersService.createUser(createUserDto);
  }

  @Patch(':userId')
  // @UseGuards(ClerkAuthGuard)
  // @Permissions('users:update')
  @ApiOperation({ summary: 'Update user information and role assignments' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'userId', description: 'The Clerk user ID to update' })
  @ApiBody({ type: UpdateUserDto })
  updateUser(@Param('userId') userId: string, @Body() updateUserDto: UpdateUserDto, @Req() req: RequestWithOrganization) {
    // If organizationId is not provided in DTO, get it from user's organization
    if (!updateUserDto.organizationId) {
      updateUserDto.organizationId = req.userOrganization?.id;
    }
    return this.usersService.updateUser(userId, updateUserDto);
  }

  @Post('list')
  // @UseGuards(ClerkAuthGuard)
  // @Permissions('users:read')
  @ApiBody({ type: GetUsersDto })
  getUsers(@Body() getUsersDto: GetUsersDto) {
    return this.usersService.getUsers(getUsersDto);
  }

  @Delete(':userId')
  // @UseGuards(ClerkAuthGuard)
  // @Permissions('users:delete')
  @ApiOperation({ summary: 'Delete a user and all their role associations' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'userId', description: 'The Clerk user ID to delete' })
  deleteUser(@Param('userId') userId: string) {
    return this.usersService.deleteUser(userId);
  }
}
