/**
 * One-off: seed a "Bill" DocumentTemplate for Biofuel so the Xero AP importer
 * has a templateId to attach to each Document row (the FK is required).
 */
import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();
import { BIOFUEL_ORG_ID } from "./_common";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.documentTemplate.findFirst({
    where: { organizationId: BIOFUEL_ORG_ID, type: "BILL" },
  });
  if (existing) {
    console.log(`Bill template already exists: ${existing.id} (${existing.name})`);
    return;
  }

  // Minimal template — just enough for the FK. Xero import stores the real
  // data in Document.config; the template only matters when the UI later
  // renders an editable bill form for these.
  const tmpl = await prisma.documentTemplate.create({
    data: {
      organizationId: BIOFUEL_ORG_ID,
      name: "Bill (Xero import)",
      type: "BILL",
      isActive: true,
      templateVariant: "Default",
      designName: "Default",
      description: "Auto-created for Xero AP bill imports",
      // Real shape lives in config — mirrors how other templates store
      // table columns / column labels for the renderer.
      config: {
        tableColumnOrder: ["description", "quantity", "unitPrice", "taxAmount", "amount"],
        columnLabels: { description: "Description", quantity: "Qty", unitPrice: "Unit Price", taxAmount: "Tax", amount: "Amount" },
        formFields: [],
      },
    },
  });
  console.log(`Created Bill template: ${tmpl.id}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
