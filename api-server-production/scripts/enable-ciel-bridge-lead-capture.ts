// Turn on lead capture for CIEL's bridged line (guru 2026-11-08, applied to
// PROD the same day).
//
// CIEL's +65 8987 8087 cannot be connected to the Cloud API, so its Instagram
// ad enquiries arrive through the linked-device bridge. The bridge only reads;
// the AD sends the intro. Seeing that exact intro leave the line is what opens
// a Lead — INTRO confirmed against CIEL's own history, where it had already
// gone to 5 different people.
//
// Run: npx dotenv -e .env.production -- npx ts-node --transpile-only \
//        scripts/enable-ciel-bridge-lead-capture.ts
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '09e55c23-e031-4254-8152-a373597b2cb3';
const INTRO = 'Hi! Please let us know how we can help you.';
(async () => {
  const ui: any = await p.organizationUIConfig.findUnique({ where: { organizationId: ORG } });
  if (!ui) { console.log('✖ no OrganizationUIConfig row for CIEL — stopping'); return; }
  const before: any = ui.features || {};
  console.log('before:', JSON.stringify({
    enableBridgeLeadCapture: before.enableBridgeLeadCapture,
    bridgeLeadIntro: before.bridgeLeadIntro,
  }));
  const features = { ...before, enableBridgeLeadCapture: true, bridgeLeadIntro: INTRO };
  await p.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features } });
  const after: any = (await p.organizationUIConfig.findUnique({ where: { organizationId: ORG } }))!.features;
  console.log('after: ', JSON.stringify({
    enableBridgeLeadCapture: after.enableBridgeLeadCapture,
    bridgeLeadIntro: after.bridgeLeadIntro,
  }));
  console.log('other flags untouched:', Object.keys(before).length, '→', Object.keys(after).length, 'keys');
  await p.$disconnect();
})();
