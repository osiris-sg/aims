/**
 * Round BL — turn AIMEE on for ADH: OrganizationUIConfig.features.enableAimsChat = true, the same per-org switch the
 * other orgs use (WCT, Biofuel, …). ADH only: every other org's features are read before and after and must be
 * byte-identical. DRY RUN unless --apply (prod: TENANCY_MODE= DBURL=<prod>). The write is logged (ActionLog +
 * scripts/_bl-aimee-on.log.json). Nothing else changes.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const LOG = join(__dirname, '_bl-aimee-on.log.json');
const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });

const hashOthers = async () => {
  const rows = await p.organizationUIConfig.findMany({ where: { organizationId: { not: ORG } }, orderBy: { organizationId: 'asc' }, select: { organizationId: true, features: true } });
  return { n: rows.length, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16), aimee: rows.filter((r) => (r.features as any)?.enableAimsChat === true).map((r) => r.organizationId) };
};

(async () => {
  if (!process.env.DBURL) throw new Error('DBURL is required');
  const org = await p.organization.findUnique({ where: { id: ORG }, select: { name: true } });
  if (!org) throw new Error('ADH org not found');
  const ui = await p.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { features: true } });
  const before = ((ui?.features as Record<string, unknown>) || {}).enableAimsChat ?? null;
  const others0 = await hashOthers();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${org.name}`);
  console.log(`enableAimsChat: ${JSON.stringify(before)} → true`);
  console.log(`other orgs: ${others0.n} configs, hash ${others0.hash}, AIMEE on: ${others0.aimee.length}`);
  if (before === true) {
    console.log('already on — writes planned: 0');
    return;
  }
  console.log('writes planned: 1 (OrganizationUIConfig.features.enableAimsChat for ADH)');
  if (!APPLY) return;
  if (!ui) throw new Error('ADH has no OrganizationUIConfig row (run setup-adh-org first)');
  await p.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: { ...((ui.features as object) || {}), enableAimsChat: true } as any } });
  await p.actionLog.create({
    data: { actorType: 'SYSTEM', actorId: 'system:round-bl', actorName: 'System creation', organizationId: ORG, channel: 'cron', action: 'UPDATE', resource: 'OrganizationUIConfig', resourceId: ORG, details: { field: 'features.enableAimsChat', from: before, to: true, note: "Round BL: AIMEE on for ADH (owner's go 2026-11-06)" } as any },
  });
  const others1 = await hashOthers();
  if (others1.hash !== others0.hash) throw new Error(`other orgs changed: ${others0.hash} → ${others1.hash}`);
  const rows: any[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : [];
  rows.push({ at: new Date().toISOString(), org: ORG, field: 'features.enableAimsChat', from: before, to: true, othersHash: others1.hash });
  writeFileSync(LOG, JSON.stringify(rows, null, 2));
  console.log(`applied; other orgs unchanged (hash ${others1.hash})`);
})()
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
