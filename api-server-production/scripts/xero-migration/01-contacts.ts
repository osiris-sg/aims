/**
 * Xero → AIMS migration · Stage 1 · Contacts
 *
 * Pulls every Xero Contact for Biofuel and upserts into Customer + Supplier.
 * In Xero a single Contact can be both a customer and supplier — we mirror
 * that by inserting into both tables when IsCustomer + IsSupplier are set.
 *
 * Idempotent: every row keyed on Xero ContactID (via Customer.xeroId /
 * Supplier.xeroId, both UNIQUE in the schema). Re-runs upsert; never dup.
 *
 * Run: npx ts-node scripts/xero-migration/01-contacts.ts
 */

import { PrismaClient } from "@prisma/client";
import * as dotenv from "dotenv";
dotenv.config();

import { BIOFUEL_ORG_ID, getXeroTokens, xeroGet } from "./_common";

const prisma = new PrismaClient();

type XeroAddress = {
  AddressType?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  Region?: string;
  PostalCode?: string;
  Country?: string;
};

type XeroPhone = {
  PhoneType?: string;
  PhoneNumber?: string;
  PhoneAreaCode?: string;
  PhoneCountryCode?: string;
};

type XeroContact = {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  TaxNumber?: string;
  Addresses?: XeroAddress[];
  Phones?: XeroPhone[];
  ContactStatus?: string;
};

function formatAddress(addresses?: XeroAddress[]): string | null {
  if (!addresses?.length) return null;
  // Prefer street address over postal address.
  const a = addresses.find((x) => x.AddressType === "STREET") || addresses[0];
  const parts = [a.AddressLine1, a.AddressLine2, a.City, a.Region, a.PostalCode, a.Country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function formatPhone(phones?: XeroPhone[]): string | null {
  if (!phones?.length) return null;
  const p = phones.find((x) => x.PhoneNumber) || phones[0];
  if (!p.PhoneNumber) return null;
  const cc = p.PhoneCountryCode ? `+${p.PhoneCountryCode} ` : "";
  const ac = p.PhoneAreaCode ? `${p.PhoneAreaCode} ` : "";
  return `${cc}${ac}${p.PhoneNumber}`.trim();
}

async function main() {
  console.log(`[Contacts] Biofuel org=${BIOFUEL_ORG_ID}`);
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  console.log(`[Contacts] tenant=${tokens.tenantId}`);

  // Pagination: Xero returns 100 contacts/page.
  let page = 1;
  let totalSeen = 0;
  let custCreated = 0,
    custUpdated = 0,
    supCreated = 0,
    supUpdated = 0;

  // Track which roles each Xero contact has so we report cleanly.
  while (true) {
    const data = await xeroGet<{ Contacts: XeroContact[] }>(tokens, "/Contacts", {
      page,
      includeArchived: "true",
      summaryOnly: "false",
    });

    const contacts = data.Contacts || [];
    if (contacts.length === 0) break;
    totalSeen += contacts.length;
    console.log(`[Contacts] page ${page}: ${contacts.length} contacts (running total ${totalSeen})`);

    for (const c of contacts) {
      const address = formatAddress(c.Addresses);
      const phone = formatPhone(c.Phones);
      const email = c.EmailAddress?.trim() || null;
      const gstRegNo = c.TaxNumber || null;
      const name = c.Name?.trim() || "(unnamed contact)";
      // Xero defaults IsCustomer=true if neither is set (manual contacts).
      // We treat that conservatively: insert as customer only.
      const isCustomer = c.IsCustomer !== false;
      const isSupplier = c.IsSupplier === true;

      if (isCustomer) {
        try {
          const existing = await prisma.customer.findUnique({ where: { xeroId: c.ContactID } });
          const payload = {
            organizationId: BIOFUEL_ORG_ID,
            name,
            email,
            phone,
            address,
            gstRegNo,
            xeroId: c.ContactID,
            xeroLastSyncAt: new Date(),
          };
          if (existing) {
            await prisma.customer.update({ where: { id: existing.id }, data: payload });
            custUpdated++;
          } else {
            // Watch for email collision (unique on email + organizationId).
            if (email) {
              const byEmail = await prisma.customer.findUnique({
                where: { email_organizationId: { email, organizationId: BIOFUEL_ORG_ID } },
              });
              if (byEmail) {
                // Adopt the existing row — attach xeroId so future syncs flow.
                await prisma.customer.update({ where: { id: byEmail.id }, data: payload });
                custUpdated++;
                continue;
              }
            }
            await prisma.customer.create({ data: payload });
            custCreated++;
          }
        } catch (e: any) {
          console.warn(`  ⚠️  customer ${name}: ${e.message?.slice(0, 150)}`);
        }
      }

      if (isSupplier) {
        try {
          const existing = await prisma.supplier.findUnique({ where: { xeroId: c.ContactID } });
          const payload = {
            organizationId: BIOFUEL_ORG_ID,
            name,
            email,
            phone,
            address,
            gstRegNo,
            xeroId: c.ContactID,
            xeroLastSyncAt: new Date(),
          };
          if (existing) {
            await prisma.supplier.update({ where: { id: existing.id }, data: payload });
            supUpdated++;
          } else {
            if (email) {
              const byEmail = await prisma.supplier.findUnique({
                where: { email_organizationId: { email, organizationId: BIOFUEL_ORG_ID } },
              });
              if (byEmail) {
                await prisma.supplier.update({ where: { id: byEmail.id }, data: payload });
                supUpdated++;
                continue;
              }
            }
            await prisma.supplier.create({ data: payload });
            supCreated++;
          }
        } catch (e: any) {
          console.warn(`  ⚠️  supplier ${name}: ${e.message?.slice(0, 150)}`);
        }
      }
    }

    if (contacts.length < 100) break;
    page++;
  }

  console.log("\n[Contacts] ✓ done");
  console.log(`  Total Xero contacts seen: ${totalSeen}`);
  console.log(`  Customers: created=${custCreated} updated=${custUpdated}`);
  console.log(`  Suppliers: created=${supCreated} updated=${supUpdated}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
