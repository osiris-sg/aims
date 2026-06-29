/**
 * Backfill DocumentEmbedding rows for the AI Document Assistant's semantic
 * memory. Embeds each Document's text snippet (customer + item descriptions +
 * notes) with OpenAI text-embedding-3-small and stores it as a Float[] for
 * Node-side cosine search. Idempotent — only (re)embeds documents whose
 * embedding is missing or older than the document.
 *
 * Run from api-server-production/ (loads .env via Prisma):
 *   npx ts-node scripts/backfill-document-embeddings.ts            # all orgs
 *   npx ts-node scripts/backfill-document-embeddings.ts <orgId>    # one org
 *
 * Needs OPENAI_API_KEY in the active env file. Additive only — writes nothing
 * but DocumentEmbedding rows.
 */
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';

const EMBED_MODEL = 'text-embedding-3-small';
const prisma = new PrismaClient();

function buildSnippet(doc: { name?: string | null; type?: string | null; config?: any }): string {
  const config: any = doc.config || {};
  const parts: string[] = [];
  if (doc.type) parts.push(`Type: ${doc.type}`);
  if (doc.name) parts.push(`No: ${doc.name}`);
  const customerName = config?.customer?.name;
  if (customerName) parts.push(`Customer: ${customerName}`);
  const items: any[] = Array.isArray(config?.items) ? config.items : [];
  const itemText = items
    .map((it) => {
      const desc = String(it?.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const qty = it?.quantity != null ? `x${it.quantity}` : '';
      return [desc, qty].filter(Boolean).join(' ');
    })
    .filter(Boolean);
  if (itemText.length) parts.push(`Items: ${itemText.join('; ')}`);
  const notes = String(config?.notes || config?.note || '').replace(/<[^>]+>/g, ' ').trim();
  if (notes) parts.push(`Notes: ${notes}`);
  return parts.join('\n').slice(0, 8000);
}

async function main() {
  const orgArg = process.argv[2];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'your_openai_api_key_here') {
    console.error('❌ OPENAI_API_KEY not set in the active env file.');
    process.exit(1);
  }
  const openai = new OpenAI({ apiKey });

  const where = orgArg ? { organizationId: orgArg } : {};
  const docs = await prisma.document.findMany({
    where,
    select: { id: true, organizationId: true, name: true, type: true, config: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  console.log(`Found ${docs.length} documents${orgArg ? ` for org ${orgArg}` : ' (all orgs)'}.`);

  const existing = await prisma.documentEmbedding.findMany({
    where: orgArg ? { organizationId: orgArg } : {},
    select: { documentId: true, updatedAt: true },
  });
  const byDoc = new Map(existing.map((e) => [e.documentId, e.updatedAt]));

  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const d of docs) {
    const emb = byDoc.get(d.id);
    if (emb && emb >= d.updatedAt) {
      skipped += 1;
      continue;
    }
    const snippet = buildSnippet(d);
    if (!snippet.trim()) {
      skipped += 1;
      continue;
    }
    try {
      const res = await openai.embeddings.create({ model: EMBED_MODEL, input: snippet });
      const vector = res.data[0]?.embedding;
      if (!vector) {
        failed += 1;
        continue;
      }
      const customerId = (d.config as any)?.customer?.id || (d.config as any)?.customerId || null;
      await prisma.documentEmbedding.upsert({
        where: { documentId: d.id },
        create: {
          organizationId: d.organizationId,
          documentId: d.id,
          type: d.type || 'UNKNOWN',
          customerId,
          textSnippet: snippet,
          embedding: vector,
        },
        update: {
          type: d.type || 'UNKNOWN',
          customerId,
          textSnippet: snippet,
          embedding: vector,
        },
      });
      embedded += 1;
      if (embedded % 25 === 0) console.log(`  …embedded ${embedded}`);
    } catch (e: any) {
      failed += 1;
      console.warn(`  embed failed for ${d.id}: ${e?.message || e}`);
    }
  }

  console.log(`Done. embedded=${embedded} skipped=${skipped} failed=${failed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
