import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { PrismaService } from '../common/prisma.service';

// ---------------------------------------------------------------------------
// Per-org WhatsApp AI agent. Training = WhatsAppQnA pairs (question embedded
// with text-embedding-3-small; cosine retrieval in Node — same approach as
// document-assistant). For each inbound message the agent drafts a reply and
// judges whether it falls inside the org's auto-send scope. The caller
// (WhatsAppService) decides what to do with the verdict: auto-send or queue a
// suggestion for human review.
// ---------------------------------------------------------------------------

const EMBED_MODEL = 'text-embedding-3-small';
// Haiku: short grounded CS replies don't need Sonnet; 3x cheaper per token.
const CLAUDE_MODEL = 'claude-haiku-4-5';
const TOP_K = 6;
// With this many pairs or fewer, ALL training examples go into the (cached)
// system prompt in stable order — no retrieval, no per-message embedding call.
// Larger sets fall back to top-K retrieval in the (uncached) user turn.
// Note: Haiku's minimum cacheable prefix is ~4096 tokens, so small orgs won't
// cache yet — the breakpoint is a no-op until their prompt grows past that.
const CACHE_ALL_PAIRS_THRESHOLD = 30;

export interface AgentVerdict {
  reply: string;
  canAutoSend: boolean;
  confidence: number; // 0..1
  reason: string;
}

@Injectable()
export class WhatsAppAgentService {
  private readonly logger = new Logger(WhatsAppAgentService.name);
  private readonly openai: OpenAI | null;
  private readonly anthropic: Anthropic | null;

