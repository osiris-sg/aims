/**
 * Seed a coexistence WhatsApp connection when Embedded Signup completed on
 * Meta's side but the browser never captured the WABA/phone IDs (so the
 * onboard call never ran). Recovers it directly.
 *
 * Prereqs:
 *   - The target WABA is assigned to the Paylane Main system user (Business
 *     settings → System users → add the WhatsApp account, full control), so
 *     WHATSAPP_SU_TOKEN can reach it.
 *   - Run against the RIGHT DB: prod = dotenv_config_path=.env.production
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/seed-whatsapp-coexistence-connection.ts \
 *     <wabaId> "<org name>"  dotenv_config_path=.env.production
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const GRAPH = 'https://graph.facebook.com/v23.0';

async function graph(path: string, token: string, method: 'GET' | 'POST' = 'GET') {
  const res = await fetch(`${GRAPH}/${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Graph ${res.status} on ${path}`);
  return json;
}

async function main() {
  const wabaId = process.argv[2];
  const orgName = process.argv[3] || 'Osiris Technology';
  const token = process.env.WHATSAPP_SU_TOKEN;
  if (!wabaId) {
    console.error('❌ Pass the WABA id as the first argument.');
    process.exit(1);
  }
  if (!token) {
    console.error('❌ WHATSAPP_SU_TOKEN not set in the loaded env.');
    process.exit(1);
  }

  const org = await prisma.organization.findFirst({ where: { name: { contains: orgName, mode: 'insensitive' } } });
  if (!org) {
    console.error(`❌ Organization matching "${orgName}" not found in this database.`);
    process.exit(1);
  }
  console.log(`🏢 ${org.name}`);

  console.log('📞 Fetching WABA phone numbers...');
  const phones = await graph(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,status`,
    token,
  );
  const list = phones?.data || [];
  if (!list.length) {
    console.error('❌ No phone numbers on that WABA — is it assigned to the Paylane Main system user?');
    process.exit(1);
  }
  for (const p of list) {
    console.log(`   • ${p.display_phone_number} (${p.verified_name}) id=${p.id} platform=${p.platform_type} status=${p.status}`);
  }
  const phone = list[0];
  const coexistence = String(phone.platform_type || '').toUpperCase().includes('SMB') || list.length === 1;

  console.log('🔗 Subscribing app to WABA webhooks...');
  try {
    await graph(`${wabaId}/subscribed_apps`, token, 'POST');
  } catch (e: any) {
    console.warn(`   ⚠️ subscribe: ${e.message}`);
  }

  const connection = await prisma.whatsAppConnection.upsert({
    where: { organizationId: org.id },
    update: {
      wabaId,
      phoneNumberId: phone.id,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name || null,
      accessToken: token,
      status: 'CONNECTED',
      lastError: null,
      connectedAt: new Date(),
    },
    create: {
      organizationId: org.id,
      wabaId,
      phoneNumberId: phone.id,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name || null,
      accessToken: token,
      status: 'CONNECTED',
    },
  });

  console.log(`\n✅ Connected ${connection.displayPhoneNumber} to "${org.name}"`);
  console.log(`   phoneNumberId ${connection.phoneNumberId} · WABA ${wabaId}`);
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
