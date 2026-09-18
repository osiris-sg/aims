/**
 * Round 2 of the contractor price-list import into PROD CIEL: the remaining
 * 18 lists from the Drive "Contractor Price List" folder (mode 'update' so a
 * supplier's second file — e.g. Ah Yang's PVC photo — merges instead of
 * duplicating). Skipped for now: the 16MB Budget Home sanitary catalogue and
 * the 7.8MB OMG glass list.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_import-pricelists-round2.ts
 */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { RevenueItemsService } from '../src/revenue-items/revenue-items.service';

const prisma = new PrismaClient();
const CIEL = '09e55c23-e031-4254-8152-a373597b2cb3';
const DIR = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/d0657441-41a7-4694-a072-9c6e026312ef/scratchpad';

const FILES: Array<{ file: string; mime: string; supplier?: string }> = [
  { file: 'cowboy_hacking.pdf', mime: 'application/pdf', supplier: 'Cowboy Design' },
  { file: 'kiong_hack1.jpeg', mime: 'image/jpeg', supplier: 'Kiong Hacking' },
  { file: 'kiong_hack2.jpeg', mime: 'image/jpeg', supplier: 'Kiong Hacking' },
  { file: 'custom_furniture.pdf', mime: 'application/pdf' },
  { file: 'ahyang_carpentry.pdf', mime: 'application/pdf', supplier: 'Ah Yang Carpentry' },
  { file: 'ahyang_pvc.jpeg', mime: 'image/jpeg', supplier: 'Ah Yang Carpentry' },
  { file: 'lumika.pdf', mime: 'application/pdf', supplier: 'Lumika' },
  { file: 'alu_windows_2022.pdf', mime: 'application/pdf' },
  { file: 'cs_grille.pdf', mime: 'application/pdf', supplier: 'CS Engrg (Invisible Grille)' },
  { file: 'invisys.jpg', mime: 'image/jpeg', supplier: 'Invisys Windows' },
  { file: 'floor_atelier.pdf', mime: 'application/pdf', supplier: 'Floor Atelier' },
  { file: 'jordan_partition.pdf', mime: 'application/pdf', supplier: 'Jordan' },
  { file: 'ymf_ceiling.pdf', mime: 'application/pdf', supplier: 'YMF Group' },
  { file: 'ceiling_effective.pdf', mime: 'application/pdf' },
  { file: 'jni_cleaning.pdf', mime: 'application/pdf', supplier: 'J&I Facilities Management' },
  { file: 'microcement.pdf', mime: 'application/pdf' },
  { file: 'vinylwrap.jpeg', mime: 'image/jpeg' },
  { file: 'yl_electrical.pdf', mime: 'application/pdf', supplier: 'Yong Li Electrical' },
];

async function main() {
  const svc = new RevenueItemsService(prisma as any);
  let ok = 0;
  let fail = 0;
  for (const f of FILES) {
    const started = Date.now();
    try {
      const dataUri = `data:${f.mime};base64,${fs.readFileSync(`${DIR}/${f.file}`).toString('base64')}`;
      const parsed: any = await svc.importPricelist(CIEL, { file: dataUri, filename: f.file, supplierName: f.supplier });
      const res: any = await svc.importPricelistApply(CIEL, { supplierName: parsed.supplierName, mode: 'update', items: parsed.items });
      console.log(`✔ ${f.file} → "${parsed.supplierName}" · ${res.created} created${res.updated ? `, ${res.updated} updated` : ''}${res.newSections.length ? ` · new: ${res.newSections.join(', ')}` : ''} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
      ok++;
    } catch (e: any) {
      console.log(`❌ ${f.file}: ${e.message}`);
      fail++;
    }
  }
  const total = await prisma.revenueItem.count({ where: { organizationId: CIEL, workSectionId: { not: null }, isActive: true } });
  console.log(`\ndone: ${ok} ok, ${fail} failed · prod Work Library now ${total} active work items`);
}

main().finally(() => prisma.$disconnect());
