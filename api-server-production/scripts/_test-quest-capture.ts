/**
 * Hand-crank of the quest media capture (the deployed webhook will do this
 * automatically): take guru's inbound photo reply on the agent line, download
 * it from Meta, upload to S3, attach it to the "Carpentry installation" quest
 * step of the Ms. Siusin project, and send the confirmation reply — exactly
 * what ProjectCostingService.captureQuestMedia does.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_test-quest-capture.ts
 */
import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();
const FROM = '6591151041';

async function main() {
  const os = await prisma.organization.findFirst({ where: { name: 'Osiris Technology Pte. Ltd.' }, select: { id: true } });
  const line = await prisma.whatsAppConnection.findFirst({
    where: { organizationId: os!.id, status: 'CONNECTED' },
    orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
  });
  if (!line) throw new Error('no agent line');

  // The inbound photo (operator answered it, but the payload is stored).
  const inbound: any = await prisma.whatsAppMessage.findFirst({
    where: { direction: 'INBOUND', counterparty: { contains: '91151041' }, phoneNumberId: line.phoneNumberId },
    orderBy: { createdAt: 'desc' },
  });
  const mediaId = inbound?.payload?.image?.id || inbound?.payload?.video?.id;
  if (!mediaId) throw new Error('latest inbound from guru has no image/video payload');
  const isVideo = !!inbound?.payload?.video?.id;
  const caption = inbound?.payload?.image?.caption || inbound?.payload?.video?.caption || null;

  const req: any = await prisma.questMediaRequest.findFirst({
    where: { waNumber: FROM, status: 'open', createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) } },
    orderBy: { createdAt: 'desc' },
  });
  if (!req) throw new Error('no open QuestMediaRequest for this number');
  let step = req.stepId ? await prisma.projectQuestStep.findUnique({ where: { id: req.stepId } }) : null;
  if (!step) step = await prisma.projectQuestStep.findFirst({ where: { projectId: req.projectId, status: 'pending', requiresProof: true }, orderBy: { stepNo: 'asc' } });
  if (!step) throw new Error('no target quest step');

  // Meta media id → URL → bytes.
  const meta: any = await (await fetch(`https://graph.facebook.com/v23.0/${mediaId}`, { headers: { Authorization: `Bearer ${line.accessToken}` } })).json();
  if (!meta?.url) throw new Error('media url resolve failed: ' + JSON.stringify(meta?.error || meta));
  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${line.accessToken}` } });
  if (!bin.ok) throw new Error('media download failed ' + bin.status);
  const buffer = Buffer.from(await bin.arrayBuffer());
  const mt = meta.mime_type || (isVideo ? 'video/mp4' : 'image/jpeg');
  console.log('downloaded', buffer.length, 'bytes', mt);

  const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } });
  const bucket = process.env.RESOURCE_BUCKET || 'aims-osiris';
  const ext = mt.includes('mp4') ? 'mp4' : mt.includes('quicktime') ? 'mov' : mt.includes('png') ? 'png' : mt.includes('webp') ? 'webp' : 'jpg';
  const key = `projects/${req.organizationId}/quest/${req.projectId}-step${step.stepNo}-wa-${Date.now()}.${ext}`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mt }));
  const url = `https://${bucket}.s3.${process.env.AWS_REGION || 'ap-southeast-1'}.amazonaws.com/${key}`;

  const list: any[] = Array.isArray(step.attachments) ? (step.attachments as any[]) : [];
  list.push({ url, key, type: mt, caption, at: new Date().toISOString(), via: 'whatsapp' });
  await prisma.projectQuestStep.update({ where: { id: step.id }, data: { attachments: list as any } });
  await prisma.questMediaRequest.update({ where: { id: req.id }, data: { mediaCount: { increment: 1 }, lastMediaAt: new Date() } });

  const word = mt.startsWith('video') ? 'Video' : 'Photo';
  const reply = `✅ ${word} saved to "${step.title}" on ${req.label}. Send more photos/videos anytime.`;
  const r = await fetch(`https://graph.facebook.com/v23.0/${line.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${line.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: FROM, type: 'text', text: { body: reply } }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j?.error || j));
  await prisma.whatsAppMessage
    .create({ data: { organizationId: line.organizationId, direction: 'OUTBOUND', counterparty: FROM, phoneNumberId: line.phoneNumberId, waMessageId: j?.messages?.[0]?.id || null, body: reply, status: 'sent', payload: { type: 'text' } as any } })
    .catch(() => null);

  console.log(`✅ attached to step ${step.stepNo} "${step.title}" — ${url}`);
  console.log('confirmation sent to guru');
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
