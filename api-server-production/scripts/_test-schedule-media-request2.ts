/**
 * Round 2 of the 9am-request preview: the free-form text bounced with
 * "Re-engagement message" (no open 24h window on the agent line for
 * 91151041). Send the pre-approved template first, wait for guru's reply
 * (which opens the window), then deliver the real message.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_test-schedule-media-request2.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PROJECT = 'ba899165-dd69-4f8b-9018-2b35aff65f02';
const TO = '6591151041';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pj = await prisma.project.findUnique({ where: { id: PROJECT }, select: { name: true } });
  const item = await prisma.projectScheduleItem.findFirst({
    where: { projectId: PROJECT, kind: 'work', label: { contains: 'Carpentry Install', mode: 'insensitive' } },
  });
  const osiris = await prisma.organization.findFirst({ where: { name: 'Osiris Technology Pte. Ltd.' }, select: { id: true } });
  const line = await prisma.whatsAppConnection.findFirst({
    where: { organizationId: osiris!.id, status: 'CONNECTED' },
    orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
  });
  if (!line || !pj || !item) throw new Error('missing line/project/item');

  const send = async (payload: any, body: string) => {
    const res = await fetch(`https://graph.facebook.com/v23.0/${line.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${line.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: TO, ...payload }),
    });
    const j: any = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(j?.error || j));
    await prisma.whatsAppMessage
      .create({ data: { organizationId: line.organizationId, direction: 'OUTBOUND', counterparty: TO, phoneNumberId: line.phoneNumberId, waMessageId: j?.messages?.[0]?.id || null, body, status: 'sent', payload } })
      .catch(() => null);
    return j?.messages?.[0]?.id;
  };

  await send({ type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } }, 'hello_world (window opener)');
  console.log('📤 hello_world template sent — reply ANYTHING to it to open the window; watching for the reply...');

  const since = new Date();
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const reply = await prisma.whatsAppMessage.findFirst({
      where: { direction: 'INBOUND', counterparty: { contains: '91151041' }, phoneNumberId: line.phoneNumberId, createdAt: { gte: since } },
    });
    if (reply) {
      console.log('💬 reply detected — sending the real message');
      const text = [
        `📸 ${item.label} starts today — ${pj.name}.`,
        '',
        'Before work begins, please send a BEFORE video and a photo of the site here.',
        'They will be saved to the project quest automatically.',
      ].join('\n');
      const id = await send({ type: 'text', text: { body: text } }, text);
      console.log(`✅ delivered (wa id ${id})`);
      return;
    }
    if (i % 6 === 5) console.log(`…still waiting (${(i + 1) * 5}s)`);
  }
  console.log('⏱ no reply in 5 minutes — reply to the hello_world and rerun me');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
