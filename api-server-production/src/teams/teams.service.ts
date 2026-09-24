import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Teams with their member user ids (leader included implicitly). */
  async list(organizationId: string) {
    const [teams, profiles] = await Promise.all([
      this.prisma.team.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }),
      this.prisma.organizationMemberProfile.findMany({
        where: { organizationId, teamId: { not: null } },
        select: { userId: true, teamId: true },
      }),
    ]);
    return teams.map((t) => ({
      ...t,
      memberUserIds: profiles.filter((p) => p.teamId === t.id).map((p) => p.userId),
    }));
  }

  async create(organizationId: string, dto: { name: string; leaderUserId?: string | null; yearlyTarget?: number | null }) {
    if (!dto?.name?.trim()) throw new BadRequestException('Team name is required');
    const team = await this.prisma.team.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        leaderUserId: dto.leaderUserId || null,
        yearlyTarget: dto.yearlyTarget != null && Number.isFinite(Number(dto.yearlyTarget)) ? Number(dto.yearlyTarget) : null,
      },
    });
    // The leader IS a member — guaranteed server-side so a fresh team is
    // never member-less even if the portal's follow-up members call fails
    // (prod "Junior Manager Trial Team", 2026-09-25).
    if (team.leaderUserId) await this.ensureMember(organizationId, team.id, team.leaderUserId);
    return team;
  }

  private async ensureMember(organizationId: string, teamId: string, userId: string) {
    await this.prisma.organizationMemberProfile.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      update: { teamId },
      create: { organizationId, userId, teamId },
    });
  }

  async update(teamId: string, organizationId: string, dto: { name?: string; leaderUserId?: string | null; yearlyTarget?: number | null }) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException('Team not found');
    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data: {
        name: dto.name?.trim() || undefined,
        leaderUserId: dto.leaderUserId !== undefined ? dto.leaderUserId : undefined,
        yearlyTarget: dto.yearlyTarget !== undefined ? (dto.yearlyTarget == null ? null : Number(dto.yearlyTarget) || 0) : undefined,
      },
    });
    if (updated.leaderUserId) await this.ensureMember(organizationId, teamId, updated.leaderUserId);
    return updated;
  }

  async remove(teamId: string, organizationId: string) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException('Team not found');
    await this.prisma.$transaction([
      this.prisma.organizationMemberProfile.updateMany({ where: { organizationId, teamId }, data: { teamId: null } }),
      this.prisma.team.delete({ where: { id: teamId } }),
    ]);
    return { ok: true };
  }

  /** Wholesale membership set: these users are IN the team, everyone else out. */
  async setMembers(teamId: string, organizationId: string, userIds: string[]) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException('Team not found');
    const ids = [...new Set([...(userIds || []), team.leaderUserId].filter(Boolean))] as string[];
    await this.prisma.$transaction([
      this.prisma.organizationMemberProfile.updateMany({ where: { organizationId, teamId }, data: { teamId: null } }),
      ...ids.map((userId) =>
        this.prisma.organizationMemberProfile.upsert({
          where: { organizationId_userId: { organizationId, userId } },
          update: { teamId },
          create: { organizationId, userId, teamId },
        }),
      ),
    ]);
    return { ok: true, members: ids.length };
  }
}
