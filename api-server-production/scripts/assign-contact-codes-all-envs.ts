/**
 * Ensure every Biofuel customer (customerCode) and supplier (supplierCode)
 * has a code in DEV + STAGING + PROD, following the existing convention:
 *   customers: C + first letter of name + 3-digit sequence  (CA001, CB012…)
 *   suppliers: S + first letter of name + 3-digit sequence  (SG001 fits)
 *
 * Canonical assignment: one code per entity, IDENTICAL across all three DBs.
 *  - harvest codes that already exist in any env (never overwritten)
 *  - fill gaps avoiding every code already used anywhere
 *  - rows matched across envs by id → xeroId → exact name
 *  - env-only rows (e.g. prod's 5 extra customers) coded per-env afterwards
 *
 * Run: npx ts-node --transpile-only scripts/assign-contact-codes-all-envs.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

function clientFor(envFile: string): PrismaClient {
  const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!m) throw new Error(`No DATABASE_URL in ${envFile}`);
  const url = new URL(m[1]);
  url.searchParams.delete('pool_timeout');
  url.searchParams.delete('connect_timeout');
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
}
const ENVS: Array<[string, PrismaClient]> = [
  ['dev', clientFor('.env')],
  ['staging', clientFor('.env.staging')],
  ['prod', clientFor('.env.production')],
];

type Kind = 'customer' | 'supplier';
type Row = { id: string; name: string; xeroId: string | null; code: string | null };

const codeField = (k: Kind) => (k === 'customer' ? 'customerCode' : 'supplierCode');
const prefixLetter = (name: string) => {
  const ch = (name || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')[0] || 'X';
  return /[0-9]/.test(ch) ? 'N' : ch; // numeric-leading names bucket under N
};

async function fetchRows(p: PrismaClient, kind: Kind): Promise<Row[]> {
  const rows = await (p as any)[kind].findMany({
    where: { organizationId: ORG },
    select: { id: true, name: true, xeroId: true, [codeField(kind)]: true },
  });
  return rows.map((r: any) => ({ id: r.id, name: r.name, xeroId: r.xeroId, code: r[codeField(kind)] || null }));
}

async function run(kind: Kind) {
  console.log(`\n===== ${kind.toUpperCase()}S =====`);
  const base = kind === 'customer' ? 'C' : 'S';
  const perEnv = new Map<string, Row[]>();
  for (const [label, p] of ENVS) perEnv.set(label, await fetchRows(p, kind));

  // Canonical entity key: dev id when the row exists in dev, else xeroId, else name.
  const keyOf = (r: Row) => r.xeroId || `name:${r.name.trim().toLowerCase()}`;
  const canonical = new Map<string, { name: string; code: string | null }>();
  const used = new Set<string>();
  for (const [, rows] of perEnv) {
    for (const r of rows) {
      const k = keyOf(r);
      const cur = canonical.get(k) || { name: r.name, code: null };
      if (r.code && !cur.code) cur.code = r.code; // harvest any existing code
      canonical.set(k, cur);
      if (r.code) used.add(r.code);
    }
  }

  // Sequence counters per prefix, seeded past every used code.
  const nextSeq = new Map<string, number>();
  for (const code of used) {
    const m = code.match(new RegExp(`^${base}([A-Z])(\\d{3,})$`));
    if (m) nextSeq.set(m[1], Math.max(nextSeq.get(m[1]) || 0, parseInt(m[2], 10)));
  }
  const mint = (name: string): string => {
    const letter = prefixLetter(name);
    let n = (nextSeq.get(letter) || 0) + 1;
    let code: string;
    do { code = `${base}${letter}${String(n).padStart(3, '0')}`; n++; } while (used.has(code));
    nextSeq.set(letter, n - 1);
    used.add(code);
    return code;
  };

  // Assign canonical codes to entities that have none anywhere (sorted by name
  // for stable, human-friendly sequences).
  let minted = 0;
  for (const [, ent] of [...canonical.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    if (!ent.code) { ent.code = mint(ent.name); minted++; }
  }
  console.log(`entities=${canonical.size} minted new codes=${minted}`);

  // Write back per env: fill empty codes only; report divergences.
  for (const [label, p] of ENVS) {
    let set = 0, kept = 0, diverged = 0;
    for (const r of perEnv.get(label)!) {
      const ent = canonical.get(keyOf(r))!;
      if (!ent.code) continue;
      if (r.code === ent.code) { kept++; continue; }
      if (r.code && r.code !== ent.code) { diverged++; console.log(`  ⚠ ${label} ${r.name}: keeps '${r.code}' (canonical '${ent.code}')`); continue; }
      try {
        await (p as any)[kind].update({ where: { id: r.id }, data: { [codeField(kind)]: ent.code } });
        set++;
      } catch (e: any) {
        console.log(`  ✗ ${label} ${r.name} → ${ent.code}: ${(e?.message || '').slice(-100)}`);
      }
    }
    const remaining = await (p as any)[kind].count({ where: { organizationId: ORG, OR: [{ [codeField(kind)]: null }, { [codeField(kind)]: '' }] } });
    console.log(`${label}: set=${set} already-ok=${kept} diverged=${diverged} still-uncoded=${remaining}`);
  }
}

async function main() {
  await run('customer');
  await run('supplier');
}
main()
  .catch((e) => { console.error('FATAL', e?.message || e); process.exit(1); })
  .finally(async () => { for (const [, p] of ENVS) await p.$disconnect(); });
