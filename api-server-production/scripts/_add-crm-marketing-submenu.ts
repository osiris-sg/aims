/**
 * CRM → Marketing rollout (guru 2026-09-21): stored OrganizationModule rows
 * win over the catalog, so existing orgs' CRM config.subMenus must gain the
 * 'marketing' entry. Also flips enableAdsInsights ON for CIEL orgs (the
 * feature was built for them; other orgs keep default OFF via admin panel).
 * Idempotent.
 *
 *   npx dotenv -e <env> -- npx ts-node --transpile-only scripts/_add-crm-marketing-submenu.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.organizationModule.findMany({ where: { moduleCode: 'CRM' } });
  for (const row of rows) {
    const cfg: any = row.config || {};
    const subMenus: any[] = Array.isArray(cfg.subMenus) ? cfg.subMenus : [];
    const has = subMenus.some((s) => (typeof s === 'string' ? s : s?.key) === 'marketing');
    if (has) {
      console.log(`↷ ${row.organizationId}: marketing already present`);
      continue;
    }
    const waIdx = subMenus.findIndex((s) => (typeof s === 'string' ? s : s?.key) === 'whatsapp');
    subMenus.splice(waIdx >= 0 ? waIdx + 1 : subMenus.length, 0, { key: 'marketing', label: 'Marketing' });
    await prisma.organizationModule.update({ where: { id: row.id }, data: { config: { ...cfg, subMenus } } });
    console.log(`✔ ${row.organizationId}: marketing submenu added`);
  }

  const ciel = await prisma.organization.findMany({ where: { name: { contains: 'CIEL', mode: 'insensitive' } }, select: { id: true, name: true } });
  for (const org of ciel) {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: org.id } });
    const features: any = (ui?.features as any) || {};
    if (features.enableAdsInsights === true) {
      console.log(`↷ ${org.name}: flag already on`);
      continue;
    }
    if (ui) {
      await prisma.organizationUIConfig.update({ where: { organizationId: org.id }, data: { features: { ...features, enableAdsInsights: true } } });
    } else {
      await prisma.organizationUIConfig.create({ data: { organizationId: org.id, features: { enableAdsInsights: true } } });
    }
    console.log(`✔ ${org.name}: enableAdsInsights ON`);
  }
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
