import { Controller, ForbiddenException, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiUsageService } from './ai-usage.service';
import { OperatorService } from './operator.service';
import { PrismaService } from '../common/prisma.service';
import type { ClerkClient } from '@clerk/backend';

/** Round BM — AIMEE / operator token usage, platform admins only (the Admin panel's AI usage page). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ai-usage')
export class AiUsageController {
  constructor(
    private readonly usage: AiUsageService,
    private readonly operator: OperatorService,
    private readonly prisma: PrismaService,
    // Users live in CLERK, not the database — there is no User model to query.
    @Inject('ClerkClient')
    private readonly clerkClient: ClerkClient,
  ) {}

  @Get()
  @ApiOperation({ summary: 'AIMEE token usage per org and user (platform admins)' })
  async summary(@Req() req: any, @Query('days') days?: string) {
    if (!req?.isOsirisAdmin) throw new ForbiddenException('Platform admins only');
    const n = Math.min(90, Math.max(1, Number(days) || 7));
    return this.usage.summary(n);
  }

  /**
   * Support view (2026-11-26, guru: "check the chat history for the user … she asked to create JV"): a user's
   * AIMEE web conversations, newest first, for platform admins only. The dashboard's own /operator/web/threads
   * only ever lists the caller's threads, so without this nobody could see what a user asked and what AIMEE did.
   */
  @Get('threads')
  @ApiOperation({ summary: "A user's AIMEE conversations (platform admins): ?userId=user_… or ?email=, optional ?q= text filter" })
  async threads(@Req() req: any, @Query('userId') userId?: string, @Query('email') email?: string, @Query('q') q?: string) {
    if (!req?.isOsirisAdmin) throw new ForbiddenException('Platform admins only');
    let uid = String(userId || '').trim();
    if (!uid && email) {
      // Clerk matches an email address exactly; the house pattern (users.service)
      // tolerates both shapes getUserList has returned across SDK versions.
      const found: any = await this.clerkClient.users.getUserList({ emailAddress: [String(email).trim()] });
      uid = (Array.isArray(found) ? found : (found?.data ?? []))[0]?.id || '';
    }
    if (!uid) return { threads: [] };
    const rows = await this.prisma.operatorSession.findMany({
      where: { channel: 'web', channelUserId: { startsWith: `${uid}:` } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { channelUserId: true, state: true, updatedAt: true, createdAt: true },
    });
    const needle = String(q || '').trim().toLowerCase();
    const threads = rows
      .map((r) => {
        const st: any = r.state || {};
        const transcript: any[] = Array.isArray(st.transcript) ? st.transcript : [];
        return {
          id: r.channelUserId.slice(uid.length + 1),
          title: st.title || 'New chat',
          organizationId: st.organizationId || null,
          updatedAt: r.updatedAt,
          createdAt: r.createdAt,
          items: transcript.length,
          transcript: transcript.map((i) => ({ role: i.role, text: i.text, at: i.at ?? i.ts ?? null, ...(i.actions ? { actions: i.actions } : {}) })),
        };
      })
      .filter((t) => !needle || t.transcript.some((i) => String(i.text || '').toLowerCase().includes(needle)));
    return { userId: uid, threads };
  }

  @Get('threads/:userId/:id')
  @ApiOperation({ summary: "One AIMEE web conversation of a user, with its raw state (platform admins)" })
  async thread(@Req() req: any, @Param('userId') userId: string, @Param('id') id: string) {
    if (!req?.isOsirisAdmin) throw new ForbiddenException('Platform admins only');
    const t = await this.operator.readThread('web', `${userId}:${id}`);
    if (!t) return { error: 'Not found' };
    return { userId, id, title: t.state.title || null, transcript: t.state.transcript || [], pendingActions: t.state.pendingActions || [], history: (t.state as any).history || [], updatedAt: t.updatedAt };
  }
}
