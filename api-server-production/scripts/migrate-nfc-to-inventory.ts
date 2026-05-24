/**
 * One-off migration: move the two NFC tag bindings currently on Asset rows
 * (LION375 + LION376 in org d068f159-…) onto Inventory rows under a single
 * parent Asset "LION375". Run after `prisma db push` has added the new
 * Inventory.nfcTagUid + Inventory.serialNumber columns.
 *
 * Strategy (keeps both original Asset rows intact in case any DO references
 * them — they're only "cleaned up" to the extent of having nfcTagUid nulled):
 *   1. Reuse the existing LION375 Asset row as the parent SKU. Change its
 *      skuKey from "MG20240037" to "LION375" so it acts as a clean SKU.
 *   2. Null Asset.nfcTagUid on both LION375 and LION376.
 *   3. Create 2 Inventory rows under the LION375 Asset, each carrying one
 *      of the two original NFC UIDs.
 *
 * Idempotent: re-running detects whether the inventories already exist and
 * exits cleanly. Safe to run twice.
 *
 *   Usage:  npx dotenv -e .env -- ts-node scripts/migrate-nfc-to-inventory.ts
 */

import { PrismaClient } from '@prisma/client';

const ORG_ID = 'd068f159-e45a-4da8-beaf-62e903f44141';
const LION375_ASSET_ID = 'a53e34a2-cb98-477a-bb7c-d4e2daf5a180'; // name=LION375, skuKey=MG20240037
const LION376_ASSET_ID = 'ab0ee29b-a6eb-4b8b-99b2-e9f97311bfb0'; // name=LION376, skuKey=MG20240037
const LION375_NFC = '99:72:d4:01:00:00:02';
const LION376_NFC = '99:78:63:01:00:00:02';

async function main() {
  const prisma = new PrismaClient();
  try {
    // Idempotency check: if either NFC UID is already on an Inventory row,
    // the migration has run. Bail without touching anything.
    const alreadyMigrated = await prisma.inventory.findFirst({
      where: { nfcTagUid: { in: [LION375_NFC, LION376_NFC] } },
    });
    if (alreadyMigrated) {
      console.log('Migration already applied — found Inventory row(s) with the target NFC UIDs. Exiting.');
      return;
    }

    const lion375 = await prisma.asset.findFirst({
      where: { id: LION375_ASSET_ID, organizationId: ORG_ID },
    });
    const lion376 = await prisma.asset.findFirst({
      where: { id: LION376_ASSET_ID, organizationId: ORG_ID },
    });

    if (!lion375 || !lion376) {
      console.error('Expected LION375 / LION376 Asset rows not found. Aborting.');
      process.exit(1);
    }

    console.log('Before:');
    console.log('  LION375:', { id: lion375.id, name: lion375.name, skuKey: lion375.skuKey, nfcTagUid: lion375.nfcTagUid });
    console.log('  LION376:', { id: lion376.id, name: lion376.name, skuKey: lion376.skuKey, nfcTagUid: lion376.nfcTagUid });

    await prisma.$transaction(async (tx) => {
      // 1. Promote LION375 to be the parent SKU. New skuKey must be unique
      //    within (skuKey, orgId, deletedAt: null) — verified by absence below.
      const skuConflict = await tx.asset.findFirst({
        where: { skuKey: 'LION375', organizationId: ORG_ID, deletedAt: null, id: { not: lion375.id } },
      });
      if (skuConflict) {
        throw new Error(`skuKey 'LION375' is already used by Asset ${skuConflict.id}. Cannot promote.`);
      }
      await tx.asset.update({
        where: { id: lion375.id },
        data: { skuKey: 'LION375', nfcTagUid: null },
      });

      // 2. Null the leftover LION376 binding. Keep the row — it may be
      //    referenced by historical DocumentItems.
      await tx.asset.update({
        where: { id: lion376.id },
        data: { nfcTagUid: null },
      });

      // 3. Create the two Inventory units under the (now) LION375 SKU.
      //    sku format mirrors generateSkuRange (skuKey-NNN, zero-padded).
      await tx.inventory.create({
        data: {
          assetId: lion375.id,
          sku: 'LION375-001',
          category: 'Equipment',
          status: 'instock',
          organizationId: ORG_ID,
          nfcTagUid: LION375_NFC,
          serialNumber: null,
        },
      });
      await tx.inventory.create({
        data: {
          assetId: lion375.id,
          sku: 'LION375-002',
          category: 'Equipment',
          status: 'instock',
          organizationId: ORG_ID,
          nfcTagUid: LION376_NFC,
          serialNumber: null,
        },
      });
    });

    const afterAssets = await prisma.asset.findMany({
      where: { id: { in: [LION375_ASSET_ID, LION376_ASSET_ID] } },
      select: { id: true, name: true, skuKey: true, nfcTagUid: true },
    });
    const afterInventories = await prisma.inventory.findMany({
      where: { assetId: LION375_ASSET_ID },
      select: { id: true, sku: true, nfcTagUid: true, status: true },
    });
    console.log('After:');
    console.log('  Assets:', afterAssets);
    console.log('  Inventories:', afterInventories);
    console.log('Migration complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
