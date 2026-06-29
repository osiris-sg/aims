import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { EmbeddingsService } from './embeddings.service';

// ---------------------------------------------------------------------------
// Conversational document-filling assistant. The editor's "Ask AI" sidebar
// POSTs the user's message plus the current draft here; we run a Claude
// tool-call loop (mirrors src/ask) that can search the org's past documents
// (semantic memory) and propose structured field values. The assistant never
// mutates the document — it returns a `proposal` patch the frontend renders as
// an Apply card the user confirms.
// ---------------------------------------------------------------------------

const MODEL = 'claude-sonnet-4-6';
const MAX_ITERATIONS = 6;

export type ProposalPatch = {
  documentInfo?: Record<string, any>;
  customer?: Record<string, any>;
  items?: Array<{
    description?: string;
    quantity?: number;
    unitPrice?: number;
    uom?: string;
    tax?: number | string;
  }>;
  note?: string;
  termsAndConditions?: string;
  footerMessage?: string;
};

export type AssistantSource = { documentId: string; name: string | null; type: string };

export type AssistantResult = {
  answer: string;
  proposal: ProposalPatch | null;
  sources: AssistantSource[];
  toolCalls: Array<{ name: string; input: any }>;
};

export type ChatAttachment = { name?: string; mediaType: string; base64: string };

export type ChatRequest = {
  documentType: string;
  documentId?: string;
  draft?: { formData?: any; items?: any[] };
  customerId?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachments?: ChatAttachment[];
};