  constructor(private readonly prisma: PrismaService) {
    const openaiKey = process.env.OPENAI_API_KEY;
    this.openai = openaiKey && openaiKey !== 'your_openai_api_key_here' ? new OpenAI({ apiKey: openaiKey }) : null;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  async getConfig(organizationId: string) {
    const config = await this.prisma.whatsAppAgentConfig.findUnique({ where: { organizationId } });
    return (
      config || {
        organizationId,
        enabled: false,
        autoSendEnabled: false,
        autoSendGuidance: null,
        aiGuidance: null,
      }
    );
  }

  async updateConfig(
    organizationId: string,
    data: { enabled?: boolean; autoSendEnabled?: boolean; autoSendGuidance?: string | null; aiGuidance?: string | null },
  ) {
    const clean = {
      enabled: !!data.enabled,
      autoSendEnabled: !!data.autoSendEnabled,
      autoSendGuidance: data.autoSendGuidance ?? null,
      aiGuidance: data.aiGuidance ?? null,
    };
    return this.prisma.whatsAppAgentConfig.upsert({
      where: { organizationId },
      update: clean,
      create: { organizationId, ...clean },
    });
  }

  // ── QnA training pairs ─────────────────────────────────────────────────────

  async listQnA(organizationId: string) {
    return this.prisma.whatsAppQnA.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, question: true, answer: true, createdAt: true },
    });
  }

  async addQnA(organizationId: string, question: string, answer: string) {
    if (!question?.trim() || !answer?.trim()) throw new BadRequestException('question and answer are required');
    const embedding = await this.embed(question.trim());
    const row = await this.prisma.whatsAppQnA.create({
      data: { organizationId, question: question.trim(), answer: answer.trim(), embedding: embedding ?? undefined },
    });
    return { id: row.id, question: row.question, answer: row.answer, createdAt: row.createdAt };
  }

  async deleteQnA(organizationId: string, id: string) {
    await this.prisma.whatsAppQnA.deleteMany({ where: { id, organizationId } });
    return { deleted: true };
  }

  // ── Core: draft a reply + auto-send verdict ────────────────────────────────

  /**
   * Best-effort link from a WhatsApp number to the org's Customer record —
   * matched on the last 8 digits of the phone. Returns a prompt-ready text
   * block (identity, outstanding balance, recent documents) or null.
   */
  async buildCustomerContext(organizationId: string, counterparty: string): Promise<string | null> {
    const digits = (counterparty || '').replace(/\D/g, '');
    if (digits.length < 8) return null;
    const tail = digits.slice(-8);

    const customers = await this.prisma.customer.findMany({
      where: { organizationId, phone: { not: null } },
      select: { id: true, name: true, customerCode: true, currency: true, phone: true },
    });
    const customer = customers.find((c) => (c.phone || '').replace(/\D/g, '').endsWith(tail));
    if (!customer) return null;

    const lines: string[] = [
      `Name: ${customer.name}${customer.customerCode ? ` (${customer.customerCode})` : ''}`,
      `Currency: ${customer.currency}`,
    ];

    const balance = await this.prisma.customerBalance.findFirst({
      where: { organizationId, customerId: customer.id },
      select: { currentBalance: true },
    });
    if (balance) lines.push(`Outstanding balance: ${customer.currency} ${balance.currentBalance.toFixed(2)}`);

    // Documents keep the customer inside the config JSON — filter by path,
    // defensively (older documents may store a different shape).
    try {
      const docs = await this.prisma.document.findMany({
        where: { organizationId, config: { path: ['customer', 'id'], equals: customer.id } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { type: true, name: true, status: true, createdAt: true },
      });
      if (docs.length) {
        lines.push('Recent documents:');
        for (const d of docs) {
          lines.push(`  - ${d.type} ${d.name || ''} (${d.status}, ${d.createdAt.toISOString().slice(0, 10)})`);
        }
      }
    } catch (e) {
      this.logger.warn(`Customer document lookup failed: ${(e as Error).message}`);
    }

    return lines.join('\n');
  }

  /**
   * Draft a reply for an inbound message. `history` is the recent conversation
   * (oldest first) used for context. Throws if the AI stack is unconfigured.
   */
  async draftReply(
    organizationId: string,
    inboundBody: string,
    history: Array<{ direction: string; body: string | null }> = [],
    customerContext: string | null = null,
  ): Promise<AgentVerdict> {
    if (!this.anthropic) throw new BadRequestException('AI agent is not configured (missing ANTHROPIC_API_KEY)');
    const config = await this.getConfig(organizationId);
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });

    // Small training sets: embed ALL pairs in the system prompt in a stable
    // order so the whole prefix is byte-identical across messages (cacheable).
    // Large sets: cosine-retrieve top-K into the user turn instead.
    const pairCount = await this.prisma.whatsAppQnA.count({ where: { organizationId } });
    let exampleBlock: string;
    let examplesInSystem = false;
    if (pairCount > 0 && pairCount <= CACHE_ALL_PAIRS_THRESHOLD) {
      const all = await this.prisma.whatsAppQnA.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // stable order — don't break the cache prefix
        select: { question: true, answer: true },
      });
      exampleBlock = all.map((e, i) => `Example ${i + 1}:\nCustomer: ${e.question}\nReply: ${e.answer}`).join('\n\n');
      examplesInSystem = true;
    } else if (pairCount > 0) {
      const examples = await this.similarQnA(organizationId, inboundBody);
      exampleBlock = examples
        .map((e, i) => `Example ${i + 1} (similarity ${e.score.toFixed(2)}):\nCustomer: ${e.question}\nReply: ${e.answer}`)
        .join('\n\n');
    } else {
      exampleBlock = '(no training examples yet)';
      examplesInSystem = true; // keep the placeholder in the stable prefix
    }

    const historyBlock = history.length
      ? history
          .slice(-30)
          .map((m) => `${m.direction === 'INBOUND' ? 'Customer' : 'Business'}: ${m.body || '(non-text message)'}`)
          .join('\n')
      : '(no prior conversation)';

    // Stable per-org prefix: base instructions + org guidance (+ all training
    // examples for small sets). Volatile content (customer record, history,
    // the new message) stays in the user turn, after the cache breakpoint.
    // NOTE: keep this byte-stable — no timestamps, no per-request values.
    const system = [
      `You are the WhatsApp customer-service agent for "${org?.name || 'this business'}".`,
      `Reply in the business's voice, concisely, in the customer's language. Use WhatsApp-appropriate plain text (no markdown headers).`,
      `Ground every reply in the training examples. If the examples don't cover the question, still draft the most helpful reply you can, but mark it as NOT auto-sendable.`,
      config.aiGuidance ? `Business instructions: ${config.aiGuidance}` : '',
      `If a CUSTOMER RECORD from our system is included in the message, use it to personalise the reply (greet by name, reference their documents/balance when relevant). Sharing a customer's own record with them is fine; never mention other customers.`,
      `AUTO-SEND POLICY: the business allows automatic (no human review) replies ONLY for messages of these kinds: ${
        config.autoSendGuidance?.trim() || '(none — nothing may be auto-sent)'
      }.`,
      `A reply is auto-sendable only when BOTH: (1) the customer's message clearly falls inside the allowed kinds, and (2) the training examples/business instructions give you the facts to answer with high confidence. Never auto-send guesses, prices you inferred, commitments, or anything about complaints/refunds/urgent issues.`,
      `Respond ONLY with JSON: {"reply": string, "canAutoSend": boolean, "confidence": number 0-1, "reason": string (one short sentence)}.`,
      examplesInSystem ? `TRAINING EXAMPLES:\n${exampleBlock}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const user = [
      examplesInSystem ? '' : `TRAINING EXAMPLES:\n${exampleBlock}`,
      customerContext ? `CUSTOMER RECORD:\n${customerContext}` : '',
      `RECENT CONVERSATION:\n${historyBlock}`,
      `NEW CUSTOMER MESSAGE:\n${inboundBody}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const resp = await this.anthropic.messages.create({
      model: CLAUDE_MODEL,
      // Long templated replies (e.g. multi-step payment instructions) plus the
      // JSON envelope overflowed 700 and arrived truncated/unparseable.
      max_tokens: 2000,
      // Cache breakpoint on the stable prefix; a silent no-op below the
      // model's minimum cacheable size, free savings once the org's prompt
      // grows past it.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = this.parseVerdict(text);
    if (!parsed) {
      if (resp.stop_reason === 'max_tokens') {
        throw new BadRequestException('AI reply was cut off before it could be parsed — try a shorter answer template');
      }
      throw new BadRequestException('AI returned an unparseable response');
    }
    return parsed;
  }

  private parseVerdict(text: string): AgentVerdict | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const json = JSON.parse(match[0]);
      if (typeof json.reply !== 'string' || !json.reply.trim()) return null;
      return {
        reply: json.reply.trim(),
        canAutoSend: !!json.canAutoSend,
        confidence: Math.max(0, Math.min(1, Number(json.confidence) || 0)),
        reason: String(json.reason || ''),
      };
    } catch {
      return null;
    }
  }

  // ── Retrieval ──────────────────────────────────────────────────────────────

  private async similarQnA(organizationId: string, query: string) {
    const rows = await this.prisma.whatsAppQnA.findMany({
      where: { organizationId },
      select: { question: true, answer: true, embedding: true },
    });
    if (!rows.length) return [];

    const queryVec = await this.embed(query);
    if (!queryVec) {
      // No embeddings available — fall back to most recent pairs.
      return rows.slice(0, TOP_K).map((r) => ({ question: r.question, answer: r.answer, score: 0 }));
    }
    return rows
      .map((r) => ({
        question: r.question,
        answer: r.answer,
        score: Array.isArray(r.embedding) ? this.cosine(queryVec, r.embedding as number[]) : 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
  }

  private async embed(input: string): Promise<number[] | null> {
    if (!this.openai) return null;
    try {
      const res = await this.openai.embeddings.create({ model: EMBED_MODEL, input });
      return res.data[0]?.embedding ?? null;
    } catch (e) {
      this.logger.warn(`Embedding failed: ${(e as Error).message}`);
      return null;
    }
  }

  private cosine(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }

  // ── Suggestions queue ──────────────────────────────────────────────────────

  async listSuggestions(organizationId: string, status?: string) {
    return this.prisma.whatsAppSuggestion.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Close all pending suggestions for one chat (human handled it another way). */
  async closePendingForCounterparty(organizationId: string, counterparty: string) {
    const digits = (counterparty || '').replace(/\D/g, '');
    if (!digits) return { closed: 0 };
    const res = await this.prisma.whatsAppSuggestion.updateMany({
      where: { organizationId, counterparty: { contains: digits.slice(-8) }, status: 'PENDING' },
      data: { status: 'HANDLED_MANUALLY' },
    });
    return { closed: res.count };
  }

  async dismissSuggestion(organizationId: string, id: string) {
    await this.prisma.whatsAppSuggestion.updateMany({
      where: { id, organizationId, status: 'PENDING' },
      data: { status: 'DISMISSED' },
    });
    return { dismissed: true };
  }
}
