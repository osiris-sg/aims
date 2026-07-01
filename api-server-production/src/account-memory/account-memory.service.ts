import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EmbeddingsService } from '../document-assistant/embeddings.service';

export type LearnedSuggestion = {
  accountId: string | null;
  code: string;
  name: string;
  confidence: number;
  reason: string;
  source: 'learned';
};

const SEMANTIC_THRESHOLD = 0.82;

/**
 * Learned account-coding memory. Records every accountant override of the AI's
 * suggested GL account, then resolves future lines to the same account —
 * deterministically (exact / keyword) first, then by embedding similarity.
 * Falls back to nothing (caller then uses the AI) when unlearned.
 */
@Injectable()
export class AccountMemoryService {
  private readonly logger = new Logger(AccountMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  private normalize(s?: string | null): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Resolve each description to a learned account (or null). Order:
   *   1. exact normalized match
   *   2. keyword/substring match (rule phrase ⊆ line, or line ⊆ rule phrase)
   *   3. embedding cosine similarity ≥ threshold
   */
  async resolveBatch(organizationId: string, side: string, descriptions: string[]): Promise<Array<LearnedSuggestion | null>> {
    const out: Array<LearnedSuggestion | null> = descriptions.map(() => null);
    const rules = await this.prisma.accountMemory.findMany({ where: { organizationId, side } });
    if (rules.length === 0) return out;

    // Resolve account names for the codes referenced by rules (for display).
    const codes = Array.from(new Set(rules.map((r) => r.accountCode)));
    const accts = await this.prisma.chartOfAccount.findMany({ where: { organizationId, code: { in: codes } }, select: { id: true, code: true, name: true } });
    const acctByCode = new Map(accts.map((a) => [a.code, a]));
    const make = (r: { accountCode: string; accountId: string | null; count: number }, confidence: number, reason: string): LearnedSuggestion => {
      const a = acctByCode.get(r.accountCode);
      return { accountId: r.accountId ?? a?.id ?? null, code: r.accountCode, name: a?.name ?? r.accountCode, confidence, reason, source: 'learned' };
    };

    const unresolved: number[] = [];
    for (let i = 0; i < descriptions.length; i++) {
      const norm = this.normalize(descriptions[i]);
      if (!norm) continue;
      let hit = rules.find((r) => r.normalizedText === norm);
      if (!hit) hit = rules.find((r) => r.normalizedText.length >= 6 && (norm.includes(r.normalizedText) || r.normalizedText.includes(norm)));
      if (hit) out[i] = make(hit, 0.99, `Learned from your coding (${hit.count}×)`);
      else unresolved.push(i);
    }

    // Semantic layer for the rest (only if embeddings are available).
    const rulesWithVec = rules.filter((r) => Array.isArray(r.embedding) && (r.embedding as number[]).length > 0);
    if (unresolved.length > 0 && rulesWithVec.length > 0) {
      for (const i of unresolved) {
        let vec: number[] | null = null;
        try { vec = await this.embeddings.embed(this.normalize(descriptions[i])); } catch { vec = null; }
        if (!vec) continue;
        let best: (typeof rulesWithVec)[number] | null = null;
        let bestScore = 0;
        for (const r of rulesWithVec) {
          const s = EmbeddingsService.cosine(vec, r.embedding as number[]);
          if (s > bestScore) { bestScore = s; best = r; }
        }
        if (best && bestScore >= SEMANTIC_THRESHOLD) out[i] = make(best, Math.round(bestScore * 100) / 100, `Similar to your past coding (${Math.round(bestScore * 100)}%)`);
      }
    }
    return out;
  }

  /** Record accountant corrections (description → chosen account). Idempotent upsert. */
  async record(organizationId: string, side: string, corrections: Array<{ text?: string; accountCode?: string; accountId?: string | null }>): Promise<number> {
    let saved = 0;
    for (const c of corrections) {
      const norm = this.normalize(c.text);
      if (!norm || !c.accountCode) continue;
      let vec: number[] | null = null;
      try { vec = await this.embeddings.embed(norm); } catch { vec = null; }
      try {
        await this.prisma.accountMemory.upsert({
          where: { organizationId_side_normalizedText: { organizationId, side, normalizedText: norm } },
          update: { accountCode: c.accountCode, accountId: c.accountId ?? undefined, count: { increment: 1 }, ...(vec ? { embedding: vec } : {}) },
          create: { organizationId, side, text: (c.text || '').slice(0, 500), normalizedText: norm, accountCode: c.accountCode, accountId: c.accountId ?? null, count: 1, embedding: vec ?? [] },
        });
        saved++;
      } catch (e: any) {
        this.logger.warn(`record failed for "${norm.slice(0, 40)}": ${e?.message}`);
      }
    }
    return saved;
  }
}
