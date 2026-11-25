/**
 * HR (Field module) switches for ONE org, by exact name. Only the HR keys of OrganizationUIConfig.features
 * are written; every other feature of the org is left as it is, and no other org is read for writing.
 *
 *   # dry run (default): prints the org and its HR switches as they are
 *   npx ts-node --transpile-only scripts/field-flags.ts --org "Osiris Technology"
 *   # switch HR on, with clocking in the AIMS app (fieldEngineLive)
 *   npx ts-node --transpile-only scripts/field-flags.ts --org "Osiris Technology" --on --live --apply --confirm-prod
 *   # switch everything off again
 *   npx ts-node --transpile-only scripts/field-flags.ts --org "Osiris Technology" --off --apply --confirm-prod
 *
 * --live is only for an org whose workers clock in with the AIMS app. Never for an org still clocking in
 * SiteClock (its shadow-imported open days would be auto-closed). Uses DATABASE_URL from .env.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ALL_FIELD_FLAGS, FIELD_ENGINE_LIVE } from '../src/field/common/field-flags';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
const args = process.argv.slice(2);
const val = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const NAME = val('--org');
const ON = args.includes('--on');
const OFF = args.includes('--off');
const LIVE = args.includes('--live');
const APPLY = args.includes('--apply');

async function main() {
  if (!NAME) throw new Error('--org "<exact organisation name>" is needed');
  if (ON && OFF) throw new Error('--on or --off, not both');
  const host = new URL(process.env.DATABASE_URL as string).host;
  const prod = host.includes('ep-icy-moon');
  if (APPLY && prod && !args.includes('--confirm-prod')) throw new Error('This is the production database: --apply also needs --confirm-prod');
  console.log(`db=${prod ? 'PRODUCTION' : host}  ${APPLY ? '*** APPLY ***' : 'DRY RUN'}`);
  const prisma = new PrismaClient();
  try {
    const orgs = await prisma.organization.findMany({ where: { name: { equals: NAME, mode: 'insensitive' } }, select: { id: true, name: true } });
    if (orgs.length !== 1) throw new Error(`${orgs.length} organisations are named "${NAME}" (need exactly one)`);
    const org = orgs[0];
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: org.id }, select: { id: true, features: true } });
    if (!ui) throw new Error(`${org.name} has no UI config row`);
    const features = ((ui.features as Record<string, unknown>) || {}) as Record<string, unknown>;
    const show = (f: Record<string, unknown>) => ALL_FIELD_FLAGS.map((k) => `${k}=${f[k] === true}`).join('  ');
    console.log(`org: ${org.name}  ${org.id}`);
    console.log(`now:  ${show(features)}`);
    const [workers, sites] = await Promise.all([
      (prisma as any).worker.count({ where: { organizationId: org.id } }),
      (prisma as any).fieldSite.count({ where: { organizationId: org.id } }),
    ]);
    console.log(`HR records: ${workers} workers, ${sites} sites`);
    if (!ON && !OFF) return;
    const next = { ...features };
    for (const k of ALL_FIELD_FLAGS) next[k] = ON && (k !== FIELD_ENGINE_LIVE || LIVE);
    console.log(`then: ${show(next)}`);
    if (!APPLY) {
      console.log('Dry run: nothing written.');
      return;
    }
    await prisma.organizationUIConfig.update({ where: { id: ui.id }, data: { features: next as any } });
    await prisma.actionLog
      .create({ data: { organizationId: org.id, actorType: 'SYSTEM', actorName: 'field-flags script', action: 'UPDATE', resource: 'organization-features', resourceId: org.id, details: { hr: Object.fromEntries(ALL_FIELD_FLAGS.map((k) => [k, next[k]])) } } as any })
      .catch((e: any) => console.warn('(activity log row not written: ' + String(e?.message || e).split('\n')[0] + ')'));
    console.log('Written.');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
