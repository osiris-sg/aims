// src/users/users.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UserRole, Role, Permission } from '@prisma/client';
import { GetUsersDto } from './dto/get-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ClerkClient } from '@clerk/backend';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ClerkIdentityService } from '../clerk/clerk-identity.service';
import { AdminActor, PLATFORM_ADMIN_ROLE_WHERE } from '../auth/admin-scope';
import { normEmail } from '../auth/active-org';

/** Edit User: the new email already belongs to another login. */
export const EMAIL_TAKEN = 'That email is already used by another login';

/** A login's primary email (its first one if none is marked primary), or null. Never its id. */
export const primaryEmailOf = (u: any): string | null => (u?.emailAddresses || []).find((e: any) => e.id === u?.primaryEmailAddressId)?.emailAddress || u?.emailAddresses?.[0]?.emailAddress || null;

/** A login's primary phone number, or null. */
export const primaryPhoneOf = (u: any): string | null => (u?.phoneNumbers || []).find((p: any) => p.id === u?.primaryPhoneNumberId)?.phoneNumber || u?.phoneNumbers?.[0]?.phoneNumber || null;

/** What a person is called in lists: name, else username, email or phone. Never a Clerk id. */
export const displayNameOf = (u: any): string => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.username || primaryEmailOf(u) || prettyPhone(primaryPhoneOf(u)) || 'Unnamed user';

/** A Singapore number as "+65 9123 4567"; any other number as it is. */
export const prettyPhone = (p: string | null): string | null => (p && /^\+65\d{8}$/.test(p) ? `+65 ${p.slice(3, 7)} ${p.slice(7)}` : p);

interface UserRoleWithDetails extends UserRole {
  role: Role & {
    permissions: Permission[];
  };
}

@Injectable()
export class UsersService {
  constructor(
    @Inject('ClerkClient')
    private readonly clerkClient: ClerkClient,
    private readonly prisma: PrismaService,
    // DB user id -> Clerk user (an imported prod user's DB id is its external_id).
    private readonly clerkIdentity: ClerkIdentityService,
  ) {}

  /** Active member of the org: an active membership row or an active role there. */
  private async isMember(userId: string, organizationId: string) {
    const [uo, ur] = await Promise.all([
      this.prisma.userOrganization.count({ where: { userId, organizationId, isActive: true } }),
      this.prisma.userRole.count({ where: { userId, organizationId, isActive: true } }),
    ]);
    return uo + ur > 0;
  }

  /**
   * Round AW: a caller who is not a platform admin only reaches members of
   * their own org (404 otherwise, so another org's user id tells nothing),
   * and never a platform admin's account.
   */
  async assertReach(userId: string, actor?: AdminActor) {
    if (!actor || actor.platform) return;
    if (!(await this.isMember(userId, actor.orgId))) throw new NotFoundException('User not found in this organization');
    const platform = await this.prisma.userRole.count({ where: { userId, isActive: true, ...PLATFORM_ADMIN_ROLE_WHERE } });
    if (platform) throw new ForbiddenException('Platform administrators can only be changed by Osiris');
  }

  /** Round AW: roles handed out by a non-platform caller must belong to their org. */
  private async assertRolesInOrg(roleIds: string[], organizationId: string, actor?: AdminActor) {
    if (!actor || actor.platform || !roleIds?.length) return;
    const found = await this.prisma.role.findMany({ where: { id: { in: roleIds }, organizationId }, select: { id: true } });
    const ok = new Set(found.map((r) => r.id));
    const missing = roleIds.filter((id) => !ok.has(id));
    if (missing.length) throw new NotFoundException(`Roles with IDs ${missing.join(', ')} not found in this organization`);
  }

  /** Round AW: a non-platform caller works in their own org, whatever the body says. */
  private orgFor(requested: string | undefined, actor?: AdminActor) {
    if (!actor || actor.platform) return requested || actor?.orgId;
    if (requested && requested !== actor.orgId) throw new ForbiddenException('You can only manage users in your own organization');
    return actor.orgId;
  }

