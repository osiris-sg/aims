require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const QF_TEMPLATE_ID = '097c9de7-7d52-4ad4-8b64-2c2cec6d91d4'; // Cappitech FCU-CU System Quotation (variant QF)

// New QF item-table layout (mockup): CU Model | FCU Model | Qty | Unit Price (List) |
// Dealer Price (Discount) | Cost Price | Remarks.
// discountPrice + costPrice are internal-only -> hidden from the clean document preview.
const config = {
  columnLabels: {
    location: 'Location',
    cuModel: 'CU Model',
    fcuModel: 'FCU Model',
    accessories: 'Accessories',
    quantity: 'Qty',
    listPrice: 'Unit Price',
    discountPrice: 'Dealer Price',
  },
  // Editor columns: Location | CU | FCU | Accessories | Qty | Unit Price | Dealer Price.
  tableColumnOrder: ['location', 'cuModel', 'fcuModel', 'accessories', 'quantity', 'listPrice', 'discountPrice'],
  // Render in the editor but EXCLUDE from CleanDocumentPreview: Accessories + Dealer Price.
  // (Preview therefore shows Location | CU | FCU | Qty | Unit Price.)
  internalColumns: ['accessories', 'discountPrice'],
};

(async () => {
  const before = await prisma.documentTemplate.findUnique({ where: { id: QF_TEMPLATE_ID }, select: { name: true, templateVariant: true, config: true } });
  console.log('Template:', before?.name, '| variant:', before?.templateVariant);
  console.log('Old config:', JSON.stringify(before?.config));

  const updated = await prisma.documentTemplate.update({
    where: { id: QF_TEMPLATE_ID },
    data: { config },
    select: { config: true },
  });
  console.log('\nNew config:', JSON.stringify(updated.config, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
