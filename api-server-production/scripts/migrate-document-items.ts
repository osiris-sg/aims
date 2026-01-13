import { PrismaClient, ItemType } from '@prisma/client';

const prisma = new PrismaClient();

const isDryRun = process.argv.includes('--dry-run');

interface MigrationStats {
  documentsProcessed: number;
  documentsWithItems: number;
  documentItemsCreated: number;
  itemsSkipped: number;
  errors: number;
}

async function migrateDocumentItems() {
  console.log('=== Migrating Document Items to Junction Table ===\n');

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const stats: MigrationStats = {
    documentsProcessed: 0,
    documentsWithItems: 0,
    documentItemsCreated: 0,
    itemsSkipped: 0,
    errors: 0,
  };

  // Get all documents
  const documents = await prisma.document.findMany({
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${documents.length} documents to process\n`);

  // Build a cache of inventory and asset IDs for faster lookups
  console.log('Building item cache...');
  const inventoryIds = new Set(
    (await prisma.inventory.findMany({ select: { id: true } })).map(i => i.id)
  );
  const assetIds = new Set(
    (await prisma.asset.findMany({ select: { id: true } })).map(a => a.id)
  );
  console.log(`Cached ${inventoryIds.size} inventory items and ${assetIds.size} assets\n`);

  // Process each document
  for (const doc of documents) {
    stats.documentsProcessed++;

    const config = doc.config as any;
    const items = config?.items;

    if (!items || !Array.isArray(items) || items.length === 0) {
      continue;
    }

    stats.documentsWithItems++;
    const documentItemsData: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemId = item.inventoryItemId || item.assetId;

      if (!itemId) {
        stats.itemsSkipped++;
        continue;
      }

      // Determine item type using cached lookups
      let itemType: ItemType;

      if (inventoryIds.has(itemId)) {
        itemType = ItemType.INVENTORY;
      } else if (assetIds.has(itemId)) {
        itemType = ItemType.ASSET;
      } else {
        // Item not found in either table
        console.warn(`  ⚠️  Item ${itemId} not found in Inventory or Asset table (doc: ${doc.id})`);
        stats.itemsSkipped++;
        continue;
      }

      documentItemsData.push({
        documentId: doc.id,
        itemId,
        itemType,
        sku: item.sku || item.skuKey || null,
        description: item.description || null,
        quantity: parseFloat(item.quantity) || 0,
        unitPrice: parseFloat(item.unitPrice) || 0,
        discount: parseFloat(item.discount) || 0,
        amount: parseFloat(item.amount) || 0,
        uom: item.uom || null,
        lineNumber: i + 1,
      });
    }

    if (documentItemsData.length > 0) {
      if (!isDryRun) {
        try {
          // Delete existing DocumentItems for this document (in case of re-run)
          await prisma.documentItem.deleteMany({
            where: { documentId: doc.id },
          });

          // Create new DocumentItems
          await prisma.documentItem.createMany({
            data: documentItemsData,
            skipDuplicates: true,
          });

          stats.documentItemsCreated += documentItemsData.length;
        } catch (error: any) {
          console.error(`  ❌ Error processing document ${doc.id}: ${error.message}`);
          stats.errors++;
        }
      } else {
        stats.documentItemsCreated += documentItemsData.length;
      }
    }

    // Progress indicator every 100 documents
    if (stats.documentsProcessed % 100 === 0) {
      console.log(`  Processed ${stats.documentsProcessed}/${documents.length} documents...`);
    }
  }

  console.log('\n=== Migration Complete ===\n');
  console.log('Summary:');
  console.log(`  Documents processed: ${stats.documentsProcessed}`);
  console.log(`  Documents with items: ${stats.documentsWithItems}`);
  console.log(`  DocumentItems ${isDryRun ? 'would be ' : ''}created: ${stats.documentItemsCreated}`);
  console.log(`  Items skipped (no ID or not found): ${stats.itemsSkipped}`);
  console.log(`  Errors: ${stats.errors}`);

  if (isDryRun) {
    console.log('\n🔍 This was a dry run. Run without --dry-run to apply changes.');
  }

  // Verify counts
  if (!isDryRun) {
    const totalDocumentItems = await prisma.documentItem.count();
    console.log(`\nTotal DocumentItem records in database: ${totalDocumentItems}`);
  }

  await prisma.$disconnect();
}

migrateDocumentItems().catch((error) => {
  console.error('Migration failed:', error);
  prisma.$disconnect();
  process.exit(1);
});