  async getUsers(getUsersDto: GetUsersDto, organizationId: string) {
    const { page = 1, limit = 10, search = '', filters = {} } = getUsersDto;
    const skip = (page - 1) * limit;

    // Build where clause for user roles - scope to organization.
    // isActive: deactivated assignments (e.g. Summer's Management role during
    // the Senior-Manager trial) must not render as chips or count permissions.
    const whereClause: any = {
      organizationId: organizationId, // Only get users from this organization
      isActive: true,
    };

    if (search) {
      // Note: We can't search by user name/email directly since users are in Clerk
      // We'll search by userId if it matches the search pattern
      if (search.match(/^[a-zA-Z0-9_-]+$/)) {
        whereClause.userId = { contains: search, mode: 'insensitive' };
      }
    }

    // Get user roles for this organization only
    const userRoles = await this.prisma.userRole.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    const totalDocuments = await this.prisma.userRole.count({ where: whereClause });

    // Group user roles by userId
    const userRolesByUserId: { [key: string]: UserRoleWithDetails[] } = {};
    userRoles.forEach((userRole) => {
      if (!userRolesByUserId[userRole.userId]) {
        userRolesByUserId[userRole.userId] = [];
      }
      userRolesByUserId[userRole.userId].push(userRole as UserRoleWithDetails);
    });

    // Per-org member profiles (WhatsApp number for agent routing, default
    // designer commission). Users live in Clerk; these org-scoped attributes
    // live in OrganizationMemberProfile.
    const profiles = await this.prisma.organizationMemberProfile.findMany({
      where: { organizationId, userId: { in: Object.keys(userRolesByUserId) } },
    });
    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));

    // Fetch user information from Clerk: ONE batched lookup for the page's
    // DB ids (by external_id, then id), not a getUser per user.
    const clerkUsers = await this.clerkIdentity.toClerkUsers(Object.keys(userRolesByUserId));
    const transformedUsers = await Promise.all(
      Object.entries(userRolesByUserId).map(async ([userId, roles]: [string, UserRoleWithDetails[]]) => {
        const firstRole = roles[0];
        const profile = profileByUser.get(userId);

        try {
          const clerkUser = clerkUsers.get(userId);
          if (!clerkUser) throw new NotFoundException(`Clerk user not found for ${userId}`);

          return {
            id: userId,
            // A login with no email (e.g. a phone-only SiteClock worker) has none: never its id.
            email: primaryEmailOf(clerkUser),
            phone: prettyPhone(primaryPhoneOf(clerkUser)),
            firstName: clerkUser.firstName || null,
            lastName: clerkUser.lastName || null,
            // A login with no name shows its email (a person added by email shows like any other member).
            name: displayNameOf(clerkUser),
            whatsappNumber: profile?.whatsappNumber ?? null,
            whatsappPrefs: profile?.whatsappPrefs ?? null,
            commissionPct: profile?.commissionPct ?? null,
            yearlySalesTarget: profile?.yearlySalesTarget ?? null,
            roles: roles.map((ur) => ({
              id: ur.role.id,
              name: ur.role.name,
              description: ur.role.description,
              permissions: ur.role.permissions,
            })),
            createdAt: firstRole.createdAt,
            updatedAt: firstRole.createdAt, // Since we don't have updatedAt in UserRole
          };
        } catch (error) {
          console.error(`Error fetching user ${userId} from Clerk:`, error);
          // Fallback to placeholder data if Clerk fetch fails
          return {
            id: userId,
            email: null,
            phone: null,
            name: 'Unnamed user',
            whatsappNumber: profile?.whatsappNumber ?? null,
            whatsappPrefs: profile?.whatsappPrefs ?? null,
            commissionPct: profile?.commissionPct ?? null,
            yearlySalesTarget: profile?.yearlySalesTarget ?? null,
            roles: roles.map((ur) => ({
              id: ur.role.id,
              name: ur.role.name,
              description: ur.role.description,
              permissions: ur.role.permissions,
            })),
            createdAt: firstRole.createdAt,
            updatedAt: firstRole.createdAt,
          };
        }
      }),
    );

    return {
      users: transformedUsers,
      totalDocuments,
      totalPagesCount: Math.ceil(totalDocuments / limit),
    };
  }

  /**
   * Org-scoped member profile: the WhatsApp number the agent matches inbound
   * messages against, and a designer's default commission share. Upsert —
   * only provided fields change.
   */
  async upsertMemberProfile(userId: string, organizationId: string, dto: { whatsappNumber?: string | null; whatsappPrefs?: Record<string, unknown> | null; commissionPct?: number | null; yearlySalesTarget?: number | null; signatureImage?: string | null }) {
    const whatsappNumber = dto.whatsappNumber !== undefined ? (dto.whatsappNumber ? dto.whatsappNumber.replace(/\D/g, '') : null) : undefined;
    if (dto.signatureImage && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dto.signatureImage)) {
      throw new BadRequestException('signatureImage must be a PNG/JPEG data URL');
    }
    return this.prisma.organizationMemberProfile.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      update: {
        whatsappNumber,
        whatsappPrefs: dto.whatsappPrefs !== undefined ? (dto.whatsappPrefs as any) : undefined,
        commissionPct: dto.commissionPct !== undefined ? dto.commissionPct : undefined,
        yearlySalesTarget: dto.yearlySalesTarget !== undefined ? dto.yearlySalesTarget : undefined,
        signatureImage: dto.signatureImage !== undefined ? dto.signatureImage : undefined,
      },
      create: {
        organizationId,
        userId,
        whatsappNumber: whatsappNumber ?? null,
        whatsappPrefs: (dto.whatsappPrefs as any) ?? null,
        commissionPct: dto.commissionPct ?? null,
        yearlySalesTarget: dto.yearlySalesTarget ?? null,
        signatureImage: dto.signatureImage ?? null,
      },
    });
  }

  /** Own org-scoped profile (signature, target) — for the editor's counter-sign dialog. */
  async getOwnProfile(userId: string, organizationId: string) {
    const p = await this.prisma.organizationMemberProfile.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { whatsappNumber: true, commissionPct: true, yearlySalesTarget: true, signatureImage: true, uiLang: true },
    });
    return p || { whatsappNumber: null, commissionPct: null, yearlySalesTarget: null, signatureImage: null, uiLang: null };
  }

  /**
   * Round AZ: the caller's portal language in this org (EN / 日本語 switch in the top bar). Only orgs with the
   * SHIPMENTS module have the switch; every other org stays English.
   */
  async setOwnUiLang(userId: string, organizationId: string, uiLang: unknown) {
    if (uiLang !== 'en' && uiLang !== 'ja') throw new BadRequestException('uiLang must be "en" or "ja"');
    const m = await this.prisma.organizationModule.findUnique({ where: { organizationId_moduleCode: { organizationId, moduleCode: 'SHIPMENTS' } }, select: { enabled: true } });
    if (!m?.enabled) throw new BadRequestException('The language switch is not available for this organization');
    const prev = await this.prisma.organizationMemberProfile.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { uiLang: true } });
    await this.prisma.organizationMemberProfile.upsert({ where: { organizationId_userId: { organizationId, userId } }, update: { uiLang }, create: { organizationId, userId, uiLang } });
    return { uiLang, from: prev?.uiLang ?? null };
  }

  async getUserRoles(userId: string, organizationId: string) {
    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId,
        organizationId, // Only get roles for this organization
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return userRoles.map((ur) => ur.role);
  }

  async getUserPermissions(userId: string) {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    // Flatten all permissions from all user roles and remove duplicates
    const permissions = new Map();
    userRoles.forEach((userRole) => {
      userRole.role.permissions.forEach((permission) => {
        permissions.set(permission.id, permission);
      });
    });

    return {
      success: true,
      data: Array.from(permissions.values()),
    };
  }

  async assignRoleToUser(userId: string, roleId: string, organizationId: string, actor?: AdminActor) {
    await this.assertReach(userId, actor);
    await this.assertRolesInOrg([roleId], organizationId, actor);
    // Check if user already has this role in this organization
    const existingUserRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        roleId,
        organizationId,
      },
    });

    if (existingUserRole?.isActive) {
      throw new NotFoundException('User already has this role in this organization');
    }
    if (existingUserRole) {
      // A removed assignment (round AW keeps the row) comes back on re-assign.
      const back = await this.prisma.userRole.update({ where: { id: existingUserRole.id }, data: { isActive: true }, include: { role: { include: { permissions: true } } } });
      ClerkAuthGuard.invalidateUser(userId);
      return back.role;
    }

    // Create the user role assignment
    const userRole = await this.prisma.userRole.create({
      data: {
        userId,
        roleId,
        organizationId,
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    // Access changed — drop the guard's cached roles so it takes effect now.
    ClerkAuthGuard.invalidateUser(userId);

    return userRole.role;
  }

  async removeRoleFromUser(userId: string, roleId: string, organizationId: string, actor?: AdminActor) {
    await this.assertReach(userId, actor);
    const userRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        roleId,
        organizationId,
      },
    });

    if (!userRole) {
      throw new NotFoundException('User does not have this role in this organization');
    }

    await this.prisma.userRole.delete({
      where: { id: userRole.id },
    });

    // Access changed — drop the guard's cached roles so it takes effect now.
    ClerkAuthGuard.invalidateUser(userId);

    return { message: 'Role removed successfully' };
  }

  async createUser(createUserDto: CreateUserDto, actor?: AdminActor) {
    const { firstName, lastName, email, username, password, roleIds } = createUserDto;
    const organizationId = this.orgFor(createUserDto.organizationId, actor);
    await this.assertRolesInOrg(roleIds, organizationId, actor);

    // A Clerk user needs at least one identifier — accept either email or username.
    if (!email && !username) {
      throw new BadRequestException('Either an email address or a username is required');
    }

    // Verify that all roles exist
    const roles = await this.prisma.role.findMany({
      where: {
        id: {
          in: roleIds,
        },
      },
    });

    if (roles.length !== roleIds.length) {
      const foundRoleIds = roles.map((role) => role.id);
      const missingRoleIds = roleIds.filter((id) => !foundRoleIds.includes(id));
      throw new NotFoundException(`Roles with IDs ${missingRoleIds.join(', ')} not found`);
    }

    // Create user in Clerk. Only send the identifier(s) actually provided so we
    // can create email-only OR username-only users.
    let clerkUser;
    try {
      clerkUser = await this.clerkClient.users.createUser({
        firstName,
        lastName,
        ...(email ? { emailAddress: [email] } : {}),
        ...(username ? { username } : {}),
        password,
        skipPasswordChecks: true,
        skipPasswordRequirement: true,
      });
    } catch (error: any) {
      console.error('Error creating user in Clerk:', error);
      if (error.errors?.[0]?.code === 'form_identifier_exists') {
        const back = await this.readdRemovedMember(email, username, organizationId, roleIds);
        if (back) return back;
        throw new NotFoundException('A user with this email address or username already exists');
      }
      throw new NotFoundException('Failed to create user in Clerk: ' + (error.message || 'Unknown error'));
    }

    const userId = clerkUser.id;
    // external_id = its own id, so this user resolves like an imported one.
    await this.clerkIdentity.stampExternalId(userId);

    // Ensure user is assigned to the organization
    await this.prisma.userOrganization.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      update: {
        isActive: true,
        salesmanCode: createUserDto.salesmanCode || undefined,
        salesmanMobile: createUserDto.salesmanMobile || undefined,
      },
      create: {
        userId,
        organizationId,
        salesmanCode: createUserDto.salesmanCode || null,
        salesmanMobile: createUserDto.salesmanMobile || null,
        isActive: true,
      },
    });

    // Create user roles with organization context
    const userRoles = await Promise.all(
      roleIds.map((roleId) =>
        this.prisma.userRole.create({
          data: {
            userId,
            roleId,
            organizationId,
          },
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        }),
      ),
    );

    // Access changed — drop the guard's cached roles so it takes effect now.
    ClerkAuthGuard.invalidateUser(userId);

    return {
      id: userId,
      email: clerkUser.emailAddresses[0]?.emailAddress || email || null,
      username: clerkUser.username || username || null,
      name: displayNameOf(clerkUser),
      roles: userRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
        description: ur.role.description,
        permissions: ur.role.permissions,
      })),
      createdAt: userRoles[0]?.createdAt || new Date(),
      updatedAt: userRoles[0]?.createdAt || new Date(),
    };
  }

  async updateUser(userId: string, updateUserDto: UpdateUserDto, actor?: AdminActor) {
    const { firstName, lastName, email, password, roleIds } = updateUserDto;
    const organizationId = this.orgFor(updateUserDto.organizationId, actor);
    await this.assertReach(userId, actor);
    await this.assertRolesInOrg(roleIds ?? [], organizationId, actor);

    // Check if user exists by looking for their roles
    const existingUserRoles = await this.prisma.userRole.findMany({
      where: { userId },
    });

    if (existingUserRoles.length === 0) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // If roleIds are provided, verify they exist
    if (roleIds && roleIds.length > 0) {
      const roles = await this.prisma.role.findMany({
        where: {
          id: {
            in: roleIds,
          },
        },
      });

      if (roles.length !== roleIds.length) {
        const foundRoleIds = roles.map((role) => role.id);
        const missingRoleIds = roleIds.filter((id) => !foundRoleIds.includes(id));
        throw new NotFoundException(`Roles with IDs ${missingRoleIds.join(', ')} not found`);
      }
    }

    // The current login (fresh: the comparisons below must not run against a cached copy).
    let clerkUser: any;
    try {
      clerkUser = await this.clerkIdentity.toClerkUser(userId, { fresh: true });
    } catch (error: any) {
      if (error?.status === 404) throw new NotFoundException('User not found in Clerk');
      throw new BadRequestException(`The user could not be loaded: ${clerkErrorText(error)}`);
    }
    // The form sends the email back unchanged on every save: only a DIFFERENT one is a change.
    const newEmail = email && email.trim() ? normEmail(email) : null;
    const emailChange = !!newEmail && newEmail !== normEmail(primaryEmailOf(clerkUser) ?? '');
    const newPassword = password && password.trim().length >= 8 ? password.trim() : null;

    // A login shared with another org: only a platform admin changes its email / password.
    if (actor && !actor.platform && (emailChange || newPassword)) {
      const elsewhere = await this.prisma.userOrganization.count({ where: { userId, isActive: true, organizationId: { not: organizationId } } });
      const rolesElsewhere = await this.prisma.userRole.count({ where: { userId, isActive: true, organizationId: { not: organizationId } } });
      if (elsewhere + rolesElsewhere > 0) throw new ForbiddenException('This login is also used in another organization; ask Osiris to change its email or password');
    }

    // The email first: if it can't be saved nothing else changes, and the admin is told why.
    if (emailChange) {
      clerkUser = await this.setLoginEmail(clerkUser, newEmail!);
      this.clerkIdentity.invalidate(userId);
    }

    try {
      const clerkUpdateData: any = {};

      // Only add fields if they are provided and different from current values
      if (firstName && firstName.trim() && firstName.trim() !== clerkUser.firstName) {
        clerkUpdateData.firstName = firstName.trim();
      }

      // Last name is optional: an empty one clears it (undefined leaves it alone).
      if (lastName !== undefined && lastName !== null && String(lastName).trim() !== (clerkUser.lastName || '')) {
        clerkUpdateData.lastName = String(lastName).trim();
      }

      if (newPassword) {
        clerkUpdateData.password = newPassword;
        clerkUpdateData.skipPasswordChecks = true;
        clerkUpdateData.skipPasswordRequirement = true;
      }

      // Only update if there are actual changes
      if (Object.keys(clerkUpdateData).length > 0) {
        clerkUser = await this.clerkClient.users.updateUser(clerkUser.id, clerkUpdateData);
        this.clerkIdentity.invalidate(userId);
      }
    } catch (error: any) {
      console.error('Error updating user in Clerk:', error?.errors || error?.message);
      if (error.status === 404) {
        throw new NotFoundException('User not found in Clerk');
      }
      throw new BadRequestException(`The user could not be saved: ${clerkErrorText(error)}`);
    }

    // Update role assignments if provided
    if (roleIds && roleIds.length > 0 && organizationId) {
      // Ensure user is assigned to the organization
      await this.prisma.userOrganization.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        update: {
          isActive: true,
          salesmanCode: updateUserDto.salesmanCode || undefined,
          // Empty string clears it on purpose; undefined leaves it untouched.
          salesmanMobile:
            updateUserDto.salesmanMobile === undefined
              ? undefined
              : updateUserDto.salesmanMobile || null,
        },
        create: {
          userId,
          organizationId,
          salesmanCode: updateUserDto.salesmanCode || null,
          salesmanMobile: updateUserDto.salesmanMobile || null,
          isActive: true,
        },
      });

      // Round AW: roles dropped in this org are marked inactive (rows kept);
      // the chosen ones are created or switched back on.
      await this.prisma.userRole.updateMany({
        where: { userId, organizationId, isActive: true, roleId: { notIn: roleIds } },
        data: { isActive: false },
      });
      await Promise.all(
        roleIds.map((roleId) =>
          this.prisma.userRole.upsert({
            where: { userId_roleId_organizationId: { userId, roleId, organizationId } },
            update: { isActive: true },
            create: { userId, roleId, organizationId },
          }),
        ),
      );
    }

    // Access may have changed — drop the guard's cached roles so it takes effect now.
    ClerkAuthGuard.invalidateUser(userId);

    // Fetch updated user roles with details
    const updatedUserRoles = await this.prisma.userRole.findMany({
      where: { userId, isActive: true },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return {
      id: userId,
      email: primaryEmailOf(clerkUser),
      phone: prettyPhone(primaryPhoneOf(clerkUser)),
      name: displayNameOf(clerkUser),
      roles: updatedUserRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
        description: ur.role.description,
        permissions: ur.role.permissions,
      })),
      createdAt: updatedUserRoles[0]?.createdAt || new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Edit User's email (2026-11-03). Clerk's updateUser has no email field (the
   * old code sent `emailAddress` there and Clerk dropped it, so a save "worked"
   * and the email never changed). The address is added to the login as
   * verified + primary, and the previous primary email is removed (a change,
   * not a second address). Phones, Google and other sign-ins are left alone.
   * Another login already holding the address: 409 EMAIL_TAKEN, nothing changed.
   */
  private async setLoginEmail(clerkUser: any, email: string) {
    const holders: any = await this.clerkClient.users.getUserList({ emailAddress: [email] });
    const other = (Array.isArray(holders) ? holders : (holders?.data ?? [])).find((u: any) => u.id !== clerkUser.id);
    if (other) throw new ConflictException(EMAIL_TAKEN);
    const previous = (clerkUser.emailAddresses || []).find((e: any) => e.id === clerkUser.primaryEmailAddressId) ?? clerkUser.emailAddresses?.[0] ?? null;
    const mine = (clerkUser.emailAddresses || []).find((e: any) => normEmail(e.emailAddress) === email);
    try {
      const saved: any = mine
        ? await this.clerkClient.emailAddresses.updateEmailAddress(mine.id, { verified: true, primary: true })
        : await this.clerkClient.emailAddresses.createEmailAddress({ userId: clerkUser.id, emailAddress: email, verified: true, primary: true });
      if (previous && previous.id !== saved.id) await this.clerkClient.emailAddresses.deleteEmailAddress(previous.id);
    } catch (error: any) {
      console.error('Error saving email in Clerk:', error?.errors || error?.message);
      const code = error?.errors?.[0]?.code;
      if (code === 'form_identifier_exists' || code === 'duplicate_record') throw new ConflictException(EMAIL_TAKEN);
      throw new BadRequestException(`The email could not be saved: ${clerkErrorText(error)}`);
    }
    const fresh = await this.clerkClient.users.getUser(clerkUser.id);
    if (normEmail(primaryEmailOf(fresh) ?? '') !== email) throw new BadRequestException('The email could not be saved. Please try again.');
    return fresh;
  }

  /**
   * Round AW: "Delete user" removes the user from the caller's org only — the
   * membership and that org's role rows are kept and marked inactive (hidden,
   * not deleted). A platform admin removing someone who is not in their
   * current org removes them from every org (the admin panel's old reach).
   *
   * 2026-11-03 (owner): removal NEVER deletes the Clerk login, whatever is
   * left. The Clerk instance is shared with SiteClock (workers sign in there
   * by phone), and hh@wct.com.sg's login was deleted this way. Deleting a
   * login is only deleteLoginEverywhere (Osiris admin, warnings + typed
   * confirmation).
   */
  async deleteUser(userId: string, actor?: AdminActor) {
    if (actor && actor.userId && actor.userId === userId) throw new BadRequestException('You cannot remove yourself');
    await this.assertReach(userId, actor);
    const everywhere = !actor || (actor.platform && !(await this.isMember(userId, actor.orgId)));
    const scope = everywhere ? { userId } : { userId, organizationId: actor!.orgId };

    const [roles, memberships] = await Promise.all([
      this.prisma.userRole.updateMany({ where: { ...scope, isActive: true }, data: { isActive: false } }),
      this.prisma.userOrganization.updateMany({ where: { ...scope, isActive: true }, data: { isActive: false } }),
    ]);
    if (roles.count + memberships.count === 0) {
      throw new NotFoundException(`User with ID ${userId} not found or has no roles assigned`);
    }

    // Access revoked — drop the guard's cached roles so it takes effect now.
    ClerkAuthGuard.invalidateUser(userId);

    const left = (await this.prisma.userOrganization.count({ where: { userId, isActive: true } })) + (await this.prisma.userRole.count({ where: { userId, isActive: true } }));

    return {
      message: everywhere ? `User ${userId} has been removed from every organization` : `User ${userId} has been removed from this organization`,
      success: true,
      removedFrom: everywhere ? 'all' : actor!.orgId,
      rolesRemoved: roles.count,
      // The login is never deleted here (see above).
      clerkDeleted: false,
      otherMemberships: left,
    };
  }

  /**
   * "Delete login everywhere" (Osiris admin only, 2026-11-03): what deleting
   * this login would affect, and the text the admin must type to confirm.
   */
  async loginDeleteCheck(userId: string, actor?: AdminActor) {
    if (!actor?.platform) throw new ForbiddenException('Only Osiris can delete a login');
    let u: any;
    try {
      u = await this.clerkIdentity.toClerkUser(userId, { fresh: true });
    } catch (error: any) {
      if (error?.status === 404 || error instanceof NotFoundException) throw new NotFoundException('That login does not exist');
      throw error;
    }
    const memberships = await this.prisma.userOrganization.findMany({ where: { userId, isActive: true }, select: { organizationId: true, organization: { select: { name: true } } } });
    const organizations = memberships.map((m: any) => m.organization?.name || m.organizationId).filter(Boolean);
    const sc = u?.publicMetadata?.siteclock;
    const email = primaryEmailOf(u);
    const phone = primaryPhoneOf(u);
    const warnings: string[] = [];
    if (sc != null) warnings.push(`This is also a SiteClock login${sc?.role ? ` (${sc.role})` : ''}. Deleting it stops them signing in to SiteClock too.`);
    if (organizations.length) warnings.push(`It is still a member of ${organizations.join(', ')} in AIMS; deleting it removes them from all of them.`);
    return {
      userId,
      name: displayNameOf(u),
      email,
      phone: prettyPhone(phone),
      siteclock: sc != null,
      organizations,
      warnings,
      // Typed to confirm: the email, else the mobile (+65…), else the id.
      confirmWith: email || phone || u.id,
    };
  }

  /** "Delete login everywhere": typed confirmation, warnings acknowledged; every AIMS membership + role off, then the Clerk login deleted. */
  async deleteLoginEverywhere(userId: string, body: { confirm?: string; acknowledgeWarnings?: boolean }, actor?: AdminActor) {
    if (!actor?.platform) throw new ForbiddenException('Only Osiris can delete a login');
    if (actor.userId && actor.userId === userId) throw new BadRequestException('You cannot delete your own login');
    if (await this.prisma.userRole.count({ where: { userId, isActive: true, ...PLATFORM_ADMIN_ROLE_WHERE } })) {
      throw new ForbiddenException('An Osiris platform administrator login cannot be deleted here');
    }
    const check = await this.loginDeleteCheck(userId, actor);
    const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, '').toLowerCase();
    if (!body?.confirm || norm(body.confirm) !== norm(check.confirmWith)) throw new BadRequestException(`Type ${check.confirmWith} to confirm`);
    if (check.warnings.length && body?.acknowledgeWarnings !== true) throw new BadRequestException('Read and confirm the warnings first');

    const [roles, memberships] = await Promise.all([
      this.prisma.userRole.updateMany({ where: { userId, isActive: true }, data: { isActive: false } }),
      this.prisma.userOrganization.updateMany({ where: { userId, isActive: true }, data: { isActive: false } }),
    ]);
    ClerkAuthGuard.invalidateUser(userId);
    const clerkId = await this.clerkIdentity.toClerkId(userId);
    await this.clerkClient.users.deleteUser(clerkId);
    this.clerkIdentity.invalidate(userId);
    return { deleted: true, userId, siteclock: check.siteclock, membershipsRemoved: memberships.count, rolesRemoved: roles.count };
  }

  /**
   * Round AW: "Add user" with the email / username of someone this org removed
   * earlier brings their membership back (their login was kept) with the new
   * roles. Their password is left alone. Anyone else's existing login stays an error.
   */
  private async readdRemovedMember(email: string | undefined, username: string | undefined, organizationId: string, roleIds: string[]) {
    const found = email
      ? await this.clerkClient.users.getUserList({ emailAddress: [email] })
      : await this.clerkClient.users.getUserList({ username: [username!] });
    const clerkUser = (found as any)?.data?.[0] ?? (Array.isArray(found) ? found[0] : undefined);
    if (!clerkUser) return null;
    const userId = clerkUser.externalId || clerkUser.id;
    const removed = await this.prisma.userOrganization.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
    if (!removed || removed.isActive) return null;
    await this.prisma.userOrganization.update({ where: { id: removed.id }, data: { isActive: true } });
    for (const roleId of roleIds) {
      await this.prisma.userRole.upsert({
        where: { userId_roleId_organizationId: { userId, roleId, organizationId } },
        update: { isActive: true },
        create: { userId, roleId, organizationId },
      });
    }
    ClerkAuthGuard.invalidateUser(userId);
    const roles = await this.prisma.userRole.findMany({ where: { userId, organizationId, isActive: true }, include: { role: { include: { permissions: true } } } });
    return {
      id: userId,
      email: clerkUser.emailAddresses?.[0]?.emailAddress || email || null,
      username: clerkUser.username || username || null,
      name: displayNameOf(clerkUser),
      roles: roles.map((ur) => ({ id: ur.role.id, name: ur.role.name, description: ur.role.description, permissions: ur.role.permissions })),
      readded: true,
      createdAt: roles[0]?.createdAt || new Date(),
      updatedAt: new Date(),
    };
  }
}

/** Clerk's own words for an API error (its long message, else short message, else the error text). */
function clerkErrorText(error: any): string {
  const e = error?.errors?.[0];
  return e?.longMessage || e?.long_message || e?.message || error?.message || 'unknown error';
}
