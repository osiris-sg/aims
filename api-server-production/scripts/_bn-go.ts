/**
 * Round BN — prod data change for ADH's 請求書 texts (dry run by default; --apply writes, needs the owner's go):
 *   docDefaults.invoiceRemarksTemplate   → ADH's Oct 2026 per-line breakdown ("LME Cash 2026年9月平均　/USD 3276.82/ + Q3 MJP 395.00 …")
 *   docDefaults.invoice1UpchargeTemplate → "\n + {grade} Upcharge {upcharge:2}" (Invoice #1 only; Invoice #2 keeps invoiceUpchargeTemplate)
 *   docDefaults.invoiceFxNote            → "円/USD {ttmDate}  三菱UFJ銀行TTM参照" (the business day before the issue date)
 * Only these keys; a key whose stored value already differs from what AIMS seeded (typed by someone in Settings) is
 * reported and NOT overwritten unless --force-key=<key>. Writes an Activity Log row with before → after.
 * Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bn-go.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { PROPOSED } from './_bn-preview';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
/** What AIMS seeded (setup-adh-org.ts) — a stored value equal to this was never typed by a user. */
const SEEDED: Record<string, string | undefined> = {
  invoiceRemarksTemplate: 'LME Cash {month}月平均({LME}USD) +{QMJP}({q}QMJP) +{premium}(Billet Premium){upcharge}\n\nTotal Premium is {QMJP}({q}QMJP) + {totalPremium}',
  invoice1UpchargeTemplate: undefined,
  invoiceFxNote: '円/USD 税関{range} 外国為替相場参照',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const forced = new Set(process.argv.filter((a) => a.startsWith('--force-key=')).map((a) => a.slice(12)));
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const row: any = await p.tradeSetting.findUnique({ where: { organizationId: ADH }, select: { docDefaults: true } });
  const cur = (row?.docDefaults ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const log: Array<{ key: string; from: unknown; to: unknown; action: string }> = [];
  for (const [k, to] of Object.entries(PROPOSED)) {
    const from = cur[k];
    if (from === to) log.push({ key: k, from, to, action: 'already set' });
    else if (from !== undefined && from !== SEEDED[k] && !forced.has(k)) log.push({ key: k, from, to, action: 'SKIPPED (typed by a user; --force-key to replace)' });
    else {
      patch[k] = to;
      log.push({ key: k, from: from ?? null, to, action: apply ? 'written' : 'would write' });
    }
  }
  for (const l of log) console.log(`${l.action.padEnd(12)} ${l.key}\n   from: ${JSON.stringify(l.from)}\n   to:   ${JSON.stringify(l.to)}`);
  if (apply && Object.keys(patch).length) {
    await p.$transaction([
      p.tradeSetting.update({ where: { organizationId: ADH }, data: { docDefaults: { ...cur, ...patch } as any } }),
      p.actionLog.create({
        data: {
          actorType: 'SYSTEM',
          actorId: 'system:round-bn-go',
          actorName: 'System creation',
          organizationId: ADH,
          channel: 'script',
          action: 'UPDATE',
          resource: 'TradeSetting.docDefaults',
          resourceId: ADH,
          details: { script: 'scripts/_bn-go.ts', go: 'owner, round BN item 3 / 5', changes: log.filter((l) => l.action === 'written') } as any,
        },
      }),
    ]);
    console.log(`applied ${Object.keys(patch).length} key(s); Activity Log row written`);
  } else console.log(apply ? 'nothing to apply' : 'DRY RUN — nothing written (add --apply after the go)');
  await p.$disconnect();
}

if (require.main === module)
  main().catch((e) => {
    console.error(String(e?.message ?? e).slice(0, 400));
    process.exit(1);
  });
