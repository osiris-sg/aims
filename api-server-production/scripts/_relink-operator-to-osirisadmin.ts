/**
 * Point a chat number at the global osirisadmin Clerk user, so the Operator
 * treats it as the platform admin (every org, no membership rows needed).
 *
 * Dry run:
 *   npx ts-node -r dotenv/config --transpile-only scripts/_relink-operator-to-osirisadmin.ts 6591151041 dotenv_config_path=.env.production
 * Apply:
 *   ... 6591151041 --apply dotenv_config_path=.env.production
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
/** admin@osiris.sg — the global osirisadmin (see memory: global-osirisadmin-account). */
const ADMIN_OSIRIS_SG = 'user_3ASkFLY1xsAtszpHRSYg4ldiQgP';

async function main() {
  const raw = process.argv.slice(2).find((a) => /^\d{6,}$/.test(a.replace(/\D/g, '')) && !a.startsWith('dotenv_'));
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) throw new Error('Pass the WhatsApp number, e.g. 6591151041');

  // Who currently holds osirisadmin?
  const admins = await prisma.userRole.findMany({
    where: { isActive: true, role: { name: 'osirisadmin' } },
    select: { userId: true },
  });
  const adminIds = [...new Set(admins.map((a) => a.userId))];
  if (!adminIds.length) throw new Error('No user holds the osirisadmin role in this database.');

  // More than one account holds the platform role, so the target is explicit.
  // Default is admin@osiris.sg, the global osirisadmin.
  const flagIdx = process.argv.indexOf('--user');
  const wanted = flagIdx > -1 ? process.argv[flagIdx + 1] : ADMIN_OSIRIS_SG;
  if (!adminIds.includes(wanted)) {
    console.log('Users holding osirisadmin:');
    for (const id of adminIds) console.log(`   ${id}`);
    throw new Error(`${wanted} does not hold osirisadmin. Pass --user <id> from the list above.`);
  }
  const adminId = wanted;
  if (adminIds.length > 1) {
    console.log(`(${adminIds.length} accounts hold osirisadmin; targeting ${adminId === ADMIN_OSIRIS_SG ? 'admin@osiris.sg' : 'the one you passed'})`);
  }
  console.log(`osirisadmin clerkUserId : ${adminId}`);

  const identity = await prisma.operatorIdentity.findFirst({
    where: { channel: 'whatsapp', channelUserId: { contains: digits.slice(-8) } },
  });
  if (!identity) {
    console.log(`\nNo OperatorIdentity for a number containing ${digits.slice(-8)}.`);
    console.log('Nothing to relink — link the number first via /link, or create the row.');
    return;
  }
  console.log(`identity                : ${identity.channelUserId}`);
  console.log(`currently linked to     : ${identity.clerkUserId}`);
  console.log(`stored org              : ${identity.organizationId || '(none)'}`);

  if (identity.clerkUserId === adminId) {
    console.log('\n✅ Already linked to the osirisadmin user. Nothing to do.');
    return;
  }
  if (!APPLY) {
    console.log(`\nDry run. Re-run with --apply to relink ${identity.channelUserId} -> ${adminId}.`);
    return;
  }
  await prisma.operatorIdentity.update({
    where: { id: identity.id },
    data: { clerkUserId: adminId, verified: true },
  });
  console.log(`\n✅ Relinked. /org will now list every organization.`);
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
