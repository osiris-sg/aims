/**
 * HR > Workers > "Give app access": lets a worker sign in to the AIMS phone app with their phone number.
 *   1. the login: the AIMS login (Clerk) that has this phone number; made when there is none (name + phone,
 *      no password: they sign in with a code sent to the phone);
 *   2. the company: the login is added to this org as a "field-tech" member when it is not a member yet
 *      (someone who already works in the portal keeps the roles they have);
 *   3. the link: Worker.userId = that login, which is what the app's guard looks for.
 * Same rules as scripts/setup-wct-siteclock-fieldtechs.ts (WCT, 2026-11-01): AIMS id = external_id || Clerk id,
 * external_id stamped only where it is empty. Nothing is sent to the worker; the office tells them to sign in.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { PrismaService } from '../../common/prisma.service';
import type { FieldCtx } from '../common/field-context.service';

export const APP_ROLE = 'field-tech';

/** "+6591234567" from what the office typed ("91234567", "6591234567", "+65 9123 4567"); 8 digits = a Singapore number. */
export function e164(phone: string | null | undefined): string | null {
  const d = String(phone ?? '').replace(/[^0-9]/g, '');
  if (d.length < 8 || d.length > 15) return null;
  return `+${d.length === 8 ? `65${d}` : d}`;
}

@Injectable()
export class FieldAppAccessService {
  private client: ClerkClient | null = null;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  private get db(): any {
    return this.prisma as any;
  }

  /** Tests swap in a stand-in. */
  setClerk(c: any) {
    this.client = c;
  }

  private clerk(): ClerkClient {
    if (!this.client) {
      const secretKey = this.config.get<string>('CLERK_SECRET_KEY');
      if (!secretKey) throw new ServiceUnavailableException('Sign-in is not set up on this server');
      this.client = createClerkClient({ secretKey });
    }
    return this.client;
  }

  async give(ctx: FieldCtx, workerId: string) {
    const org = ctx.organizationId;
    const worker = await this.db.worker.findFirst({ where: { id: workerId, organizationId: org } });
    if (!worker) throw new NotFoundException('Not found');
    if (!worker.active) throw new BadRequestException('This worker is not active');
    const phone = e164(worker.phone);
    if (!phone) throw new BadRequestException('Add the worker\'s phone number first');

    const clerk = this.clerk();
    const found = await clerk.users.getUserList({ phoneNumber: [phone], limit: 2 });
    let user: any = found.data[0] ?? null;
    let madeLogin = false;
    if (!user) {
      const [firstName, ...rest] = String(worker.name || '').trim().split(/\s+/);
      try {
        user = await clerk.users.createUser({ phoneNumber: [phone], firstName: firstName || undefined, lastName: rest.join(' ') || undefined, skipPasswordRequirement: true });
      } catch (e: any) {
        const msg = e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || 'The login could not be made';
        throw new BadRequestException(`${msg} (${phone})`);
      }
      madeLogin = true;
    }
    if (!user.externalId) {
      await clerk.users.updateUser(user.id, { externalId: user.id }).catch(() => {});
    }
    const aimsId: string = user.externalId || user.id;

    const other = await this.db.worker.findFirst({ where: { organizationId: org, userId: aimsId, id: { not: worker.id } }, select: { name: true } });
    if (other) throw new ConflictException(`That phone number's login is already linked to ${other.name}`);

    // Member of the org: left alone when they already are one.
    let addedMember = false;
    const member = await this.db.userOrganization.findFirst({ where: { userId: aimsId, organizationId: org } });
    if (!member) {
      await this.db.userOrganization.create({ data: { userId: aimsId, organizationId: org } });
      addedMember = true;
    } else if (!member.isActive) {
      await this.db.userOrganization.update({ where: { id: member.id }, data: { isActive: true } });
      addedMember = true;
    }
    const hasRole = await this.db.userRole.findFirst({ where: { userId: aimsId, organizationId: org, isActive: true } });
    let addedRole = false;
    if (!hasRole) {
      const role =
        (await this.db.role.findFirst({ where: { name: APP_ROLE, organizationId: org } })) ??
        (await this.db.role.create({ data: { name: APP_ROLE, organizationId: org, description: 'Uses the AIMS phone app only', allowedModules: [] } }));
      const existing = await this.db.userRole.findFirst({ where: { userId: aimsId, roleId: role.id, organizationId: org } });
      if (existing) await this.db.userRole.update({ where: { id: existing.id }, data: { isActive: true } });
      else await this.db.userRole.create({ data: { userId: aimsId, roleId: role.id, organizationId: org, assignedBy: ctx.userId } });
      addedRole = true;
    }

    const linked = worker.userId !== aimsId;
    if (linked) await this.db.worker.update({ where: { id: worker.id }, data: { userId: aimsId } });
    return { ok: true, phone, madeLogin, addedMember: addedMember || addedRole, linked, before: { userId: worker.userId }, after: { userId: aimsId } };
  }
}
