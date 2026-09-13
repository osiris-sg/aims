/**
 * One-off preview of the 9am schedule media request (guru 2026-09-14):
 * sends the exact cron message for the Ms. Siusin Carpentry Installation
 * block to a test number, and opens the QuestMediaRequest so replies attach
 * once the capture code is deployed. Does NOT stamp reminderSentAt — the
 * real 9am send to the designer still happens.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_test-schedule-media-request.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PROJECT = 'ba899165-dd69-4f8b-9018-2b35aff65f02';
const TO = '6591151041';

async function main() {
  const pj = await prisma.project.findUnique({ where: { id: PROJECT }, select: { id: true, name: true, organizationId: true } });
  if (!pj) throw new Error('project not found');
  const item = await prisma.projectScheduleItem.findFirst({
    where: { projectId: PROJECT, kind: 'work', label: { contains: 'Carpentry Install', mode: 'insensitive' } },
    orderBy: { startDate: 'asc' },
  });
  if (!item) throw new Error('carpentry installation schedule item not found');
  const step = await prisma.projectQuestStep.findFirst({ where: { projectId: PROJECT, title: { startsWith: 'Carpentry installation' } } });

  const osiris = await prisma.organization.findFirst({ where: { name: 'Osiris Technology Pte. Ltd.' }, select: { id: true } });
  const line = await prisma.whatsAppConnection.findFirst({
    where: { organizationId: osiris!.id, status: 'CONNECTED' },
    orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
  });
  if (!line) throw new Error('no connected agent line');

  const text = [
    `📸 ${item.label} starts today — ${pj.name}.`,
    '',
    'Before work begins, please send a BEFORE video and a photo of the site here.',
    'They will be saved to the project quest automatically.',
  ].join('\n');

  const res = await fetch(`https://graph.facebook.com/v23.0/${line.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${line.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: TO, type: 'text', text: { body: text } }),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json?.error || json));
  await prisma.whatsAppMessage
    .create({ data: { organizationId: line.organizationId, direction: 'OUTBOUND', counterparty: TO, phoneNumberId: line.phoneNumberId, waMessageId: json?.messages?.[0]?.id || null, body: text, status: 'sent', payload: { type: 'text' } as any } })
    .catch(() => null);
  await prisma.questMediaRequest.create({
    data: { organizationId: pj.organizationId!, projectId: pj.id, stepId: step?.id || null, scheduleItemId: item.id, waNumber: TO, label: item.label },
  });
  console.log(`📤 sent to ${TO} (wa id ${json?.messages?.[0]?.id})`);
  console.log(`request open → replies will attach to "${step?.title}" once the webhook code is deployed`);
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
