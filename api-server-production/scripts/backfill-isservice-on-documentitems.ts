/**
 * One-time backfill: populate DocumentItem.isService from
 * ImportInvoice.lineItems[i].isService (camelCase only — verified there are
 * no snake_case occurrences in the codebase).
 *
 * Strategy:
 *   For each DocumentItem (paginated):
 *     - Find the parent Document.
 *     - Find the matching ImportInvoice by (name = Document.name, organizationId).
 *     - If no ImportInvoice → leave at default false (orphan).
 *     - Match the line item primarily by `lineNumber - 1` index into ImportInvoice.lineItems.
 *     - Fallback: match by (sku || description) if lineNumber-index gives no result or shape mismatch.
 *     - If matched line.isService === true → write DocumentItem.isService = true.
 *     - Otherwise leave default.
 *
 * Idempotent — re-running sets the same values.
 * Refuses on prod URLs.
 * Read-only on Document and ImportInvoice; writes only DocumentItem.isService.
 *
 * Run from api-server-production/:
 *   npx ts-node scripts/backfill-isservice-on-documentitems.ts
 */
import { PrismaClient } from '@prisma/client';

function describeDatabaseUrl(rawUrl: string | undefined): { display: string; isProd: boolean } {
  if (!rawUrl) return { display: '(unset)', isProd: false };
  let host = '(unparseable)';
  let dbName = '(unparseable)';
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    dbName = u.pathname.replace(/^\//, '') || '(none)';
  } catch {
    // fall through
  }
  const lower = rawUrl.toLowerCase();
  const isProd = lower.includes('prod') || lower.includes('production');
  return { display: `${host}/${dbName}`, isProd };
}

interface MatchResult {
  matched: boolean;
  isService: boolean;
  reason: 'lineNumber' | 'sku-description' | 'no-match';
}

function matchLineItem(
  lineItems: any[],
  docItem: { lineNumber: number | null; sku: string | null; description: string | null },
): MatchResult {
  // Primary: index by lineNumber - 1 (DocumentItem.lineNumber is 1-based)
  if (typeof docItem.lineNumber === 'number' && docItem.lineNumber > 0) {
    const idx = docItem.lineNumber - 1;
    if (idx < lineItems.length) {
      const li = lineItems[idx];
      if (li && (li.isService === true || li.isService === false)) {
        return { matched: true, isService: !!li.isService, reason: 'lineNumber' };
      }
    }
  }
  // Fallback: match by sku + description
  if (docItem.sku || docItem.description) {
    const candidate = lineItems.find((li: any) => {
      const liSku = li.selectedSku ?? li.asset_match?.sku ?? '';
      const liDesc = li.description ?? '';
      const skuMatch = !!docItem.sku && liSku === docItem.sku;
      const descMatch = !!docItem.description && liDesc === docItem.description;
      return skuMatch || descMatch;
    });
    if (candidate) {
      return { matched: true, isService: !!candidate.isService, reason: 'sku-description' };
    }
  }
  return { matched: false, isService: false, reason: 'no-match' };
}

async function main() {
  const { display, isProd } = describeDatabaseUrl(process.env.DATABASE_URL);
  if (isProd) {
    console.error(`REFUSING: DATABASE_URL points at ${display} which contains "prod"/"production". Exiting.`);
    process.exit(1);
  }
  console.log(`Backfilling DocumentItem.isService on host ${display}`);

  const prisma = new PrismaClient();
  try {
    const total = await prisma.documentItem.count();
    console.log(`Total DocumentItems: ${total}`);

    let scanned = 0;
    let servicesFound = 0;
    let productsKept = 0;
    let orphans = 0; // no matching ImportInvoice
    let unmatched = 0; // matched ImportInvoice but couldn't match line
    let errors = 0;
    let viaLineNumber = 0;
    let viaSkuFallback = 0;
    let netFlips = 0; // rows where isService actually changed (false → true)

    const PAGE = 500;
    let cursor: string | undefined = undefined;

    // Cache Documents we've already resolved to avoid re-querying
    // when many DocumentItems share a parent.
    const docCache = new Map<string, { name: string | null; organizationId: string }>();
    const importCache = new Map<string, any[] | null>(); // key: `${orgId}:${name}`

    while (true) {
      const batch: Array<{
        id: string;
        documentId: string;
        sku: string | null;
        description: string | null;
        lineNumber: number | null;
        isService: boolean;
      }> = await prisma.documentItem.findMany({
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          documentId: true,
          sku: true,
          description: true,
          lineNumber: true,
          isService: true,
        },
      });

      if (batch.length === 0) break;

      for (const di of batch) {
        scanned++;
        try {
          // Resolve document
          let doc = docCache.get(di.documentId);
          if (!doc) {
            const fetched = await prisma.document.findUnique({
              where: { id: di.documentId },
              select: { name: true, organizationId: true },
            });
            if (!fetched) {
              orphans++;
              continue;
            }
            doc = fetched;
            docCache.set(di.documentId, doc);
          }

          // Resolve ImportInvoice lineItems
          const cacheKey = `${doc.organizationId}:${doc.name}`;
          let lineItems = importCache.get(cacheKey);
          if (lineItems === undefined) {
            const inv = doc.name
              ? await prisma.importInvoice.findUnique({
                  where: {
                    invoiceNumber_organizationId: {
                      invoiceNumber: doc.name,
                      organizationId: doc.organizationId,
                    },
                  },
                  select: { lineItems: true },
                })
              : null;
            const items = Array.isArray(inv?.lineItems) ? (inv!.lineItems as any[]) : null;
            lineItems = items;
            importCache.set(cacheKey, items);
          }

          if (!lineItems) {
            orphans++;
            continue;
          }

          const result = matchLineItem(lineItems, di);
          if (!result.matched) {
            unmatched++;
            continue;
          }
          if (result.reason === 'lineNumber') viaLineNumber++;
          else if (result.reason === 'sku-description') viaSkuFallback++;

          // Idempotent write — only update if value differs.
          if (di.isService !== result.isService) {
            await prisma.documentItem.update({
              where: { id: di.id },
              data: { isService: result.isService },
            });
            if (result.isService) netFlips++; // false → true
          }
          if (result.isService) servicesFound++;
          else productsKept++;
        } catch (err: any) {
          errors++;
          console.warn(`  error on DocumentItem ${di.id}: ${err.message ?? err}`);
        }

        if (scanned % 100 === 0) {
          console.log(
            `  Scanned ${scanned}/${total} (services=${servicesFound}, products=${productsKept}, orphans=${orphans}, unmatched=${unmatched}, sku-fallback=${viaSkuFallback}, errors=${errors})`,
          );
        }
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < PAGE) break;
    }

    console.log('');
    console.log('================ Backfill summary ================');
    console.log(`Scanned                  : ${scanned}`);
    console.log(`Matched via lineNumber   : ${viaLineNumber}`);
    console.log(`Matched via sku/desc fb  : ${viaSkuFallback}`);
    console.log(`Orphans (no ImportInv)   : ${orphans}`);
    console.log(`Mismatches (no line)     : ${unmatched}`);
    console.log(`Services found           : ${servicesFound}`);
    console.log(`Products (false)         : ${productsKept}`);
    console.log(`Net flips (false → true) : ${netFlips}`);
    console.log(`Errors                   : ${errors}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
