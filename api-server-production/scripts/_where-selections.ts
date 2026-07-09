import { PrismaClient } from '@prisma/client';
async function probe(label: string, url: string) {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await p.organizationActiveTemplate.findMany({
      include: { organization: { select: { name: true } } } as any,
    }).catch(async () => {
      // no relation defined — fetch org names separately
      const sel = await p.organizationActiveTemplate.findMany();
      const orgs = await p.organization.findMany({ select: { id: true, name: true } });
      const nameOf = new Map(orgs.map(o => [o.id, o.name]));
      return sel.map(s => ({ ...s, organization: { name: nameOf.get(s.organizationId) } }));
    });
    console.log(`${label}: ${rows.length} selection rows total`);
    rows.forEach((r: any) => console.log(`  ${r.organization?.name ?? r.organizationId} :: ${r.type} -> ${r.templateId} isPrimary=${r.isPrimary ?? '-'}`));
  } finally { await p.$disconnect(); }
}
(async () => {
  const { config } = await import('dotenv');
  const devUrl = config({ path: '.env' }).parsed!.DATABASE_URL;
  const stgUrl = config({ path: '.env.staging', override: true }).parsed!.DATABASE_URL;
  const prodUrl = config({ path: '.env.production', override: true }).parsed!.DATABASE_URL;
  await probe('DEV', devUrl);
  await probe('STAGING', stgUrl);
  await probe('PROD', prodUrl);
})();
