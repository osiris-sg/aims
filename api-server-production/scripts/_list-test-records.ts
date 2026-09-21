/**
 * List recent deliveries + documents so the test ones can be identified before
 * deleting anything. READ-ONLY.
 *
 *   npx ts-node -r dotenv/config --transpile-only scripts/_list-test-records.ts <orgId> dotenv_config_path=.env.production
 *   ... _list-test-records.ts <orgId> 3 ...     (last 3 days, default 2)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('dotenv_'));
  const orgId = args[0];
  const days = Number(args[1] || 2);
  if (!orgId) {
    const orgs = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
    console.log('Pass an organizationId. Available:\n');
    for (const o of orgs) console.log(`  ${o.id}  ${o.name}`);
    return;
  }
  const since = new Date(Date.now() - days * 86400_000);
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  console.log(`${org?.name || orgId} — last ${days} day(s)\n`);

  const runs = await prisma.delivery.findMany({
    where: { organizationId: orgId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, deliveryNumber: true, status: true, isDraft: true, scheduledFor: true,
      createdAt: true, projectId: true,
      items: { select: { id: true, inventoryId: true, documentId: true } },
    },
  });
  console.log(`DELIVERIES (${runs.length}):`);
  if (!runs.length) console.log('  (none)');
  for (const r of runs) {
    const bound = r.items.filter((i) => i.inventoryId).length;
    const deletable = r.status === 'scheduled' && !bound;
    console.log(`  ${r.deliveryNumber || r.id}`);
    console.log(`    id:        ${r.id}`);
    console.log(`    status:    ${r.status}${r.isDraft ? ' (DRAFT)' : ''}   created ${r.createdAt.toISOString().slice(0, 16)}`);
    console.log(`    scheduled: ${r.scheduledFor ? r.scheduledFor.toISOString().slice(0, 16) : '(none)'}`);
    console.log(`    items:     ${r.items.length}  bound units: ${bound}`);
    console.log(`    linked DO: ${[...new Set(r.items.map((i) => i.documentId).filter(Boolean))].join(', ') || '(none)'}`);
    console.log(`    ${deletable ? '✅ deletable (Deliveries page → delete)' : '⚠️  must be CANCELLED, not deleted'}\n`);
  }

  const docs = await prisma.document.findMany({
    where: { organizationId: orgId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, type: true, status: true, createdAt: true, config: true },
  });
  console.log(`DOCUMENTS (${docs.length}):`);
  if (!docs.length) console.log('  (none)');
  for (const d of docs) {
    const cfg: any = d.config || {};
    const total = cfg.nettTotal ?? cfg.total ?? cfg.subTotal ?? null;
    console.log(`  ${d.name || '(unnamed)'}  [${d.type}]  ${d.status}`);
    console.log(`    id:      ${d.id}`);
    console.log(`    created: ${d.createdAt.toISOString().slice(0, 16)}${total != null ? `   total: ${total}` : ''}`);
    console.log(`    lines:   ${(cfg.items || []).length}\n`);
  }
}

main()
  .catch((e) => { console.error('❌', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
