import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

const BIOFUEL_ORG_NAME = 'Biofuel';
const CSV_PATH = '/Users/guru/Downloads/xero contacts.csv';

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function generateCustomerCode(name: string, organizationId: string): Promise<string> {
  const firstLetter = name?.trim().charAt(0).toUpperCase() || 'X';
  const prefix = `C${firstLetter}`;

  const existingCount = await prisma.customer.count({
    where: {
      organizationId,
      customerCode: { startsWith: prefix },
    },
  });

  const sequentialNumber = String(existingCount + 1).padStart(3, '0');
  return `${prefix}${sequentialNumber}`;
}

async function importContacts() {
  console.log('=== Importing Xero Contacts into Biofuel Customers ===\n');

  const org = await prisma.organization.findFirst({
    where: { name: { contains: BIOFUEL_ORG_NAME, mode: 'insensitive' } },
  });

  if (!org) {
    console.error('Biofuel organization not found');
    process.exit(1);
  }

  console.log(`Found org: ${org.name} (${org.id})\n`);

  // Read CSV
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = csvContent.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);

  // Find column indices
  const nameIdx = headers.findIndex(h => h.replace('*', '') === 'ContactName');
  const emailIdx = headers.findIndex(h => h === 'EmailAddress');
  const phoneIdx = headers.findIndex(h => h === 'PhoneNumber');
  const mobileIdx = headers.findIndex(h => h === 'MobileNumber');
  const taxIdx = headers.findIndex(h => h === 'TaxNumber');
  // Address fields (SA = Street Address)
  const saLine1Idx = headers.findIndex(h => h === 'SAAddressLine1');
  const saLine2Idx = headers.findIndex(h => h === 'SAAddressLine2');
  const saCityIdx = headers.findIndex(h => h === 'SACity');
  const saRegionIdx = headers.findIndex(h => h === 'SARegion');
  const saPostalIdx = headers.findIndex(h => h === 'SAPostalCode');
  const saCountryIdx = headers.findIndex(h => h === 'SACountry');

  console.log(`Found ${lines.length - 1} contacts in CSV\n`);

  // Get existing customers to avoid duplicates
  const existingCustomers = await prisma.customer.findMany({
    where: { organizationId: org.id },
    select: { name: true, email: true },
  });
  const existingNames = new Set(existingCustomers.map(c => c.name.toLowerCase()));

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const name = fields[nameIdx];

    if (!name) {
      skipped++;
      continue;
    }

    // Skip duplicates
    if (existingNames.has(name.toLowerCase())) {
      console.log(`⏭️  Skipping (exists): ${name}`);
      skipped++;
      continue;
    }

    const email = fields[emailIdx] || null;
    const phone = fields[phoneIdx] || fields[mobileIdx] || null;
    const gstRegNo = fields[taxIdx] || null;

    // Build address from SA fields
    const addressParts = [
      fields[saLine1Idx],
      fields[saLine2Idx],
      fields[saCityIdx],
      fields[saRegionIdx],
      fields[saPostalIdx],
      fields[saCountryIdx],
    ].filter(Boolean);
    const address = addressParts.length > 0 ? addressParts.join(', ') : null;

    try {
      const customerCode = await generateCustomerCode(name, org.id);

      await prisma.customer.create({
        data: {
          name,
          email,
          phone,
          address,
          gstRegNo,
          customerCode,
          organizationId: org.id,
        },
      });

      console.log(`✅ Created: ${name} (${customerCode})`);
      existingNames.add(name.toLowerCase());
      created++;
    } catch (error: any) {
      console.error(`❌ Failed: ${name} - ${error.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done: ${created} created, ${skipped} skipped, ${failed} failed ===`);
  await prisma.$disconnect();
}

importContacts().catch((error) => {
  console.error('Script failed:', error);
  prisma.$disconnect();
  process.exit(1);
});
