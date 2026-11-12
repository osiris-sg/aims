/**
 * Merge one customer into another, then retire the source.
 * (guru 2026-11-12: "merge all to cq008 thats the correct one remove the 007"
 *  — QJI-CCG Joint Venture / CQ007 was a second record for the JV whose
 *  invoices all sit under QJI-GCC / CQ008, so its delivery orders were
 *  stranded on a customer with no billing.)
 *
 * DRY RUN by default. Pass --apply to write.
 *
 * Repoints EVERY reference, found by scanning information_schema rather than
 * a hand-kept list of models, so a table added later isn't silently missed:
 *   - every column named customerId / listCustomerId on every table
 *   - Document.config JSON, which carries its own copy of the customer
 *     (config.customer.id / .customerId) plus the displayed name and code
 * The source customer is deleted only when nothing references it any more,
 * its Xero link is carried over if the target has none, and the deletion is
 * written to the Activity Log.
 */
import { createScriptPrisma } from './xero-migration/_common';

const prisma = createScriptPrisma();
const APPLY = process.argv.includes('--apply');
const arg = (k: string, d: string) =>
  (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;

const ORG = arg('org', '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1');
const FROM_CODE = arg('from', 'CQ007');
const TO_CODE = arg('to', 'CQ008');

async function main() {
  const from = await prisma.customer.findFirst({ where: { organizationId: ORG, customerCode: FROM_CODE } });
  const to = await prisma.customer.findFirst({ where: { organizationId: ORG, customerCode: TO_CODE } });
  if (!from || !to) throw new Error(`customer not found: ${!from ? FROM_CODE : TO_CODE}`);
  if (from.id === to.id) throw new Error('source and target are the same customer');

  console.log(`FROM  ${FROM_CODE}  ${from.name}  ${from.id}`);
  console.log(`TO    ${TO_CODE}  ${to.name}  ${to.id}`);
  console.log(APPLY ? '\n*** APPLY ***\n' : '\n(dry run — nothing is written; pass --apply)\n');

  // ---- 1. every FK-ish column, discovered not assumed
  const cols: any[] = await prisma.$queryRaw`
    SELECT table_name::text AS table_name, column_name::text AS column_name
    FROM information_schema.columns
    -- 'public' is staging / prod's layout. On a per-org tenancy database the
    -- org's tables live in org_<code>, so this finds nothing there: pass that
    -- schema instead before running it on dev.
    WHERE table_schema = 'public' AND column_name IN ('customerId', 'listCustomerId')
    ORDER BY table_name, column_name`;

  let moved = 0;
  for (const { table_name, column_name } of cols) {
    const n: any[] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table_name}" WHERE "${column_name}" = $1`, from.id);
    const count = n[0]?.n ?? 0;
    if (!count) continue;
    console.log(`  ${String(count).padStart(5)}  ${table_name}.${column_name}`);
    moved += count;
    if (APPLY) {
      await prisma.$executeRawUnsafe(
        `UPDATE "${table_name}" SET "${column_name}" = $1 WHERE "${column_name}" = $2`, to.id, from.id);
    }
  }
  if (!moved) console.log('  (no column references)');

  // ---- 2. Document.config, which holds its own copy of the customer
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG },
    select: { id: true, name: true, type: true, config: true },
  });
  const touched = docs.filter((d) => {
    const c: any = d.config || {};
    return c?.customer?.id === from.id || c?.customerId === from.id;
  });
  console.log(`\n  ${String(touched.length).padStart(5)}  Document.config customer block`);
  for (const d of touched) console.log(`           ${String(d.type).padEnd(22)} ${d.name}`);

  if (APPLY) {
    for (const d of touched) {
      const c: any = { ...(d.config as any) };
      if (c.customer && typeof c.customer === 'object') {
        c.customer = { ...c.customer, id: to.id, name: to.name, customerCode: (to as any).customerCode ?? c.customer.customerCode };
      }
      if (c.customerId === from.id) c.customerId = to.id;
      if (c.customerName === from.name) c.customerName = to.name;
      if (c.customerCode === FROM_CODE) c.customerCode = TO_CODE;
      await prisma.document.update({ where: { id: d.id }, data: { config: c } });
    }
  }

  // ---- 3. carry the Xero link, if only the source has one. Dropping it would
  // leave the surviving customer unlinked and the next Xero sync would create a
  // THIRD contact for the same company.
  if (!(to as any).xeroId && (from as any).xeroId) {
    console.log(`\n  Xero link ${(from as any).xeroId} carried to ${TO_CODE} (it had none)`);
    if (APPLY) await prisma.customer.update({ where: { id: to.id }, data: { xeroId: (from as any).xeroId } as any });
  }

  // ---- 4. retire the source, but only once nothing points at it
  if (APPLY) {
    let left = 0;
    for (const { table_name, column_name } of cols) {
      const n: any[] = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM "${table_name}" WHERE "${column_name}" = $1`, from.id);
      left += n[0]?.n ?? 0;
    }
    if (left) {
      console.log(`\n✗ ${left} references still point at ${FROM_CODE} — NOT deleting it.`);
    } else {
      await prisma.customer.delete({ where: { id: from.id } });
      // Deleting a customer on a live org has to be on the Activity Log
      // (CLAUDE.md: non-HTTP work writes its own row, actor "System creation").
      await prisma.actionLog.create({
        data: {
          actorType: 'SYSTEM', actorId: 'system:merge-customer', actorName: 'System creation',
          organizationId: ORG, channel: 'cron', action: 'DELETE', resource: 'customers', resourceId: from.id,
          details: {
            note: `merged into ${TO_CODE} ${to.name}`,
            removed: `${FROM_CODE} ${from.name}`,
            rowsMoved: moved,
            documentsMoved: touched.length,
          },
        },
      });
      console.log(`\n✓ merged into ${TO_CODE}; ${FROM_CODE} deleted (logged on the Activity Log).`);
    }
  } else {
    console.log(`\nWould then delete ${FROM_CODE} (${from.name}).`);
  }

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
