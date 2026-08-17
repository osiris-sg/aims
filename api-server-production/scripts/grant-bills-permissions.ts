/**
 * Grant the bills:* permissions to every org's superadmin and Admin roles.
 *
 * These permission rows exist and the Bills endpoints require them, but no role
 * was ever granted them — so any user who is NOT the global osirisadmin (which
 * bypasses all checks) gets 403s on the Bills module. Idempotent.
 *
 *   npx ts-node -r dotenv/config scripts/grant-bills-permissions.ts
 *   ... dotenv_config_path=.env.production   (for prod)
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const WANTED = ['bills:read', 'bills:create', 'bills:update', 'bills:approve'];

async function main() {
  const perms = await prisma.permission.findMany({ where: { name: { in: WANTED } } });
  if (perms.length !== WANTED.length) {
    console.warn(`⚠️  found ${perms.length}/${WANTED.length} permission rows: ${perms.map((p) => p.name).join(', ')}`);
  }
  const roles = await prisma.role.findMany({
    where: { OR: [{ name: { equals: 'superadmin', mode: 'insensitive' } }, { name: { equals: 'admin', mode: 'insensitive' } }] },
    include: { permissions: { select: { id: true } }, organization: { select: { name: true } } },
  });
  let touched = 0;
  for (const role of roles) {
    const have = new Set(role.permissions.map((p) => p.id));
    const missing = perms.filter((p) => !have.has(p.id));
    if (!missing.length) continue;
    await prisma.role.update({
      where: { id: role.id },
      data: { permissions: { connect: missing.map((p) => ({ id: p.id })) } },
    });
    console.log(`  + ${role.organization?.name ?? '?'} / ${role.name}: ${missing.map((p) => p.name).join(', ')}`);
    touched++;
  }
  console.log(touched ? `\n✅ updated ${touched} role(s)` : '\n✅ nothing to do, all roles already granted');
}

main().catch((e) => { console.error('❌', e); process.exit(1); }).finally(() => prisma.$disconnect());