@Injectable()
export class DocumentAssistantService {
  private readonly logger = new Logger(DocumentAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async chat(organizationId: string, req: ChatRequest): Promise<AssistantResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'AI assistant is not configured (missing ANTHROPIC_API_KEY)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const client = new Anthropic({ apiKey });
    const tools = this.buildTools();
    const toolCalls: Array<{ name: string; input: any }> = [];
    const sources: AssistantSource[] = [];
    // Proposals from multiple propose_document_fields calls are merged.
    let proposal: ProposalPatch | null = null;
    const mergeProposal = (patch: ProposalPatch) => {
      const prev = proposal || {};
      proposal = {
        ...prev,
        ...patch,
        documentInfo: { ...(prev.documentInfo || {}), ...(patch.documentInfo || {}) },
        customer: { ...(prev.customer || {}), ...(patch.customer || {}) },
        // items replace wholesale — a later call supersedes an earlier line set
        items: patch.items ?? prev.items,
      };
    };

    const systemPrompt = this.buildSystemPrompt(req);

    // First user turn carries the message plus any uploaded files (PDF/image).
    const firstContent: any[] = [];
    for (const att of req.attachments || []) {
      const isPdf = att.mediaType === 'application/pdf';
      if (isPdf) {
        firstContent.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: att.base64 },
        });
      } else {
        firstContent.push({
          type: 'image',
          source: { type: 'base64', media_type: att.mediaType || 'image/jpeg', data: att.base64 },
        });
      }
    }
    firstContent.push({ type: 'text', text: req.message });

    const messages: Anthropic.MessageParam[] = [
      ...(req.history || []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: firstContent },
    ];

    let iteration = 0;
    let finalText = '';

    while (iteration < MAX_ITERATIONS) {
      iteration += 1;

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 3000,
        system: systemPrompt,
        tools,
        messages,
      });

      const textBlocks = response.content.filter((b) => b.type === 'text');
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');

      if (textBlocks.length) {
        finalText = textBlocks.map((b) => (b as any).text).join('\n');
      }

      if (response.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
        break;
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const tu = block as Anthropic.ToolUseBlock;
        toolCalls.push({ name: tu.name, input: tu.input });
        try {
          const result = await this.runTool(
            organizationId,
            req,
            tu.name,
            tu.input as any,
            mergeProposal,
            sources,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result).slice(0, 100_000),
          });
        } catch (e: any) {
          this.logger.error(`Tool ${tu.name} failed: ${e?.message || e}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: `Error: ${e?.message || 'tool failed'}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return {
      answer: finalText || 'No response.',
      proposal,
      sources,
      toolCalls,
    };
  }

  // ---------- Prompt ----------

  private buildSystemPrompt(req: ChatRequest): string {
    const draft = req.draft || {};
    const draftJson = JSON.stringify(
      { formData: draft.formData, items: draft.items },
      null,
      0,
    ).slice(0, 12_000);

    return `You are a document-filling assistant inside the AIMS platform. The user is editing a "${req.documentType}" document and wants your help completing it. Today is ${new Date().toISOString().slice(0, 10)}.

Your job:
- Help the user fill in this document: write line-item descriptions, suggest quantities/prices, fill dates, references, customer details, notes, and terms.
- Descriptions you write for a customer-facing document (quotation, invoice, delivery order) MUST be simple, clear plain language that a client immediately understands what the quote/item is for. Avoid internal jargon and supplier part-number soup unless asked.
- Match the user's established style. Call search_past_documents to find how similar documents were filled before (especially for the same customer or product), and get_customer_history to see this customer's recent documents. Mirror their wording, structure, and pricing conventions.
- If the user uploaded a file, read it and extract the relevant fields.

How to respond:
- Put your natural-language reply (explanations, questions, what you did) in plain text.
- Whenever you have concrete values to fill in, call propose_document_fields with ONLY the fields you want to set. Do not invent prices or customer data you cannot derive — leave unknown fields out and ask the user instead.
- propose_document_fields does NOT change the document; the user reviews and clicks Apply. So it is safe to propose.
- Keep prose concise. One short paragraph is usually enough.

Current draft of the document (for context — do not repeat it back verbatim):
${draftJson}`;
  }

  // ---------- Tools ----------

  private buildTools(): Anthropic.Tool[] {
    return [
      {
        name: 'propose_document_fields',
        description:
          'Propose values to fill into the document. Include only the fields you want to set. The user reviews these as an Apply card before anything changes — safe to call.',
        input_schema: {
          type: 'object',
          properties: {
            documentInfo: {
              type: 'object',
              description:
                'Document-level fields, e.g. { "date": "2026-06-29", "paymentTerms": "30 DAYS", "referenceNo": "...", "validityTerm": "...", "currency": "SGD" }',
            },
            customer: {
              type: 'object',
              description: 'Customer fields: { name, address, email, gstRegNo, customerCode }',
            },
            items: {
              type: 'array',
              description: 'Line items to set on the document.',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string', description: 'Clear, client-friendly item description (plain text or simple HTML)' },
                  quantity: { type: 'number' },
                  unitPrice: { type: 'number' },
                  uom: { type: 'string' },
                  tax: { type: ['number', 'string'] as any, description: 'Tax % e.g. 9' },
                },
              },
            },
            note: { type: 'string', description: 'Footer note (client-facing).' },
            termsAndConditions: { type: 'string' },
            footerMessage: { type: 'string' },
          },
        },
      },
      {
        name: 'search_past_documents',
        description:
          "Semantic search over this organization's past documents. Use to find how similar documents were written before, or to pull data from an existing document (e.g. 'the quotation from ACME about the chiller'). Returns the closest matches with their content.",
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to look for, e.g. "VRV aircon installation quotation for ACME"' },
            customerId: { type: 'string', description: 'Optional — restrict to one customer id' },
            type: { type: 'string', description: 'Optional document type filter, e.g. QUOTATION, INVOICE, DO' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_customer_history',
        description:
          "Get this customer's most recent documents (full content) so you can mirror how the user fills documents for them. Use when a customer is selected.",
        input_schema: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            type: { type: 'string', description: 'Optional document type filter' },
            limit: { type: 'number', description: 'default 3, max 8' },
          },
          required: ['customerId'],
        },
      },
    ];
  }

  // ---------- Tool dispatch ----------

  private async runTool(
    organizationId: string,
    req: ChatRequest,
    name: string,
    input: any,
    mergeProposal: (p: ProposalPatch) => void,
    sources: AssistantSource[],
  ): Promise<any> {
    switch (name) {
      case 'propose_document_fields': {
        const patch: ProposalPatch = {
          documentInfo: input.documentInfo,
          customer: input.customer,
          items: Array.isArray(input.items) ? input.items : undefined,
          note: input.note,
          termsAndConditions: input.termsAndConditions,
          footerMessage: input.footerMessage,
        };
        mergeProposal(patch);
        return { ok: true, applied: 'queued for user review' };
      }

      case 'search_past_documents': {
        const matches = await this.embeddings.searchSimilar(organizationId, input.query, {
          customerId: input.customerId || req.customerId,
          type: input.type,
          k: 5,
        });
        const docs = await this.loadDocuments(
          organizationId,
          matches.map((m) => m.documentId),
        );
        for (const m of matches) {
          if (!sources.some((s) => s.documentId === m.documentId)) {
            sources.push({ documentId: m.documentId, name: m.name, type: m.type });
          }
        }
        return {
          results: matches.map((m) => ({
            documentId: m.documentId,
            name: m.name,
            type: m.type,
            score: Number(m.score.toFixed(3)),
            document: docs[m.documentId] || null,
          })),
        };
      }

      case 'get_customer_history': {
        const limit = Math.min(input.limit ?? 3, 8);
        const customerId = input.customerId || req.customerId;
        if (!customerId) return { error: 'No customerId provided' };
        const recent = await this.prisma.document.findMany({
          where: {
            organizationId,
            ...(input.type ? { type: input.type } : {}),
          },
          select: { id: true, name: true, type: true, config: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 200,
        });
        // config is JSON — filter by customer id in Node.
        const forCustomer = recent
          .filter((d) => {
            const c: any = d.config || {};
            return (c?.customer?.id || c?.customerId) === customerId;
          })
          .slice(0, limit);
        for (const d of forCustomer) {
          if (!sources.some((s) => s.documentId === d.id)) {
            sources.push({ documentId: d.id, name: d.name, type: d.type });
          }
        }
        return { documents: forCustomer.map((d) => this.condenseDocument(d)) };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  // Load + condense a set of documents keyed by id (for search results).
  private async loadDocuments(
    organizationId: string,
    ids: string[],
  ): Promise<Record<string, any>> {
    if (!ids.length) return {};
    const docs = await this.prisma.document.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, name: true, type: true, config: true, createdAt: true },
    });
    const out: Record<string, any> = {};
    for (const d of docs) out[d.id] = this.condenseDocument(d);
    return out;
  }

  // Trim a Document down to the fields useful for the model — keeps tool
  // results compact and strips HTML from descriptions.
  private condenseDocument(d: { name?: string | null; type?: string | null; config?: any; createdAt?: Date }): any {
    const c: any = d.config || {};
    const stripHtml = (s: any) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
      name: d.name,
      type: d.type,
      date: d.createdAt,
      customer: c?.customer ? { name: c.customer.name, address: c.customer.address } : undefined,
      items: Array.isArray(c?.items)
        ? c.items.slice(0, 50).map((it: any) => ({
            description: stripHtml(it?.description),
            quantity: it?.quantity,
            unitPrice: it?.unitPrice,
            uom: it?.uom,
          }))
        : [],
      note: stripHtml(c?.note || c?.notes),
      termsAndConditions: stripHtml(c?.termsAndConditions),
    };
  }
}
