/**
 * Live test of the Work Library price-list import (guru 2026-09-16): run 5
 * real contractor lists from CIEL's Drive through importPricelist (Claude
 * parse) + importPricelistApply (create work items) against the DEV org, so
 * the results show on localhost Work Library.
 *
 *   npx ts-node --transpile-only scripts/_test-pricelist-import.ts
 */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { RevenueItemsService } from '../src/revenue-items/revenue-items.service';

const prisma = new PrismaClient();
const CIEL_DEV = '5a12a9f9-f139-44e8-ab68-dd63f1c23ae3';
const DIR = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/d0657441-41a7-4694-a072-9c6e026312ef/scratchpad';

const FILES: Array<{ file: string; mime: string; supplier?: string }> = [
  { file: 'cowboy_tiling.pdf', mime: 'application/pdf', supplier: 'Cowboy Design' },
  { file: 'daco_hacking.pdf', mime: 'application/pdf', supplier: 'DACO Interior' },
  { file: 'sg_plumbing.pdf', mime: 'application/pdf', supplier: 'SG Plumbing Origin' },
  { file: 'kiong_paint.jpeg', mime: 'image/jpeg', supplier: 'Kiong Paintworks' },
  { file: 'glass_general.pdf', mime: 'application/pdf' },
];

async function main() {
  const svc = new RevenueItemsService(prisma as any);
  for (const f of FILES) {
    const started = Date.now();
    try {
      const dataUri = `data:${f.mime};base64,${fs.readFileSync(`${DIR}/${f.file}`).toString('base64')}`;
      const parsed = await svc.importPricelist(CIEL_DEV, { file: dataUri, filename: f.file, supplierName: f.supplier });
      console.log(`\n📄 ${f.file} → supplier "${parsed.supplierName}" · trade "${parsed.trade}" · ${parsed.items.length} items (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      if (parsed.conditions.length) console.log(`   conditions: ${parsed.conditions.slice(0, 3).join(' · ')}${parsed.conditions.length > 3 ? ' …' : ''}`);
      for (const i of parsed.items.slice(0, 5)) console.log(`   • ${i.name} — $${i.unitCost}/${i.uom} [${i.section}]`);
      if (parsed.items.length > 5) console.log(`   … +${parsed.items.length - 5} more`);
      const res = await svc.importPricelistApply(CIEL_DEV, { supplierName: parsed.supplierName, items: parsed.items });
      console.log(`   ✔ created ${res.created}${res.newSections.length ? ` · new sections: ${res.newSections.join(', ')}` : ''}`);
    } catch (e: any) {
      console.log(`\n❌ ${f.file}: ${e.message}`);
    }
  }
  const total = await prisma.revenueItem.count({ where: { organizationId: CIEL_DEV, workSectionId: { not: null } } });
  console.log(`\nWork Library (dev CIEL) now holds ${total} work items.`);
}

main().finally(() => prisma.$disconnect());
