/**
 * Seed CIEL INTERIOR's work-item library (trade sections + templatised
 * quotation lines) from scripts/ciel-work-library.json — parsed out of their
 * "Revised Quotation Template.xlsx" (Jurong West sample, 2026-08-29).
 *
 * - WorkSection rows: A Hacking & Dismantling … J Miscellaneous, with the
 *   section notes the sheet prints under the header.
 * - RevenueItem rows (type SERVICE, revenue account SS001 Credit Sales) with
 *   the work-library fields: section, descriptionTemplate ({dims} placeholders
 *   where the sheet had project-specific measurements), default includes,
 *   median unit price / unit cost across the sample's occurrences, uom and
 *   pricing mode (priced / inclusive / complimentary).
 *
 * Idempotent: matches sections by title and items by descriptionTemplate.
 *   npx ts-node scripts/import-ciel-work-library.ts            (dry run)
 *   npx ts-node scripts/import-ciel-work-library.ts --apply
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ORG_NAME = 'CIEL INTERIOR PTE. LTD.';
const REVENUE_ACCOUNT = 'SS001'; // Credit Sales (default CoA)

type Payload = {
  sections: Array<{ letter: string; title: string; notes: string[]; sortOrder: number }>;
  items: Array<{
    section: string;
    name: string;
    descriptionTemplate: string;
    uom: string;
    unitPrice: number | null;
    unitCost: number | null;
    pricingMode: string;
    includes: Array<{ text: string }>;
  }>;
};

async function main() {
  const payload: Payload = JSON.parse(fs.readFileSync(path.join(__dirname, 'ciel-work-library.json'), 'utf8'));
  const org = await prisma.organization.findUnique({ where: { name: ORG_NAME }, select: { id: true } });
  if (!org) throw new Error(`${ORG_NAME} not found — run setup-ciel-org.ts first`);
  const orgId = org.id;
  console.log(`\n📚 CIEL work library — ${APPLY ? 'APPLY' : 'DRY RUN'} — ${payload.sections.length} sections, ${payload.items.length} items\n`);

  // ── sections ──────────────────────────────────────────────────────────────
  const sectionIdByTitle = new Map<string, string>();
  for (const s of payload.sections) {
    const existing = await prisma.workSection.findUnique({ where: { organizationId_title: { organizationId: orgId, title: s.title } } });
    if (existing) {
      sectionIdByTitle.set(s.title, existing.id);
      console.log(`  = section ${s.letter} ${s.title}`);
      continue;
    }
    if (APPLY) {
      const row = await prisma.workSection.create({
        data: { organizationId: orgId, letter: s.letter, title: s.title, defaultNotes: s.notes, sortOrder: s.sortOrder },
      });
      sectionIdByTitle.set(s.title, row.id);
    }
    console.log(`  + section ${s.letter} ${s.title}${s.notes.length ? `  (notes: ${s.notes.length})` : ''}`);
  }

  // ── items ─────────────────────────────────────────────────────────────────
  // Codes: <section letter><running no>, e.g. A01, E07 — readable on a quote line.
  const counters = new Map<string, number>();
  let created = 0, skipped = 0;
  for (const it of payload.items) {
    const letter = payload.sections.find((s) => s.title === it.section)?.letter || 'X';
    const existing = await prisma.revenueItem.findFirst({ where: { organizationId: orgId, descriptionTemplate: it.descriptionTemplate } });
    if (existing) {
      skipped += 1;
      continue;
    }
    // next code within the section (count existing rows too, so re-runs continue the series)
    if (!counters.has(letter)) {
      const n = await prisma.revenueItem.count({ where: { organizationId: orgId, code: { startsWith: letter }, workSectionId: { not: null } } });
      counters.set(letter, n);
    }
    const n = (counters.get(letter) || 0) + 1;
    counters.set(letter, n);
    const code = `${letter}${String(n).padStart(2, '0')}`;
    if (APPLY) {
      await prisma.revenueItem.create({
        data: {
          organizationId: orgId,
          code,
          name: it.name,
          type: 'SERVICE',
          unitPrice: it.unitPrice,
          accountCode: REVENUE_ACCOUNT,
          workSectionId: sectionIdByTitle.get(it.section) || null,
          descriptionTemplate: it.descriptionTemplate,
          includes: it.includes as unknown as Prisma.InputJsonValue,
          unitCost: it.unitCost,
          uom: it.uom,
          pricingMode: it.pricingMode,
        },
      });
    }
    created += 1;
    console.log(`  + ${code}  ${it.name.slice(0, 70).padEnd(70)}  ${it.uom.padEnd(5)} price=${it.unitPrice ?? '-'} cost=${it.unitCost ?? '-'} ${it.pricingMode !== 'priced' ? `[${it.pricingMode}]` : ''}`);
  }

  console.log(`\n${APPLY ? '✅ Done' : 'Dry run'} — ${created} item(s) ${APPLY ? 'created' : 'to create'}, ${skipped} already present.\n`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
