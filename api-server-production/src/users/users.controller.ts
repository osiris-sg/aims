// src/users/users.controller.ts
import { Controller, Get, Post, Delete, Patch, Param, Body, UseGuards, Query, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { MembershipsService } from './memberships.service';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { UserOrganization } from 'src/auth/decorators/user-organization.decorator';
import { actorOf } from 'src/auth/admin-scope';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { GetUsersDto } from './dto/get-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(ClerkAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly memberships: MembershipsService,
  ) {}

  // ── Multi-organisation users (2026-11-02) ───────────────────────────────
  // My organisations (for the org switcher): no permission needed, only my own rows.
  @Get('me/organizations')
  @ApiOperation({ summary: 'My active organisations (default first), my roles and unread notifications in each' })
  myOrganizations(@Req() req: any) {
    return this.memberships.myOrganizations(req.user.id, req.userOrganization ?? null, !!req.isOsirisAdmin);
  }

  // Switch org: remembered as my default (most recently used). Only an org I belong to.
  @Post('me/active-org')
  @ApiOperation({ summary: 'Remember the org I switched to as my default' })
  setActiveOrg(@Req() req: any, @Body() body: { organizationId?: string }) {
    return this.memberships.setActiveOrg(req.user.id, String(body?.organizationId ?? ''), !!req.isOsirisAdmin);
  }

  // "Add user" (full form, 2026-11-03): email and/or SG mobile, names, role(s), optional
  // password. An existing login (any org) or a new one gets the same reply, so it never
  // tells whether the login existed; an existing login is never changed.
  @Post('members/add-member')
  @Permissions('users:create')
  @ApiOperation({ summary: "Add a person to the caller's organisation (email and/or mobile, names, roles, optional password)" })
  addMember(
    @Body() body: { email?: string; phone?: string; firstName?: string; lastName?: string; password?: string; roleIds?: string[]; salesmanCode?: string; salesmanMobile?: string },
    @UserOrganization() organization: { id: string; name: string },
    @Req() req: any,
  ) {
    return this.memberships.addMember(body ?? {}, actorOf(req, organization.id));
  }

  // /set-password: a login whose password the admin set at Add user replaces it once
  // without the current one. Only the caller's own login; refused once used.
  @Post('me/first-password')
  @ApiOperation({ summary: 'Replace the admin-set password once (from the welcome email link)' })
  setFirstPassword(@Req() req: any, @Body() body: { newPassword?: string }) {
    return this.memberships.setFirstPassword(req.user.id, String(body?.newPassword ?? ''));
  }

  // The old email-only "Add user" path, kept as an alias.
  @Post('members/add-by-email')
  @Permissions('users:create')
  @ApiOperation({ summary: "Add a person to the caller's organisation by email, with roles" })
  addByEmail(@Body() body: { email?: string; roleIds?: string[] }, @UserOrganization() organization: { id: string; name: string }, @Req() req: any) {
    return this.memberships.addByEmail(String(body?.email ?? ''), body?.roleIds ?? [], actorOf(req, organization.id));
  }

  // No permissions required — users can always read their own roles
  @Get('me/roles')
  getMyRoles(@Req() req: any, @UserOrganization() organization: { id: string; name: string }) {
    return this.usersService.getUserRoles(req.user.id, organization.id);
  }

  @Post(':userId/roles')
  @Permissions('users:assign-role')
  assignRole(@Param('userId') userId: string, @Body() body: { roleId: string }, @UserOrganization() organization: { id: string; name: string }, @Req() req: any) {
    return this.usersService.assignRoleToUser(userId, body.roleId, organization.id, actorOf(req, organization.id));
  }

  @Delete(':userId/roles/:roleId')
  @Permissions('users:remove-role')
  removeRole(@Param('userId') userId: string, @Param('roleId') roleId: string, @UserOrganization() organization: { id: string; name: string }, @Req() req: any) {
    return this.usersService.removeRoleFromUser(userId, roleId, organization.id, actorOf(req, organization.id));
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
  createUser(@Body() createUserDto: CreateUserDto, @UserOrganization() organization: { id: string; name: string }, @Req() req: any) {
    // Round AW: the service pins a non-platform caller to their own org (403 for another org id).
    return this.usersService.createUser(createUserDto, actorOf(req, organization.id));
  }

  @Get('me/profile')
  @ApiOperation({ summary: "The caller's own org-scoped profile (saved signature, target)" })
  getOwnProfile(@Req() req: any, @UserOrganization() organization: { id: string; name: string }) {
    return this.usersService.getOwnProfile(req.user?.id, organization.id);
  }

  // Saving one's own signature needs no users:update — it only writes the
  // caller's row (designers counter-sign quotations with it).
  @Patch('me/signature')
  @ApiOperation({ summary: "Save the caller's own signature image" })
  saveOwnSignature(@Req() req: any, @Body() body: { signatureImage: string | null }, @UserOrganization() organization: { id: string; name: string }) {
    return this.usersService.upsertMemberProfile(req.user?.id, organization.id, { signatureImage: body?.signatureImage ?? null });
  }

  // Round AZ: one's own portal language (EN / 日本語) — writes only the caller's row, no users:update needed.
  @Patch('me/ui-lang')
  @ApiOperation({ summary: "Save the caller's portal language (SHIPMENTS orgs)" })
  async saveOwnUiLang(@Req() req: any, @Body() body: { uiLang?: string }, @UserOrganization() organization: { id: string; name: string }) {
    const res = await this.usersService.setOwnUiLang(req.user?.id, organization.id, body?.uiLang);
    req.actionLogResult = { uiLang: { from: res.from, to: res.uiLang } };
    return res;
  }

  @Patch(':userId/profile')
  @Permissions('users:update')
  @ApiOperation({ summary: 'Update the org-scoped member profile (WhatsApp number, default commission %, yearly sales target)' })
  async updateProfile(@Param('userId') userId: string, @Body() body: { whatsappNumber?: string | null; whatsappPrefs?: Record<string, unknown> | null; commissionPct?: number | null; yearlySalesTarget?: number | null }, @UserOrganization() organization: { id: string; name: string }, @Req() req: any) {
    await this.usersService.assertReach(userId, actorOf(req, organization.id));
    return this.usersService.upsertMemberProfile(userId, organization.id, body || {});
  }

  @Patch(':userId')
  @Permissions('users:update')
  @ApiOperation({ summary: 'Update user information and role assignments' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'userId', description: 'The Clerk user ID to update' })
  @ApiBody({ type: UpdateUserDto })
  updateUser(@Param('userId') userId: string, @Body() updateUserDto: UpdateUserDto, @UserOrganization() organization: { id: string; name: string }, @Req() req: any) {
    // Round AW: the service pins a non-platform caller to their own org and its members.
    return this.usersService.updateUser(userId, updateUserDto, actorOf(req, organization.id));
  }

  @Post('list')
  @Permissions('users:read')
  @ApiBody({ type: GetUsersDto })
  getUsers(@Body() getUsersDto: GetUsersDto, @UserOrganization() organization: { id: string; name: string }) {
    return this.usersService.getUsers(getUsersDto, organization.id);
  }

  @Delete(':userId')
  @Permissions('users:delete')
  @ApiOperation({ summary: "Remove a user from the caller's organization (membership + roles kept inactive)" })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'userId', description: 'The Clerk user ID to delete' })
  async deleteUser(@Param('userId') userId: string, @UserOrganization() organization: { id: string; name: string }, @Req() req: any) {
    const res = await this.usersService.deleteUser(userId, actorOf(req, organization.id));
    req.actionLogResult = { removedFrom: res.removedFrom, rolesRemoved: res.rolesRemoved, clerkDeleted: res.clerkDeleted };
    return res;
  }
}
