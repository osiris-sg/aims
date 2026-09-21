/**
 * Find an asset/product by loose keyword across EVERY org — shows what the
 * Operator's find_item would miss (it does one literal substring match,
 * scoped to the current org).
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_find-item-anywhere.ts lion dotenv_config_path=.env.production
 *   ... scripts/_find-item-anywhere.ts "lion 250" ...
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const terms = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.startsWith('dotenv_'));
  if (!terms.length) throw new Error('Pass one or more keywords, e.g. lion');

  // Every term must appear somewhere — the tokenised search find_item lacks.
  const where: any = {
    deletedAt: null,
    AND: terms.flatMap((t) =>
      t.split(/\s+/).filter(Boolean).map((word) => ({
        OR: [
          { name: { contains: word, mode: 'insensitive' } },
          { skuKey: { contains: word, mode: 'insensitive' } },
          { description: { contains: word, mode: 'insensitive' } },
        ],
      })),
    ),
  };

  const rows = await prisma.asset.findMany({
    where,
    select: {
      id: true, name: true, skuKey: true, description: true, price: true,
      uom: true, organizationId: true,
    },
    take: 40,
  });
  if (!rows.length) {
    console.log(`Nothing matches ${terms.map((t) => `"${t}"`).join(' + ')} in ANY org.`);
    console.log('So it genuinely is not in the system — a non-stock line is the right call.');
    return;
  }
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name || id;

  console.log(`${rows.length} match(es):\n`);
  for (const r of rows) {
    console.log(`  ${r.name}`);
    console.log(`    sku:  ${r.skuKey || '(none)'}`);
    console.log(`    org:  ${orgName(r.organizationId)}`);
    console.log(`    price:${r.price ?? '(none)'}  uom: ${r.uom || 'PCS'}`);
    if (r.description) console.log(`    desc: ${String(r.description).slice(0, 80)}`);
    console.log(`    id:   ${r.id}\n`);
  }
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
