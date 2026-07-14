/**
 * Copy ALL Biofuel customers (+ their CustomerContacts / Attn-To people)
 * from DEV to a target env. Upsert semantics — existing target rows are
 * matched by id → xeroId → (email, org) and UPDATED; missing ones created.
 * Safe for prod where customers already exist under their own row ids.
 *
 * Run: npx ts-node --transpile-only scripts/copy-biofuel-customers.ts .env.staging
 *      npx ts-node --transpile-only scripts/copy-biofuel-customers.ts .env.production
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const targetEnv = process.argv[2];
if (!targetEnv || !fs.existsSync(targetEnv)) throw new Error('Usage: ... <.env.staging|.env.production>');

function clientFor(envFile: string): PrismaClient {
  const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!m) throw new Error(`No DATABASE_URL in ${envFile}`);
  const url = new URL(m[1]);
  url.searchParams.delete('pool_timeout');
  url.searchParams.delete('connect_timeout');
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
}
const dev = clientFor('.env');
const tgt = clientFor(targetEnv);

async function main() {
  console.log(`Copying Biofuel customers dev → ${targetEnv}`);
  const customers = await dev.customer.findMany({ where: { organizationId: ORG } });
  const contacts = await dev.customerContact.findMany({ where: { customer: { organizationId: ORG } } });
  const contactsByCustomer = new Map<string, any[]>();
  for (const c of contacts) {
    const list = contactsByCustomer.get(c.customerId) || [];
    list.push(c);
    contactsByCustomer.set(c.customerId, list);
  }
  console.log(`dev: ${customers.length} customers, ${contacts.length} contacts`);

  let created = 0, updated = 0, contactsUpserted = 0, failed = 0;
  for (const cust of customers) {
    const { id, createdAt, updatedAt, ...data } = cust as any;
    try {
      // Match: same id → same xeroId → same (email, org)
      let target = await tgt.customer.findUnique({ where: { id } }).catch(() => null);
      if (!target && cust.xeroId) target = await tgt.customer.findUnique({ where: { xeroId: cust.xeroId } }).catch(() => null);
      if (!target && cust.email) target = await tgt.customer.findFirst({ where: { organizationId: ORG, email: cust.email } }).catch(() => null);

      let targetId: string;
      if (target) {
        // Don't clobber a different org's row (xeroId is globally unique).
        if (target.organizationId !== ORG) { failed++; console.log(`  ⚠ ${cust.name}: xeroId/email matches a row in another org — skipped`); continue; }
        const patch: any = { ...data };
        try {
          await tgt.customer.update({ where: { id: target.id }, data: patch });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e;
          delete patch.email; // shared-email collision — keep target's email
          await tgt.customer.update({ where: { id: target.id }, data: patch });
        }
        targetId = target.id;
        updated++;
      } else {
        try {
          await tgt.customer.create({ data: { id, ...data } });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e;
          await tgt.customer.create({ data: { id, ...data, email: null } });
        }
        targetId = id;
        created++;
      }
      // Attn-To contacts: upsert by (customerId, name).
      for (const ct of contactsByCustomer.get(cust.id) || []) {
        const existing = await tgt.customerContact.findFirst({ where: { customerId: targetId, name: ct.name }, select: { id: true } });
        if (existing) {
          await tgt.customerContact.update({ where: { id: existing.id }, data: { email: ct.email, phone: ct.phone, designation: ct.designation, isPrimary: ct.isPrimary } });
        } else {
          await tgt.customerContact.create({ data: { customerId: targetId, name: ct.name, email: ct.email, phone: ct.phone, designation: ct.designation, isPrimary: ct.isPrimary } });
        }
        contactsUpserted++;
      }
    } catch (e: any) {
      failed++;
      console.log(`  ✗ ${cust.name}: ${(e?.message || '').slice(-140)}`);
    }
  }
  const total = await tgt.customer.count({ where: { organizationId: ORG } });
  console.log(`\n✓ done: created=${created} updated=${updated} contacts=${contactsUpserted} failed=${failed}`);
  console.log(`target now has ${total} Biofuel customers (dev has ${customers.length})`);
}

main()
  .catch((e) => { console.error('FATAL', e?.message || e); process.exit(1); })
  .finally(async () => { await dev.$disconnect(); await tgt.$disconnect(); });
