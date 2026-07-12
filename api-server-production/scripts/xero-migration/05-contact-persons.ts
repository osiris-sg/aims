/**
 * Xero → AIMS migration · Stage 5 · Contact Persons ("Attn To")
 *
 * Xero stores people on a Contact two ways:
 *   - FirstName/LastName/EmailAddress on the contact itself (the primary person)
 *   - ContactPersons[] (additional people)
 * AIMS stores them in CustomerContact (per-customer, feeds the "Attn To"
 * dropdown in the document editor).
 *
 * The list endpoint does NOT return ContactPersons, so this fetches each
 * customer's contact individually (rate-limited by _common's throttle).
 *
 * Customers only — AIMS has no supplier-side contacts table.
 * Idempotent: upsert by (customerId, name).
 *
 * Run: npx ts-node --transpile-only scripts/xero-migration/05-contact-persons.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { BIOFUEL_ORG_ID, getXeroTokens, xeroGet, createScriptPrisma } from "./_common";

const prisma = createScriptPrisma();

type XeroContactPerson = {
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
};

type XeroContactDetail = {
  ContactID: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  ContactPersons?: XeroContactPerson[];
};

function personName(p: { FirstName?: string; LastName?: string }): string | null {
  const n = [p.FirstName?.trim(), p.LastName?.trim()].filter(Boolean).join(" ");
  return n || null;
}

async function upsertContact(customerId: string, name: string, email: string | null, isPrimary: boolean) {
  const existing = await prisma.customerContact.findFirst({
    where: { customerId, name },
    select: { id: true },
  });
  if (existing) {
    await prisma.customerContact.update({
      where: { id: existing.id },
      data: { email, isPrimary },
    });
    return "updated" as const;
  }
  await prisma.customerContact.create({
    data: { customerId, name, email, isPrimary },
  });
  return "created" as const;
}

async function main() {
  console.log(`[Contact Persons] Biofuel org=${BIOFUEL_ORG_ID}`);
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);

  const customers = await prisma.customer.findMany({
    where: { organizationId: BIOFUEL_ORG_ID, xeroId: { not: null } },
    select: { id: true, name: true, xeroId: true },
  });
  console.log(`  ${customers.length} customers with xeroId`);

  let created = 0,
    updated = 0,
    noPersons = 0,
    failed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < customers.length; i++) {
    const cust = customers[i];
    try {
      const res = await xeroGet<{ Contacts: XeroContactDetail[] }>(tokens, `/Contacts/${cust.xeroId}`);
      const c = res.Contacts?.[0];
      if (!c) {
        noPersons++;
        continue;
      }

      let any = false;

      // Primary person lives on the contact itself.
      const primaryName = personName(c);
      if (primaryName) {
        const r = await upsertContact(cust.id, primaryName, c.EmailAddress?.trim() || null, true);
        r === "created" ? created++ : updated++;
        any = true;
      }

      // Additional people.
      for (const p of c.ContactPersons || []) {
        const n = personName(p);
        if (!n) continue;
        const r = await upsertContact(cust.id, n, p.EmailAddress?.trim() || null, false);
        r === "created" ? created++ : updated++;
        any = true;
      }

      if (!any) noPersons++;
    } catch (e: any) {
      failed++;
      if (failed <= 20) console.warn(`  ⚠️  ${cust.name}: ${e.message?.slice(-300)}`);
    }

    if ((i + 1) % 50 === 0) {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      console.log(`  ${i + 1}/${customers.length} · created=${created} updated=${updated} no-persons=${noPersons} failed=${failed} · ${secs}s`);
    }
  }

  console.log(`\n[Contact Persons] done · created=${created} updated=${updated} no-persons=${noPersons} failed=${failed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
