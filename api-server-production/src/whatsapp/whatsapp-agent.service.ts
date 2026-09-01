import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI, { toFile } from 'openai';
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

// Strict template gate: the agent only replies when the incoming message is a
// close semantic match to a trained example. Below this cosine similarity we
// stay SILENT (no draft, no Claude call) — the business wants the agent to
// answer only the questions it was trained on, nothing else. Tunable via env.
const TEMPLATE_MATCH_THRESHOLD = Number(process.env.WHATSAPP_TEMPLATE_MATCH_THRESHOLD) || 0.5;

export interface AgentVerdict {
  reply: string;
  canAutoSend: boolean;
  confidence: number; // 0..1
  reason: string;
  onTemplate?: boolean; // false when the message didn't match any trained example
  matchScore?: number; // top cosine similarity to a trained example
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

  /** Transcribe a voice note / audio clip to text. Uses gpt-4o-transcribe
   *  (accurate on accented English) with whisper-1 fallback, and an optional
   *  `promptContext` (e.g. the org's customer/project names + domain words) that
   *  biases recognition so names and commands come through right. Returns null
   *  on failure so callers degrade gracefully. */
  async transcribeAudio(buffer: Buffer, mimetype: string, promptContext?: string): Promise<string | null> {
    if (!this.openai) {
      this.logger.warn('Transcription unavailable (no OPENAI_API_KEY)');
      return null;
    }
    const ext = mimetype.includes('ogg')
      ? 'ogg'
      : mimetype.includes('m4a') || mimetype.includes('mp4')
        ? 'm4a'
        : mimetype.includes('mpeg') || mimetype.includes('mp3')
          ? 'mp3'
          : mimetype.includes('wav')
            ? 'wav'
            : mimetype.includes('webm')
              ? 'webm'
              : 'ogg';
    const prompt = promptContext ? promptContext.slice(0, 900) : undefined;
    const attempt = async (model: string): Promise<string | null> => {
      // Fresh Uploadable per attempt — the stream is consumed on use.
      const file = await toFile(buffer, `voice.${ext}`, { type: mimetype || 'audio/ogg' });
      const res: any = await this.openai!.audio.transcriptions.create({
        file,
        model,
        ...(prompt ? { prompt } : {}),
      } as any);
      return String(res?.text || '').trim() || null;
    };
    try {
      return await attempt('gpt-4o-transcribe');
    } catch (e: any) {
      this.logger.warn(`gpt-4o-transcribe failed (${e.message}); falling back to whisper-1`);
      try {
        return await attempt('whisper-1');
      } catch (e2: any) {
        this.logger.error(`Transcription failed: ${e2.message}`);
        return null;
      }
    }
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

    // STRICT TEMPLATE GATE: score the closest trained example first. If nothing
    // is a close enough match, stay silent — don't draft, don't call Claude.
    const scored = pairCount > 0 ? await this.similarQnA(organizationId, inboundBody) : [];
    const bestScore = scored[0]?.score ?? 0;
    if (bestScore < TEMPLATE_MATCH_THRESHOLD) {
      return {
        reply: '',
        canAutoSend: false,
        confidence: bestScore,
        reason: `no trained example matched (best ${bestScore.toFixed(2)} < ${TEMPLATE_MATCH_THRESHOLD})`,
        onTemplate: false,
        matchScore: bestScore,
      };
    }

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
    } else {
      exampleBlock = scored
        .map((e, i) => `Example ${i + 1} (similarity ${e.score.toFixed(2)}):\nCustomer: ${e.question}\nReply: ${e.answer}`)
        .join('\n\n');
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
    return { ...parsed, onTemplate: true, matchScore: bestScore };
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

  /**
   * Parse a free-form appointment message posted in a group (the advisor writes
   * it however he likes, e.g. "Date: 26 June 2026 / Time: 3pm (Tentatively) /
   * Venue: ..."). Returns structured details, or null when the message is not
   * an appointment at all. `existing` lets the model recognise that a follow-up
   * message is a CHANGE to an appointment already captured rather than a new
   * one, which is what keeps a reschedule from creating duplicates.
   */
  async extractAppointment(
    text: string,
    nowIso: string,
    existing: Array<{ id: string; startsAt: string; topic: string | null }> = [],
  ): Promise<{
    isAppointment: boolean;
    updatesId: string | null;
    date: string | null;
    time: string | null;
    timeText: string | null;
    topic: string | null;
    venue: string | null;
    tentative: boolean;
  } | null> {
    if (!this.anthropic) throw new BadRequestException('AI agent is not configured (missing ANTHROPIC_API_KEY)');

    const system = [
      'You extract appointment details from WhatsApp messages sent by a financial adviser to his assistant.',
      `The current date/time is ${nowIso} (Asia/Singapore).`,
      'An APPOINTMENT message states a specific meeting: it has a date, and usually a time and/or venue.',
      'Chit-chat, questions, product info and general discussion are NOT appointments.',
      existing.length
        ? `Appointments already captured for this chat:\n${existing
            .map((e) => `- id=${e.id} starts=${e.startsAt} topic=${e.topic || 'n/a'}`)
            .join('\n')}\nIf the new message CHANGES one of these (a reschedule, a corrected time or venue), set updatesId to that id. Only treat it as new when it is clearly a different meeting.`
        : 'No appointments have been captured for this chat yet.',
      'Resolve relative dates ("next Tuesday", "tmr") against the current date. Interpret a bare year-less date as the next occurrence.',
      'Respond ONLY with JSON: {"isAppointment": boolean, "updatesId": string|null, "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "timeText": string|null, "topic": string|null, "venue": string|null, "tentative": boolean}.',
      'time is 24-hour. timeText preserves how it was written (e.g. "3pm (Tentatively)"). tentative is true if the message hedges the date/time/venue. topic is the meeting subject in a few words. Use null for anything absent.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const resp = await this.anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: text }],
    });
    const raw = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const j = JSON.parse(match[0]);
      if (!j?.isAppointment || !j?.date) return { ...j, isAppointment: false } as any;
      return {
        isAppointment: true,
        updatesId: j.updatesId || null,
        date: String(j.date),
        time: j.time ? String(j.time) : null,
        timeText: j.timeText ? String(j.timeText) : null,
        topic: j.topic ? String(j.topic) : null,
        venue: j.venue ? String(j.venue) : null,
        tentative: !!j.tentative,
      };
    } catch {
      return null;
    }
  }
}
