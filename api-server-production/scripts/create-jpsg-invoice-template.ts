import { PrismaClient, Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Seeds the bespoke JPSG "Invoice for SOIL DISPOSAL" invoice template for
// Biofuel and activates it for the org. Idempotent — safe to re-run.
//
// The template's config.tableColumnOrder drives the custom line-item columns
// (Vehicle No / Material Type / Weight (T) / Unit Rate / Min. Load / Amount).
// The ingestion service (src/ingestion) resolves this template by its
// templateVariant 'JPSG_DISPOSAL' and stamps each ingested invoice with it.
// ---------------------------------------------------------------------------

const BIOFUEL_ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const VARIANT = 'JPSG_DISPOSAL';

const CONFIG = {
  templateStyle: 'JPSG_DISPOSAL',
  tableColumnOrder: ['no', 'vehicleNo', 'materialType', 'weightT', 'unitRate', 'minLoad', 'amount'],
  columnLabels: {
    no: 'S/No.',
    vehicleNo: 'Vehicle No.',
    materialType: 'Material Type',
    weightT: 'Weight (T)',
    unitRate: 'Unit Rate (S$)',
    minLoad: 'Min. Load (T)',
    amount: 'Amount (S$)',
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
          name: 'JPSG Soil Disposal Invoice',
          designName: 'JPSG Soil Disposal',
          description: 'Weighbridge soil-disposal invoice (Vehicle / Weight / Unit Rate / Min. Load).',
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
          name: 'JPSG Soil Disposal Invoice',
          type: 'INVOICE',
          templateVariant: VARIANT,
          designName: 'JPSG Soil Disposal',
          description: 'Weighbridge soil-disposal invoice (Vehicle / Weight / Unit Rate / Min. Load).',
          isActive: true,
          config: CONFIG,
        },
        select: { id: true },
      });
      templateId = created.id;
      console.log('Created template', templateId);
    }

    // Activate for the org (add to active set) — but NOT primary, so manually
    // created invoices keep defaulting to the standard TI2 template.
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
    console.log('Activated JPSG_DISPOSAL invoice template for Biofuel:', templateId);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
