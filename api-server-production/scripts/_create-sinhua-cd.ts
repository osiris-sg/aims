// Create "Customer Deposit-Sin Hua Civil Engineering & Construction Pte Ltd"
// in Biofuel's CoA in dev+staging+prod, using one shared next-free CD0xx code
// (computed across all three) and each env's own CD parent account.
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const NAME = 'Customer Deposit-Sin Hua Civil Engineering & Construction Pte Ltd';
const ENVS: Array<['dev' | 'staging' | 'prod', string]> = [
  ['dev', '.env'], ['staging', '.env.staging'], ['prod', '.env.production'],
];

function client(envFile: string) {
  dotenv.config({ path: path.resolve(__dirname, '..', envFile), override: true });
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
}

async function main() {
  // Pass 1: scan all envs for CD codes + existing Sin Hua rows + parent ids.
  const scans: Record<string, { max: number; existing: any; parentId: string | null }> = {};
  for (const [env, file] of ENVS) {
    const p = client(file);
    const rows = await p.chartOfAccount.findMany({
      where: { organizationId: BIOFUEL, code: { startsWith: 'CD' } },
      select: { code: true, name: true, parentAccountId: true },
    });
    const nums = rows.map((r) => parseInt(r.code.slice(2), 10)).filter((n) => !isNaN(n));
    const existing = rows.find((r) => /sin hua/i.test(r.name));
    // Parent = the CD000 control account (dev/staging have it; prod gets it
    // created below).
    const control = await p.chartOfAccount.findFirst({
      where: { organizationId: BIOFUEL, code: 'CD000' },
      select: { id: true },
    });
    scans[env] = {
      max: nums.length ? Math.max(...nums) : 0,
      existing,
      parentId: control?.id ?? null,
    };
    console.log(`[${env}] ${rows.length} CD accounts, max CD${String(scans[env].max).padStart(3, '0')}, parent=${scans[env].parentId}, sinHua=${existing ? existing.code : 'none'}`);
    await p.$disconnect();
  }
  const next = Math.max(...Object.values(scans).map((s) => s.max)) + 1;
  const code = `CD${String(next).padStart(3, '0')}`;
  console.log(`Shared code: ${code} — "${NAME}"`);
  if (!APPLY) { console.log('dry-run — pass --apply to write'); return; }

  for (const [env, file] of ENVS) {
    if (scans[env].existing) { console.log(`[${env}] skip — already has ${scans[env].existing.code}`); continue; }
    const p = client(file);
    if (!scans[env].parentId) {
      const ctrl = await p.chartOfAccount.create({
        data: {
          organizationId: BIOFUEL,
          code: 'CD000',
          name: 'Customer Deposits (Control)',
          accountType: 'CURRENT_ASSET',
          category: 'BALANCE_SHEET',
          normalBalance: 'DEBIT',
        },
        select: { id: true },
      });
      scans[env].parentId = ctrl.id;
      console.log(`[${env}] created CD000 Customer Deposits (Control)`);
    }
    const created = await p.chartOfAccount.create({
      data: {
        organizationId: BIOFUEL,
        code,
        name: NAME,
        accountType: 'CURRENT_ASSET',
        category: 'BALANCE_SHEET',
        normalBalance: 'DEBIT',
        parentAccountId: scans[env].parentId,
      },
      select: { id: true, code: true, name: true },
    });
    console.log(`[${env}] CREATED ${created.code} (${created.id})`);
    await p.$disconnect();
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
