/* eslint-disable no-console */
/**
 * One-off: clone Cappitech's PO DocumentTemplate into a new SO template.
 *
 * Same fields, column layout, tax behavior, currency — only the type and
 * displayed name differ so the SO opens with all the PO ergonomics but
 * downstream gating (Invoice / DO / SO pricing rules in the order page
 * flat builder, sidebar routing, etc.) can branch on type === 'SO'.
 *
 * Idempotent: if an SO template for the org already exists, exits without
 * touching it.
 *
 * Usage:
 *   node scripts/clone-po-to-so-cappitech.js          # dev   (.env)
 *   PROD=1 node scripts/clone-po-to-so-cappitech.js   # prod  (.env.production)
 */
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const path = require('path');

const ORG = '59802f75-262b-4f96-b8b2-09a9a071d882';

(async () => {
  const envFile = process.env.PROD ? '.env.production' : '.env';
  const env = dotenv.config({ path: path.join(__dirname, '..', envFile), processEnv: {} }).parsed;
  if (!env?.DATABASE_URL) throw new Error('Missing DATABASE_URL in ' + envFile);
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

  const existing = await prisma.documentTemplate.findFirst({
    where: { organizationId: ORG, type: 'SO' },
    select: { id: true, name: true },
  });
  if (existing) {
    console.log(`Already have SO template: ${existing.id} (${existing.name}). Nothing to do.`);
    await prisma.$disconnect();
    return;
  }

  const po = await prisma.documentTemplate.findFirst({
    where: { organizationId: ORG, type: 'PO' },
  });
  if (!po) {
    console.error('No PO template on this org. Aborting.');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('Cloning PO template:', po.id, '|', po.name);
  // Strip the id + timestamps so Prisma assigns fresh ones. Keep config
  // verbatim so tabs / fields / columnLabels / tableColumnOrder / etc.
  // match exactly.
  const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = po;
  const created = await prisma.documentTemplate.create({
    data: {
      ...rest,
      type: 'SO',
      name: (rest.name || 'Purchase Order').replace(/Purchase Order/i, 'Sales Order').trim() || 'Sales Order',
      // Auto-numbering uses templateVariant as the doc-name prefix. The PO
      // clone carries variant='PO' from the source, which mistakenly produces
      // 'PO202606-NNN' for sales orders. Override to 'SO' so new SO docs name
      // themselves correctly.
      templateVariant: 'SO',
    },
    select: { id: true, type: true, name: true, templateVariant: true },
  });
  console.log('Created SO template:', created.id, '|', created.type, '|', created.name);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
