/**
 * Round BM — AIMEE / operator token usage in the database (not just the logs): one counter row per org, user, UTC day,
 * channel and model, incremented after every model call. No text is stored. Read by the platform-admin AI usage page
 * (GET /admin/ai-usage). No cap yet: this only measures.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface UsageNumbers {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export const usageDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** The counters to add for one model response (missing numbers count 0). */
export function usageIncrement(u: UsageNumbers | null | undefined) {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return { requests: 1, inputTokens: n(u?.input_tokens), outputTokens: n(u?.output_tokens), cacheWriteTokens: n(u?.cache_creation_input_tokens), cacheReadTokens: n(u?.cache_read_input_tokens) };
}

export interface UsageRow {
  organizationId: string;
  userId: string;
  userName?: string | null;
  channel: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/** Per org (with its users), largest first; total = input + output + cache write + cache read. */
export function usageSummary(rows: UsageRow[], orgNames: Map<string, string>) {
  const add = (a: any, r: UsageRow) => {
    a.requests += r.requests;
    a.inputTokens += r.inputTokens;
    a.outputTokens += r.outputTokens;
    a.cacheWriteTokens += r.cacheWriteTokens;
    a.cacheReadTokens += r.cacheReadTokens;
    a.totalTokens = a.inputTokens + a.outputTokens + a.cacheWriteTokens + a.cacheReadTokens;
  };
  const zero = () => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalTokens: 0 });
  const orgs = new Map<string, any>();
  const total = zero();
  for (const r of rows) {
    const o = orgs.get(r.organizationId) ?? { organizationId: r.organizationId, name: orgNames.get(r.organizationId) ?? r.organizationId, ...zero(), users: new Map<string, any>() };
    orgs.set(r.organizationId, o);
    add(o, r);
    add(total, r);
    const u = o.users.get(r.userId) ?? { userId: r.userId, name: r.userName ?? null, ...zero(), channels: new Set<string>() };
    if (r.userName) u.name = r.userName;
    u.channels.add(r.channel);
    o.users.set(r.userId, u);
    add(u, r);
  }
  const list = [...orgs.values()]
    .map((o) => ({ ...o, users: [...o.users.values()].map((u: any) => ({ ...u, channels: [...u.channels].sort() })).sort((a: any, b: any) => b.totalTokens - a.totalTokens) }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
  return { total, orgs: list };
}

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Add one model call's tokens. Never throws (usage must not break a reply). */
  async record(p: { organizationId: string; userId?: string | null; userName?: string | null; channel: string; model: string; usage: UsageNumbers | null | undefined }): Promise<void> {
    if (!p.organizationId) return;
    const inc = usageIncrement(p.usage);
    const key = { organizationId: p.organizationId, userId: p.userId || 'unknown', day: usageDay(), channel: p.channel, model: p.model };
    try {
      await (this.prisma as any).aiUsageDaily.upsert({
        where: { organizationId_userId_day_channel_model: key },
        create: { ...key, userName: p.userName ?? null, ...inc },
        update: {
          ...(p.userName ? { userName: p.userName } : {}),
          requests: { increment: inc.requests },
          inputTokens: { increment: inc.inputTokens },
          outputTokens: { increment: inc.outputTokens },
          cacheWriteTokens: { increment: inc.cacheWriteTokens },
          cacheReadTokens: { increment: inc.cacheReadTokens },
        },
      });
    } catch (e: any) {
      this.logger.warn(`usage not recorded: ${e?.message}`);
    }
  }

  /** The last `days` days (UTC, today included), summed per org and user. */
  async summary(days: number) {
    const to = usageDay();
    const from = usageDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const rows: UsageRow[] = await (this.prisma as any).aiUsageDaily.findMany({ where: { day: { gte: from, lte: to } } });
    const orgIds = [...new Set(rows.map((r) => r.organizationId))];
    const orgs: Array<{ id: string; name: string }> = orgIds.length ? await this.prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [];
    return { from, to, days, ...usageSummary(rows, new Map(orgs.map((o) => [o.id, o.name]))) };
  }
}
