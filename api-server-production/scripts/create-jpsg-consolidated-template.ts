import { PrismaClient, Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Seeds the bespoke JPSG CONSOLIDATED (postpaid weekly) invoice template for
// Biofuel and activates it for the org. Idempotent — safe to re-run, run once
// per DB (dev/.env, staging/.env.staging, prod/.env.production).
//
// The postpaid_consolidated ingestion (src/ingestion) resolves this template by
// templateVariant 'JPSG_CONSOLIDATED'. Rendering: material-summary line table
// (Description / Qty (T) / Rate / Subtotal / GST / Amount) + a Daily Breakdown
// appendix table driven by config.consolidated.dailyBreakdowns.
// ---------------------------------------------------------------------------

const BIOFUEL_ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const VARIANT = 'JPSG_CONSOLIDATED';

const CONFIG = {
  templateStyle: 'JPSG_CONSOLIDATED',
  tableColumnOrder: ['no', 'description', 'qtyTonnes', 'rate', 'subtotal', 'gst', 'grossAmount'],
  columnLabels: {
    no: 'S/No.',
    description: 'Description',
    qtyTonnes: 'Qty (Tonnes)',
    rate: 'Rate (S$)',
    subtotal: 'Subtotal (S$)',
    gst: 'GST (S$)',
    grossAmount: 'Amount (S$)',
  },
  internalColumns: [],
} as unknown as Prisma.InputJsonValue;

async function main() {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.documentTemplate.findFirst({
      where: { organizationId: BIOFUEL_ORG_ID, type: 'INVOICE', templateVariant: VARIANT },
      select: { id: true },
    });

    let templateId: string;
    if (existing) {
      await prisma.documentTemplate.update({
        where: { id: existing.id },
        data: {
          name: 'JPSG Consolidated Invoice (Postpaid)',
          designName: 'JPSG Consolidated',
          description: 'Weekly consolidated postpaid disposal invoice (period, material summary, daily breakdown).',
          isActive: true,
          config: CONFIG,
        },
      });
      templateId = existing.id;
      console.log('Updated existing template', templateId);
    } else {
      const created = await prisma.documentTemplate.create({
        data: {
          organizationId: BIOFUEL_ORG_ID,
          name: 'JPSG Consolidated Invoice (Postpaid)',
          type: 'INVOICE',
          templateVariant: VARIANT,
          designName: 'JPSG Consolidated',
          description: 'Weekly consolidated postpaid disposal invoice (period, material summary, daily breakdown).',
          isActive: true,
          config: CONFIG,
        },
        select: { id: true },
      });
      templateId = created.id;
      console.log('Created template', templateId);
    }

    // Activate for the org (add to active set) — not primary, so normal invoice
    // creation keeps its default template.
    await prisma.organizationActiveTemplate.upsert({
      where: {
        organizationId_type_templateId: {
          organizationId: BIOFUEL_ORG_ID,
          type: 'INVOICE',
          templateId,
        },
      },
      create: { organizationId: BIOFUEL_ORG_ID, type: 'INVOICE', templateId },
      update: {},
    });
    console.log('Activated JPSG_CONSOLIDATED invoice template for Biofuel:', templateId);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
