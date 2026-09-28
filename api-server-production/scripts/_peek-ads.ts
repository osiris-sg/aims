import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const conns = await prisma.adAccountConnection.findMany({
    select: { organizationId: true, adAccountId: true, accountName: true, currency: true, status: true, lastError: true, lastSyncAt: true },
  });
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  console.log('connections:', conns.length);
  for (const c of conns) {
    console.log(` ${orgs.find(o=>o.id===c.organizationId)?.name}  ${c.adAccountId} (${c.accountName||'?'}) ${c.currency||''}`);
    console.log(`   status=${c.status} lastSync=${c.lastSyncAt?.toISOString().slice(0,16) || 'never'} ${c.lastError ? 'err='+c.lastError : ''}`);
  }
  const n = await prisma.adInsight.count();
  const range = n ? await prisma.adInsight.aggregate({ _min: { date: true }, _max: { date: true }, _sum: { spend: true, metaLeads: true } }) : null;
  console.log(`\nAdInsight rows: ${n}`);
  if (range) console.log(`  ${range._min.date?.toISOString().slice(0,10)} -> ${range._max.date?.toISOString().slice(0,10)}  spend=${range._sum.spend?.toFixed(2)}  metaLeads=${range._sum.metaLeads}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
