/**
 * Register a WhatsApp number as a linked AIMS Operator identity.
 *
 * This is the manual/interim version of the "assign a WhatsApp number to a
 * user" admin flow. It creates a VERIFIED OperatorIdentity so that, the moment
 * that number texts the org's connected WhatsApp business number, the Operator
 * recognises it by phone → clerkUserId → their org + role → scoped permissions.
 *
 * Unknown numbers (not registered here) are ignored by the operator router and
 * fall through to the CRM agent path.
 *
 * Usage (defaults to the PROD DB — this is where the WhatsApp connection lives):
 *   npx ts-node -r dotenv/config --transpile-only \
 *     scripts/register-whatsapp-operator.ts <phone> <clerkUserId> [orgId] [displayName] \
 *     dotenv_config_path=.env.production
 *
 *   phone        digits only, country code, NO '+' or spaces (e.g. 6591234567)
 *                — this must match WhatsApp's message.from format exactly.
 *   clerkUserId  the AIMS user this number acts as (e.g. user_2zfl...)
 *   orgId        active org to work in (default: Osiris Technology)
 *   displayName  optional label
 */
import { PrismaClient } from '@prisma/client';

const OSIRIS_TECH = 'd068f159-e45a-4da8-beaf-62e903f44141';

async function main() {
  const [, , rawPhone, clerkUserId, orgId, displayName] = process.argv;
  if (!rawPhone || !clerkUserId) {
    console.error('Usage: register-whatsapp-operator.ts <phone-digits> <clerkUserId> [orgId] [displayName]');
    process.exit(1);
  }
  const phone = rawPhone.replace(/[^0-9]/g, ''); // normalise to digits only
  const organizationId = orgId || OSIRIS_TECH;
  const prisma = new PrismaClient();

  // Sanity: the target user actually has a role in that org (else the operator
  // will resolve them but they'll have no permissions).
  const roles = await prisma.userRole.findMany({
    where: { userId: clerkUserId, organizationId, isActive: true },
    select: { role: { select: { name: true } } },
  });
  if (roles.length === 0) {
    console.warn(
      `  ⚠ ${clerkUserId} has NO active role in org ${organizationId} — they'll be recognised but blocked on every tool. Continuing anyway.`,
    );
  } else {
    console.log(`  user roles in org: ${roles.map((r) => r.role?.name).join(', ')}`);
  }

  const identity = await prisma.operatorIdentity.upsert({
    where: { channel_channelUserId: { channel: 'whatsapp', channelUserId: phone } },
    create: {
      channel: 'whatsapp',
      channelUserId: phone,
      clerkUserId,
      organizationId,
      displayName: displayName || null,
      verified: true,
      lastSeenAt: new Date(),
    },
    update: {
      clerkUserId,
      organizationId,
      displayName: displayName || undefined,
      verified: true,
    },
  });

  console.log('  ✅ registered WhatsApp operator identity:');
  console.log(`     phone=${phone}  ->  user=${clerkUserId}  org=${organizationId}  verified=true`);
  console.log(`     id=${identity.id}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
