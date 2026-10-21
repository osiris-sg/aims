/**
 * ADH only (round S, 2026-10-22): attach an EXISTING Clerk user to ADH with a role and link their
 * WhatsApp number + notification prefs — what Admin → Add User does after Clerk, for a user Clerk
 * already has. Also moves the number off any other user's profile (a number on two users is ignored
 * by the Operator). Dry run by default; --apply writes.
 *
 *   DATABASE_URL=<prod> TENANCY_MODE= npx ts-node --transpile-only scripts/_adh-link-whatsapp-user.ts \
 *     --user=<clerk id> --role="ADH Staff" --number=6596947515 [--lang=en] [--apply]
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes('--apply');
const userId = arg('user')!;
const roleName = arg('role') || 'ADH Staff';
const number = (arg('number') || '').replace(/\D/g, '');
const lang = arg('lang') === 'ja' ? 'ja' : 'en';
const prefs = { digest: true, needsMe: true, filed: false, events: true, quietFrom: '21:00', quietTo: '08:00', lang };

async function main() {
  if (!userId || !number) throw new Error('--user and --number are required');
  const prisma = new PrismaClient();
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const u = await clerk.users.getUser(userId);
  const email = u.emailAddresses?.[0]?.emailAddress;
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${email} (${userId}) → ADH role "${roleName}", WhatsApp …${number.slice(-4)}, prefs ${JSON.stringify(prefs)}`);
  const role = await prisma.role.findFirst({ where: { organizationId: ORG, name: roleName }, select: { id: true } });
  if (!role) throw new Error(`role ${roleName} not found in ADH`);
  const others = await prisma.organizationMemberProfile.findMany({ where: { whatsappNumber: { in: [number, number.replace(/^65/, '')] }, NOT: { userId } }, select: { id: true, userId: true, organizationId: true, whatsappNumber: true } });
  for (const o of others) console.log(`  number also on user ${o.userId} in org ${o.organizationId} (stored …${o.whatsappNumber!.slice(-4)}) → will be cleared (restore: set it back on that profile)`);
  const hasOrg = await prisma.userOrganization.findUnique({ where: { userId_organizationId: { userId, organizationId: ORG } } });
  const hasRole = await prisma.userRole.findFirst({ where: { userId, roleId: role.id, organizationId: ORG } });
  const prof = await prisma.organizationMemberProfile.findUnique({ where: { organizationId_userId: { organizationId: ORG, userId } } });
  console.log(`  membership ${hasOrg ? 'exists' : 'CREATE'} · role ${hasRole ? 'exists' : 'CREATE'} · profile ${prof ? 'UPDATE' : 'CREATE'} · clerk externalId ${u.externalId ? 'set' : 'STAMP'}`);
  if (!APPLY) return prisma.$disconnect();
  if (!u.externalId) await clerk.users.updateUser(userId, { externalId: userId }).catch((e) => console.log('  externalId stamp failed:', e?.message));
  await prisma.userOrganization.upsert({ where: { userId_organizationId: { userId, organizationId: ORG } }, update: { isActive: true }, create: { userId, organizationId: ORG, isActive: true } });
  await prisma.userRole.upsert({ where: { userId_roleId_organizationId: { userId, roleId: role.id, organizationId: ORG } }, update: { isActive: true }, create: { userId, roleId: role.id, organizationId: ORG, isActive: true, assignedBy: 'script:_adh-link-whatsapp-user' } });
  for (const o of others) await prisma.organizationMemberProfile.update({ where: { id: o.id }, data: { whatsappNumber: null } });
  await prisma.organizationMemberProfile.upsert({ where: { organizationId_userId: { organizationId: ORG, userId } }, update: { whatsappNumber: number, whatsappPrefs: prefs }, create: { organizationId: ORG, userId, whatsappNumber: number, whatsappPrefs: prefs } });
  await prisma.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'script:_adh-link-whatsapp-user', actorName: 'System creation', organizationId: ORG, channel: 'script', method: 'SCRIPT', path: 'scripts/_adh-link-whatsapp-user.ts', action: 'UPDATE', resource: 'OrganizationMemberProfile', resourceId: userId, details: { role: roleName, whatsapp: `…${number.slice(-4)}`, prefs, clearedFrom: others.map((o) => o.userId) } } as any }).catch(() => null);
  console.log('✅ applied');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
