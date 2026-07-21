/**
 * Wire the real coexistence number (ktm support, +65 8962 8090) into AIMS
 * using the Paylane Main system-user token. Reads WHATSAPP_SU_TOKEN from .env
 * so the token never appears in code or chat.
 *
 * Does three things:
 *   1. Fetches the WABA's phone numbers → resolves the phoneNumberId.
 *   2. Subscribes the app to the WABA (webhooks for inbound/echo messages).
 *   3. Upserts the WhatsAppConnection row for the target org.
 *
 * Usage: npx ts-node scripts/seed-whatsapp-ktm-connection.ts "<org name>"
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WABA_ID = '816689588041197'; // "ktm support", owned by Osiris Tech portfolio
const GRAPH = 'https://graph.facebook.com/v23.0';

async function graph(path: string, token: string, method: 'GET' | 'POST' = 'GET') {
  const res = await fetch(`${GRAPH}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Graph ${res.status} on ${path}`);
  return json;
}

async function main() {
  const orgName = process.argv[2] || 'Osiris Technology Pte. Ltd.';
  const token = process.env.WHATSAPP_SU_TOKEN;
  if (!token) {
    console.error('❌ WHATSAPP_SU_TOKEN is not set in .env — paste the system-user token first.');
    process.exit(1);
  }

  const org = await prisma.organization.findFirst({ where: { name: { contains: orgName, mode: 'insensitive' } } });
  if (!org) {
    console.error(`❌ Organization matching "${orgName}" not found.`);
    process.exit(1);
  }

  console.log('📞 Fetching WABA phone numbers...');
  const phones = await graph(`${WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,status`, token);
  const list = phones?.data || [];
  if (!list.length) {
    console.error('❌ No phone numbers found on the WABA — token may lack access.');
    process.exit(1);
  }
  for (const p of list) {
    console.log(`   • ${p.display_phone_number} (${p.verified_name}) id=${p.id} platform=${p.platform_type} status=${p.status}`);
  }
  const phone = list[0];

  console.log('🔗 Subscribing app to WABA webhooks...');
  try {
    const sub = await graph(`${WABA_ID}/subscribed_apps`, token, 'POST');
    console.log(`   subscribed: ${JSON.stringify(sub)}`);
  } catch (e: any) {
    console.warn(`   ⚠️ subscribe failed (continuing): ${e.message}`);
  }

  const connection = await prisma.whatsAppConnection.upsert({
    where: { organizationId: org.id },
    update: {
      wabaId: WABA_ID,
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
      wabaId: WABA_ID,
      phoneNumberId: phone.id,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name || null,
      accessToken: token,
      status: 'CONNECTED',
    },
  });

  console.log(`\n✅ ktm support wired to "${org.name}"`);
  console.log(`   ${connection.displayPhoneNumber} · phoneNumberId ${connection.phoneNumberId} · WABA ${WABA_ID}`);
  console.log('   Coexistence number — phone app stays active; registration intentionally skipped.');
}

main()
  .catch((e) => {
    console.error('❌', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
