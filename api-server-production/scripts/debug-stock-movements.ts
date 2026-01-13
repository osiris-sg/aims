import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debug() {
  // Find the asset "test1"
  const asset = await prisma.asset.findFirst({
    where: {
      OR: [
        { skuKey: 'test1' },
        { name: 'test1' }
      ]
    }
  });

  console.log('\n=== Asset "test1" ===');
  if (asset) {
    console.log('Full asset record:', JSON.stringify(asset, null, 2));
  } else {
    console.log('Not found');
    await prisma.$disconnect();
    return;
  }

  // Check DocumentItem records for this asset
  const documentItems = await prisma.documentItem.findMany({
    where: { itemId: asset.id },
    include: { document: true }
  });

  console.log('\n=== DocumentItem records for this asset ===');
  console.log('Found:', documentItems.length, 'records');
  for (const di of documentItems) {
    console.log('  - Doc:', di.document.name || di.document.id.slice(0,8));
    console.log('    Type:', di.document.type, '| Status:', di.document.status, '| Qty:', di.quantity);
  }

  // Check documents that might contain this item in config.items (but not in DocumentItem table)
  const allDocs = await prisma.document.findMany({
    where: { organizationId: asset.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  console.log('\n=== Documents containing this item (from config.items JSON) ===');
  let docsWithItem = 0;
  for (const doc of allDocs) {
    const config = doc.config as any;
    if (config?.items?.length > 0) {
      const matchingItems = config.items.filter((item: any) =>
        item.inventoryItemId === asset.id || item.assetId === asset.id
      );
      if (matchingItems.length > 0) {
        docsWithItem++;
        console.log('  -', doc.name || doc.id.slice(0,8), '| Type:', doc.type, '| Status:', doc.status);
        for (const item of matchingItems) {
          console.log('      inventoryItemId:', item.inventoryItemId);
          console.log('      assetId:', item.assetId);
          console.log('      qty:', item.quantity);
        }
      }
    }
  }
  console.log('Total docs with this item in config.items:', docsWithItem);

  // Show all DocumentItem count
  const totalDocItems = await prisma.documentItem.count();
  console.log('\n=== Total DocumentItem records in DB:', totalDocItems, '===');

  // Check ALL documents in org that have items
  console.log('\n=== ALL documents with items in this organization ===');
  let docsWithAnyItems = 0;
  for (const doc of allDocs) {
    const config = doc.config as any;
    if (config?.items?.length > 0) {
      docsWithAnyItems++;
      console.log('  -', doc.name || doc.id.slice(0,8), '| Type:', doc.type, '| Status:', doc.status);
      console.log('    Items count:', config.items.length);
      for (const item of config.items.slice(0, 3)) {
        console.log('      -> inventoryItemId:', item.inventoryItemId, '| sku:', item.sku || item.skuKey);
      }
      if (config.items.length > 3) {
        console.log('      ... and', config.items.length - 3, 'more items');
      }
    }
  }
  console.log('Total docs with any items:', docsWithAnyItems);

  await prisma.$disconnect();
}

debug().catch(console.error);
