/**
 * Toggle a per-org feature flag (OrganizationUIConfig.features).
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_set-org-feature.ts <orgNameOrId> <flag> <on|off> [--apply] dotenv_config_path=.env.production
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const a = process.argv.slice(2).filter((x) => !x.startsWith('--') && !x.startsWith('dotenv_'));
  const [orgRef, flag, want] = a;
  if (!orgRef || !flag || !['on', 'off'].includes(want || '')) {
    throw new Error('Usage: <orgNameOrId> <flag> <on|off> [--apply]');
  }
  const org =
    (await prisma.organization.findUnique({ where: { id: orgRef }, select: { id: true, name: true } })) ||
    (await prisma.organization.findFirst({
      where: { name: { contains: orgRef, mode: 'insensitive' } },
      select: { id: true, name: true },
    }));
  if (!org) throw new Error(`No organization matching "${orgRef}"`);

  const ui = await prisma.organizationUIConfig.findUnique({
    where: { organizationId: org.id },
    select: { features: true },
  });
  const features = { ...((ui?.features as any) || {}) };
  const next = want === 'on';
  console.log(`${org.name}`);
  console.log(`  ${flag}: ${features[flag] === true} -> ${next}`);
  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply.');
    return;
  }
  features[flag] = next;
  await prisma.organizationUIConfig.upsert({
    where: { organizationId: org.id },
    update: { features },
    create: { organizationId: org.id, features },
  });
  console.log('\n✅ Saved.');
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
