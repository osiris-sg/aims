/**
 * Flag SIDS assets with their WaterSG product line.
 *
 * Logic:
 *   updateMany on Asset for the Biofuel org where skuKey = 'SIDS',
 *   setting waterSgProductLine = 'SIDS'.
 *
 * Additive / idempotent — re-running just re-writes the same value.
 *
 * Run (after `npm run db:push` so the new column exists):
 *   npx ts-node scripts/set-sids-product-line.ts
 */
import { PrismaClient } from '@prisma/client';

const ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel
const SKU_KEY = 'SIDS';
const PRODUCT_LINE = 'SIDS';

// Refuse to run against a production database.
const dbUrl = process.env.DATABASE_URL ?? '';
if (/prod|production/i.test(dbUrl)) {
  console.error(
    'Refusing to run: DATABASE_URL looks like a production database.\n' +
      'This backfill is intended for local/staging only.',
  );
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  let host = '(unparseable)';
  try {
    host = new URL(dbUrl || '(unset)').hostname;
  } catch {
    /* ignore */
  }
  console.log('────────────────────────────────────────────────────');
  console.log('Set WaterSG product line on SIDS assets');
  console.log('  org         :', ORG_ID);
  console.log('  database    :', host);
  console.log('  skuKey      :', SKU_KEY);
  console.log('  productLine :', PRODUCT_LINE);
  console.log('────────────────────────────────────────────────────');

  const result = await prisma.asset.updateMany({
    where: {
      organizationId: ORG_ID,
      skuKey: SKU_KEY,
    },
    data: {
      waterSgProductLine: PRODUCT_LINE,
    },
  });

  console.log('────────────────────────────────────────────────────');
  console.log('Summary');
  console.log('  assets updated :', result.count);
  console.log('Writes committed.');
}

main()
  .catch((e) => {
    console.error('Set product line failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
