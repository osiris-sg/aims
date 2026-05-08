/**
 * Backfill: re-translate every confirmed + skipped ImportInvoice
 * through the fixed ImportService.importSingleInvoice path.
 *
 * REFUSES if DATABASE_URL contains "prod" or "production".
 * Does NOT mutate ImportInvoice rows.
 *
 * Run from api-server-production/:
 *   npx ts-node scripts/backfill-imports.ts
 */
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../src/import/import.service';
import { PrismaService } from '../src/common/prisma.service';

const ORGANIZATION_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel

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

function safeParseDate(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

const METADATA_MARKERS = ['site location:', 'our qtn ref:', 'your works order', 'your fi ref'];

function looksLikeMetadata(li: any): boolean {
  if (li.is_reference_line) return true;
  const desc: string = (li.description ?? '').toLowerCase();
  if (METADATA_MARKERS.some((m) => desc.includes(m))) return true;
  const qty = Number(li.quantity ?? 0);
  const price = Number(li.unit_price ?? 0);
  if (qty === 0 && price === 0) return true;
  return false;
}

async function findOrCreateAsset(prisma: PrismaClient, li: any): Promise<{ id: string; created: boolean } | null> {
  // 1. honour stored selectedAssetId if it's still valid in current DB
  if (li.selectedAssetId) {
    const exists = await prisma.asset.findFirst({
      where: { id: li.selectedAssetId, organizationId: ORGANIZATION_ID, deletedAt: null },
    });
    if (exists) return { id: exists.id, created: false };
  }

  const sku: string | undefined = li.selectedSku || li.asset_match?.sku;
  const name: string | undefined = li.selectedAssetName || li.asset_match?.name;

  // 2. try lookup by SKU
  if (sku) {
    const found = await prisma.asset.findFirst({
      where: { skuKey: sku, organizationId: ORGANIZATION_ID, deletedAt: null },
    });
    if (found) return { id: found.id, created: false };
  }

  // 3. need both name AND sku to create
  if (!sku || !name) return null;

  const categoryName: string = li.assetCategory || li.asset_match?.category || 'General';
  let category = await prisma.category.findFirst({
    where: { name: categoryName, organizationId: ORGANIZATION_ID },
  });
  if (!category) {
    category = await prisma.category.create({
      data: { name: categoryName, organizationId: ORGANIZATION_ID },
    });
  }

  const created = await prisma.asset.create({
    data: {
      name,
      skuKey: sku,
      categoryId: category.id,
      uom: li.assetUom || 'PCS',
      isTracked: false,
      organizationId: ORGANIZATION_ID,
      price: typeof li.unit_price === 'number' ? li.unit_price : null,
    },
  });
  return { id: created.id, created: true };
}

async function findOrCreateProject(
  prisma: PrismaClient,
  inv: any,
): Promise<{ id: string; created: boolean } | null> {
  const searchTerm = (inv.projectLocation || inv.projectName || '').trim();
  if (!searchTerm) return null;

  const candidates = await prisma.project.findMany({
    where: { organizationId: ORGANIZATION_ID },
    select: { id: true, name: true },
  });
  const term = searchTerm.toLowerCase();
  const match = candidates.find((p) => p.name.toLowerCase().includes(term));
  if (match) return { id: match.id, created: false };

  const startDate = safeParseDate(inv.doDate) ?? safeParseDate(inv.date);
  const created = await prisma.project.create({
    data: {
      name: searchTerm,
      organizationId: ORGANIZATION_ID,
      status: 'ongoing',
      startDate,
    },
  });
  return { id: created.id, created: true };
}

interface BackfillResult {
  invoiceNumber: string;
  status: 'success' | 'skipped' | 'failed';
  reason?: string;
  message?: string;
}

async function main() {
  const { display, isProd } = describeDatabaseUrl(process.env.DATABASE_URL);
  if (isProd) {
    console.error(`REFUSING: DATABASE_URL points at ${display} which contains "prod"/"production". Exiting.`);
    process.exit(1);
  }
  console.log(`Backfilling on host ${display}`);

  const prisma = new PrismaClient();
  // PrismaService extends PrismaClient and only adds onModuleInit/onModuleDestroy.
  // For a script context, casting the client is sufficient.
  const importService = new ImportService(prisma as unknown as PrismaService);

  try {
    const invoices = await prisma.importInvoice.findMany({
      where: {
        organizationId: ORGANIZATION_ID,
        reviewStatus: { in: ['confirmed', 'skipped'] },
      },
      orderBy: { date: 'asc' },
    });

    const total = invoices.length;
    console.log(`Found ${total} ImportInvoices (confirmed + skipped) for backfill`);
    console.log('');

    const results: BackfillResult[] = [];
    const projectsCreatedIds = new Set<string>();
    const assetsCreatedIds = new Set<string>();
    let lastSuccessNumber = '';

    for (let i = 0; i < total; i++) {
      const inv = invoices[i];

      // Per-invoice preview log
      const lineItems = Array.isArray(inv.lineItems) ? (inv.lineItems as any[]) : [];
      console.log(
        `→ [${i + 1}/${total}] ${inv.invoiceNumber} | customer="${inv.customer ?? '?'}" | lineItems=${lineItems.length}`,
      );

      try {
        // Customer lookup (skip-not-fail)
        if (!inv.customer) {
          results.push({ invoiceNumber: inv.invoiceNumber, status: 'skipped', reason: 'customer empty' });
          console.log(`  skipping ${inv.invoiceNumber}: customer empty`);
          continue;
        }
        const customer = await prisma.customer.findFirst({
          where: { organizationId: ORGANIZATION_ID, name: { equals: inv.customer, mode: 'insensitive' } },
        });
        if (!customer) {
          results.push({ invoiceNumber: inv.invoiceNumber, status: 'skipped', reason: 'customer not found' });
          console.log(`  skipping ${inv.invoiceNumber}: customer not found`);
          continue;
        }

        // Project find-or-create
        const projectResult = await findOrCreateProject(prisma, inv);
        const projectId = projectResult?.id;
        if (projectResult?.created) projectsCreatedIds.add(projectResult.id);

        // Resolve assets per line and build the body.lineItems shape
        const resolved: any[] = [];
        for (const li of lineItems) {
          const isMetadata = looksLikeMetadata(li);
          if (isMetadata) {
            // Pass through with no asset binding so importSingleInvoice's `if (!item.inventoryItemId) continue` skips it.
            resolved.push({ ...li, selectedAssetId: null });
            continue;
          }

          const isService =
            (li.selectedSku ?? li.asset_match?.sku ?? '').startsWith('SVC-') ||
            (li.assetCategory ?? li.asset_match?.category) === 'Service' ||
            li.isService;

          const assetRes = await findOrCreateAsset(prisma, li);
          if (assetRes?.created) assetsCreatedIds.add(assetRes.id);

          resolved.push({
            ...li,
            selectedAssetId: assetRes?.id ?? null,
            selectedSku: li.selectedSku || li.asset_match?.sku || '',
            isService,
            // serialNumbers: prefer plural, fall back to singular variants used historically
            serialNumbers:
              li.serialNumbers ||
              li.serial_numbers ||
              (li.serial_number ? [li.serial_number] : []),
            assetUom: li.assetUom || 'PCS',
          });
        }

        // Build body — match the shape that handleConfirm sends.
        const body = {
          invoiceNumber: inv.invoiceNumber,
          date: inv.date || '',
          customer: customer.name, // canonical-cased name; importSingleInvoice does its own lookup
          status: inv.status || 'Draft',
          source: inv.source || 'Receivable Invoice',
          gross: inv.gross || 0,
          balance: inv.balance || 0,
          lineItems: resolved,
          projectLocation: inv.projectLocation || inv.projectName || '',
          projectId,
          siteOfficeId: undefined as string | undefined, // Phase 3 territory — leave null
          startDate: inv.doDate || inv.date || undefined,
          endDate: undefined as string | undefined,
        };

        const result = await importService.importSingleInvoice(body);

        if ((result as any)?.success === false) {
          // duplicate path — importSingleInvoice returns success:false with message:'Invoice already exists'
          results.push({
            invoiceNumber: inv.invoiceNumber,
            status: 'skipped',
            reason: 'idempotent (already imported)',
            message: (result as any)?.message,
          });
          console.log(`  skipped ${inv.invoiceNumber}: idempotent (already imported)`);
        } else {
          results.push({ invoiceNumber: inv.invoiceNumber, status: 'success' });
          lastSuccessNumber = inv.invoiceNumber;
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        results.push({ invoiceNumber: inv.invoiceNumber, status: 'failed', message: msg });
        console.log(`  FAILED ${inv.invoiceNumber}: ${msg}`);
      }

      // Progress every 50
      if ((i + 1) % 50 === 0) {
        console.log(
          `=== Processed ${i + 1}/${total} (last success: ${lastSuccessNumber || '—'}) ===`,
        );
      }
    }

    // Tally
    const success = results.filter((r) => r.status === 'success').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed');

    // Mode breakdown from the live DB
    const inventoryModeCount = await prisma.assignment.count({
      where: { inventoryId: { not: null } },
    });
    const assetModeCount = await prisma.assignment.count({
      where: { assetId: { not: null } },
    });
    const finalAssignmentCount = await prisma.assignment.count();
    const finalDocumentCount = await prisma.document.count();
    const finalProjectCount = await prisma.project.count();

    console.log('');
    console.log('================ Backfill summary ================');
    console.log(`Total: ${success} created, ${skipped} skipped (idempotency), ${failed.length} failed`);
    console.log('');
    console.log(`New Projects created  : ${projectsCreatedIds.size}`);
    console.log(`New Assets created    : ${assetsCreatedIds.size}`);
    console.log(`Total Documents now   : ${finalDocumentCount}`);
    console.log(`Total Projects now    : ${finalProjectCount}`);
    console.log(`Total Assignments now : ${finalAssignmentCount}`);
    console.log(`  inventory-mode      : ${inventoryModeCount}`);
    console.log(`  asset-mode          : ${assetModeCount}`);

    if (failed.length > 0) {
      console.log('');
      console.log('Failures:');
      for (const f of failed) {
        console.log(`  ${f.invoiceNumber}: ${f.message}`);
      }
    }

    // Skipped breakdown for visibility
    const skipReasons = new Map<string, number>();
    for (const r of results) {
      if (r.status === 'skipped' && r.reason) {
        skipReasons.set(r.reason, (skipReasons.get(r.reason) ?? 0) + 1);
      }
    }
    if (skipReasons.size > 0) {
      console.log('');
      console.log('Skip reasons:');
      for (const [reason, count] of skipReasons) {
        console.log(`  ${reason}: ${count}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
