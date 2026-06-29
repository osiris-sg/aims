import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../common/prisma.service';

// ---------------------------------------------------------------------------
// Semantic memory over an org's past documents. Each Document gets a small
// text "snippet" (customer + item descriptions + notes) embedded with OpenAI
// text-embedding-3-small and stored on DocumentEmbedding.embedding (Float[]).
// Similarity search runs in Node (cosine) — no pgvector needed at current
// volumes. Embeddings are kept fresh lazily: searchSimilar() first syncs any
// document whose embedding is missing or older than the document itself.
// ---------------------------------------------------------------------------

const EMBED_MODEL = 'text-embedding-3-small'; // 1536 dims
// Cap how many stale/missing docs we embed per search call so a cold org
// doesn't blow the request budget — the backfill script handles bulk.
const SYNC_LIMIT = 40;

export type SimilarDoc = {
  documentId: string;
  type: string;
  name: string | null;
  customerId: string | null;
  score: number;
  snippet: string;
};

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private openai: OpenAI | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    this.openai =
      apiKey && apiKey !== 'your_openai_api_key_here'
        ? new OpenAI({ apiKey })
        : null;
  }

  get isConfigured(): boolean {
    return !!this.openai;
  }

  // Build the text we embed / show as a search result from a Document's config.
  buildSnippet(doc: { name?: string | null; type?: string | null; config?: any }): string {
    const config: any = doc.config || {};
    const parts: string[] = [];
    if (doc.type) parts.push(`Type: ${doc.type}`);
    if (doc.name) parts.push(`No: ${doc.name}`);
    const customerName = config?.customer?.name;
    if (customerName) parts.push(`Customer: ${customerName}`);
    const items: any[] = Array.isArray(config?.items) ? config.items : [];
    const itemText = items
      .map((it) => {
        // descriptions are HTML — strip tags for a clean embedding input
        const desc = String(it?.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const qty = it?.quantity != null ? `x${it.quantity}` : '';
        return [desc, qty].filter(Boolean).join(' ');
      })
      .filter(Boolean);
    if (itemText.length) parts.push(`Items: ${itemText.join('; ')}`);
    const notes = String(config?.notes || config?.note || '').replace(/<[^>]+>/g, ' ').trim();
    if (notes) parts.push(`Notes: ${notes}`);
    return parts.join('\n').slice(0, 8000); // keep well under token limits
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this.openai) return null;
    const input = (text || '').trim();
    if (!input) return null;
    const res = await this.openai.embeddings.create({ model: EMBED_MODEL, input });
    return res.data[0]?.embedding ?? null;
  }

  static cosine(a: number[], b: number[]): number {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  // Embed any of the org's documents whose embedding is missing or stale.
  async syncOrgEmbeddings(organizationId: string, limit = SYNC_LIMIT): Promise<void> {
    if (!this.openai) return;
    const docs = await this.prisma.document.findMany({
      where: { organizationId },
      select: { id: true, name: true, type: true, config: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 500, // bound the scan; newest docs matter most for "last time" style
    });
    const existing = await this.prisma.documentEmbedding.findMany({
      where: { organizationId },
      select: { documentId: true, updatedAt: true },
    });
    const byDoc = new Map(existing.map((e) => [e.documentId, e.updatedAt]));

    const stale = docs.filter((d) => {
      const emb = byDoc.get(d.id);
      return !emb || emb < d.updatedAt;
    });
    if (!stale.length) return;

    for (const d of stale.slice(0, limit)) {
      try {
        const snippet = this.buildSnippet(d);
        const vector = await this.embed(snippet);
        if (!vector) continue;
        await this.upsert(organizationId, d, snippet, vector);
      } catch (e: any) {
        this.logger.warn(`Embed failed for doc ${d.id}: ${e?.message || e}`);
      }
    }
  }

  async upsert(
    organizationId: string,
    doc: { id: string; type?: string | null; config?: any },
    snippet: string,
    vector: number[],
  ): Promise<void> {
    const customerId = (doc.config as any)?.customer?.id || (doc.config as any)?.customerId || null;
    await this.prisma.documentEmbedding.upsert({
      where: { documentId: doc.id },
      create: {
        organizationId,
        documentId: doc.id,
        type: doc.type || 'UNKNOWN',
        customerId,
        textSnippet: snippet,
        embedding: vector,
      },
      update: {
        type: doc.type || 'UNKNOWN',
        customerId,
        textSnippet: snippet,
        embedding: vector,
      },
    });
  }

  async searchSimilar(
    organizationId: string,
    query: string,
    opts: { customerId?: string; type?: string; k?: number } = {},
  ): Promise<SimilarDoc[]> {
    if (!this.openai) return [];
    const k = opts.k ?? 5;
    await this.syncOrgEmbeddings(organizationId);

    const queryVec = await this.embed(query);
    if (!queryVec) return [];

    const rows = await this.prisma.documentEmbedding.findMany({
      where: {
        organizationId,
        ...(opts.type ? { type: opts.type } : {}),
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
      },
      select: {
        documentId: true,
        type: true,
        customerId: true,
        textSnippet: true,
        embedding: true,
        document: { select: { name: true } },
      },
    });

    return rows
      .map((r) => ({
        documentId: r.documentId,
        type: r.type,
        name: r.document?.name ?? null,
        customerId: r.customerId,
        score: EmbeddingsService.cosine(queryVec, r.embedding as number[]),
        snippet: r.textSnippet,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
