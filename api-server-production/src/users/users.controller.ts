// src/users/users.controller.ts
import { Controller, Get, Post, Delete, Patch, Param, Body, UseGuards, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { GetUsersDto } from './dto/get-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(ClerkAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post(':userId/roles')
  @Permissions('users:assign-role')
  assignRole(@Param('userId') userId: string, @Body() body: { roleId: string }, @UserOrganization() organization: { id: string; name: string }) {
    return this.usersService.assignRoleToUser(userId, body.roleId, organization.id);
  }

  @Delete(':userId/roles/:roleId')
  @Permissions('users:remove-role')
  removeRole(@Param('userId') userId: string, @Param('roleId') roleId: string, @UserOrganization() organization: { id: string; name: string }) {
    return this.usersService.removeRoleFromUser(userId, roleId, organization.id);
  }

  @Get(':userId/roles')
  @Permissions('users:read-roles')
  getUserRoles(@Param('userId') userId: string, @UserOrganization() organization: { id: string; name: string }) {
    return this.usersService.getUserRoles(userId, organization.id);
  }

  @Post()
  @Permissions('users:create')
  @ApiOperation({ summary: 'Create a new user with role assignments' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'User or role not found' })
  @ApiBody({ type: CreateUserDto })
  createUser(@Body() createUserDto: CreateUserDto, @UserOrganization() organization: { id: string; name: string }) {
    // If organizationId is not provided in DTO, get it from user's organization
    if (!createUserDto.organizationId) {
      createUserDto.organizationId = organization.id;
    }
    return this.usersService.createUser(createUserDto);
  }

  @Patch(':userId')
  @Permissions('users:update')
  @ApiOperation({ summary: 'Update user information and role assignments' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'userId', description: 'The Clerk user ID to update' })
  @ApiBody({ type: UpdateUserDto })
  updateUser(@Param('userId') userId: string, @Body() updateUserDto: UpdateUserDto, @UserOrganization() organization: { id: string; name: string }) {
    // If organizationId is not provided in DTO, get it from user's organization
    if (!updateUserDto.organizationId) {
      updateUserDto.organizationId = organization.id;
    }
    return this.usersService.updateUser(userId, updateUserDto);
  }

  @Post('list')
  @Permissions('users:read')
  @ApiBody({ type: GetUsersDto })
  getUsers(@Body() getUsersDto: GetUsersDto, @UserOrganization() organization: { id: string; name: string }) {
    return this.usersService.getUsers(getUsersDto, organization.id);
  }

  @Delete(':userId')
  @Permissions('users:delete')
  @ApiOperation({ summary: 'Delete a user and all their role associations' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'userId', description: 'The Clerk user ID to delete' })
  deleteUser(@Param('userId') userId: string) {
    return this.usersService.deleteUser(userId);
  }
}
