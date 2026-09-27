/**
 * Turn the Operator on/off for one WhatsApp line.
 *
 * Off = only the PA (the whatsapp-web.js bridge) answers on that number.
 * Inbound messages are still stored and readable in the CRM either way; this
 * only decides whether a linked staff sender gets routed to the Operator
 * agent instead of the PA.
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_set-operator-enabled.ts <phoneNumberId> off dotenv_config_path=.env.production
 *   ... <phoneNumberId> off --apply ...
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.startsWith('dotenv_'));
  const [phoneNumberId, want] = args;
  if (!phoneNumberId || !['on', 'off'].includes(want || '')) {
    throw new Error('Usage: _set-operator-enabled.ts <phoneNumberId> <on|off> [--apply]');
  }
  const next = want === 'on';
  const conn = await prisma.whatsAppConnection.findUnique({
    where: { phoneNumberId },
    select: { displayPhoneNumber: true, verifiedName: true, operatorEnabled: true, organizationId: true },
  });
  if (!conn) throw new Error(`No connection with phoneNumberId ${phoneNumberId}`);
  const org = await prisma.organization.findUnique({
    where: { id: conn.organizationId },
    select: { name: true },
  });
  console.log(`${conn.displayPhoneNumber} (${conn.verifiedName}) — ${org?.name}`);
  console.log(`  operatorEnabled: ${conn.operatorEnabled}  ->  ${next}`);
  if (conn.operatorEnabled === next) {
    console.log('  Already set. Nothing to do.');
    return;
  }
  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to change it.');
    return;
  }
  await prisma.whatsAppConnection.update({ where: { phoneNumberId }, data: { operatorEnabled: next } });
  console.log(`\n✅ Operator is now ${next ? 'ENABLED' : 'DISABLED'} on this line.`);
  if (!next) {
    console.log('   Only the PA answers here. Messages are still stored and readable in the CRM.');
  }
}

main()
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
