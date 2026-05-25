#!/usr/bin/env ts-node

/**
 * Seeds the canonical document-template set into organizations that are missing
 * templates. Idempotent — skips any document type an org already has.
 *
 * Usage:
 *   npx ts-node scripts/seed-org-templates.ts                 (all orgs)
 *   npx ts-node scripts/seed-org-templates.ts --org <orgId>   (single org)
 *   npx ts-node scripts/seed-org-templates.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';
import { DEFAULT_DOCUMENT_TEMPLATES } from '../src/organizations/default-templates';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const orgIdx = args.indexOf('--org');
  const specificOrgId = orgIdx >= 0 ? args[orgIdx + 1] : undefined;

  const orgs = await prisma.organization.findMany({
    where: specificOrgId ? { id: specificOrgId } : {},
    select: { id: true, name: true },
  });

  console.log(`${dryRun ? '🔍 DRY RUN — ' : ''}Seeding default templates for ${orgs.length} org(s)\n`);

  for (const org of orgs) {
    const existing = await prisma.documentTemplate.findMany({
      where: { organizationId: org.id },
      select: { type: true },
    });
    const existingTypes = new Set(existing.map((t) => t.type));
    const toCreate = DEFAULT_DOCUMENT_TEMPLATES.filter((t) => !existingTypes.has(t.type));

    if (toCreate.length === 0) {
      console.log(`   ⏭️  ${org.name}: already has all default types`);
      continue;
    }

    console.log(`   📦 ${org.name}: ${dryRun ? 'would create' : 'creating'} ${toCreate.length} — ${toCreate.map((t) => t.type).join(', ')}`);

    if (!dryRun) {
      await prisma.documentTemplate.createMany({
        data: toCreate.map((t) => ({
          organizationId: org.id,
          type: t.type,
          templateVariant: t.templateVariant,
          name: t.name,
          designName: 'Default',
          description: `${t.name} document template`,
          isActive: true,
          isDefault: true,
        })),
      });
    }
  }

  console.log(`\n🎉 Done.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
