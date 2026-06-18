/**
 * Idempotent: create (or update) the shared "Standard Quotation" template — a
 * simple 5-column quotation (Description, Unit Cost, Qty, Tax, Amount) owned by
 * the osiris-platform org so it surfaces in every org's Manage Templates as a
 * system default.
 *
 * Run against an environment:
 *   node scripts/create-standard-quotation.js                       # uses .env
 *   dotenv -e .env.production -- node scripts/create-standard-quotation.js
 */
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const OWNER_ORG = 'osiris-platform';
const NAME = 'Standard Quotation';
const config = {
  tableColumnOrder: ['description', 'unitPrice', 'quantity', 'tax', 'amount'],
  columnLabels: {
    description: 'Description',
    unitPrice: 'Unit Cost',
    quantity: 'Qty',
    tax: 'Tax',
    amount: 'Amount',
  },
};
const description =
  'Standard 5-column quotation (Description, Unit Cost, Qty, Tax, Amount)';

(async () => {
  const org = await prisma.organization.findUnique({
    where: { id: OWNER_ORG },
    select: { id: true, name: true },
  });
  if (!org) {
    console.error(`Owner org "${OWNER_ORG}" not found — aborting.`);
    process.exit(1);
  }

  const existing = await prisma.documentTemplate.findFirst({
    where: { organizationId: OWNER_ORG, type: 'QUOTATION', name: NAME },
    select: { id: true },
  });

  const row = existing
    ? await prisma.documentTemplate.update({
        where: { id: existing.id },
        data: { config, templateVariant: 'QO1', designName: 'Default', description },
      })
    : await prisma.documentTemplate.create({
        data: {
          name: NAME,
          type: 'QUOTATION',
          templateVariant: 'QO1',
          designName: 'Default',
          description,
          organizationId: OWNER_ORG,
          isActive: false, // active is per-org via OrganizationActiveTemplate
          isDefault: true,
          config,
        },
      });

  console.log(`${existing ? 'Updated' : 'Created'} "Standard Quotation" ${row.id}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
