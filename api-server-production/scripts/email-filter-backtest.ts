/**
 * Shadow backtest of the intake sender filter (2026-10). READ-ONLY — never writes.
 *
 * Runs filterDecision() (src/ingestion-email/email-filter.rules.ts) over the last N days of EmailIngestLog
 * metadata with the org's saved allow-list (or ADH's seed when none is saved yet) and prints:
 *   - kept vs would-drop, by reason;
 *   - every would-drop row whose triage verdict was SHIPMENT / UNSURE (= a false drop), as from-domain +
 *     subject (60). Never bodies or full addresses (email content is untrusted data).
 * Purged rows (NOT_SHIPMENT mail) keep only a hashed Message-ID + counterparty, so they are counted apart.
 * "Matched thread" uses today's order links of earlier rows (an approximation of what the live check saw); "thread
 * kept by allowed …" (round L) = an earlier email of the thread was kept by the allow-list.
 *
 *   DATABASE_URL=<prod> npx ts-node --transpile-only -r tsconfig-paths/register scripts/email-filter-backtest.ts --org=<id> [--days=30]
 *   (dev: add --tenancy — reads org_adhjapan through the per-org client)
 */
import 'dotenv/config';
import { ADH_FILTER_ALLOW_DOMAINS, addressOf } from '../src/ingestion-email/email-filter.rules';
import { judgeStoredRows } from '../src/ingestion-email/email-filter.judge';
import { ownDomainsOf } from '../src/ingestion-email/email-triage.service';

const ADH_ORGS = ['056ed6da-42d3-438e-895b-84bb4df47a4c', '222c6494-96ae-42d0-9283-1b5eabf47b42'];
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const org = arg('org') ?? '';
const days = Math.max(1, Math.min(365, Number(arg('days') ?? 30)));
const tenancy = process.argv.includes('--tenancy');
/** --customers=<json>: preview with the addresses setup-adh-org.ts would add (emailFilterAddresses) — never printed. */
const customersPath = arg('customers');

async function main() {
  if (!ADH_ORGS.includes(org)) throw new Error('ADH only: pass --org=<ADH org id>');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const { PrismaClient } = tenancy ? require('../node_modules/.prisma-tenancy/org-adhjapan') : require('@prisma/client');
  const url = process.env.DATABASE_URL ?? '';
  const prisma = new PrismaClient(tenancy ? { datasources: { db: { url: url.includes('schema=') ? url : `${url}${url.includes('?') ? '&' : '?'}schema=org_adhjapan` } } } : undefined);
  try {
    // Before the schema push the allow-list columns don't exist yet → the ADH seed.
    const cfg = await prisma.emailIngestConfig.findFirst({ where: { organizationId: org }, select: { allowDomains: true, allowAddresses: true } }).catch(() => null);
    const settings = await prisma.tradeSetting.findUnique({ where: { organizationId: org }, select: { docDefaults: true } }).catch(() => null);
    const own = ownDomainsOf((settings?.docDefaults as Record<string, unknown> | null) ?? null);
    const extra: string[] = customersPath
      ? // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        ((JSON.parse(require('fs').readFileSync(customersPath, 'utf8')).emailFilterAddresses ?? []) as Array<{ address: string }>).map((x) => x.address.toLowerCase())
      : [];
    const allow = { allowDomains: cfg?.allowDomains?.length ? cfg.allowDomains : ADH_FILTER_ALLOW_DOMAINS, allowAddresses: [...new Set([...(cfg?.allowAddresses ?? []), ...extra])] };
    const since = new Date(Date.now() - days * 86400000);
    const rows = await prisma.emailIngestLog.findMany({
      where: { organizationId: org, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, messageId: true, fromAddress: true, subject: true, verdict: true, inboxState: true, rawMeta: true, threadKey: true, inReplyTo: true, orderId: true, createdAt: true },
    });
    const orders = await prisma.tradeOrder.findMany({ where: { organizationId: org }, select: { id: true, orderNo: true } });
    const orderNo = new Map<string, number>(orders.map((o: { id: string; orderNo: number }) => [o.id, o.orderNo]));

    console.log(
      `allow-list (${cfg?.allowDomains?.length ? 'saved' : 'ADH seed'}): ${allow.allowDomains.join(', ')}${allow.allowAddresses.length ? ` + ${allow.allowAddresses.length} address(es)` : ''}`,
    );
    console.log(`own domains: ${own.join(', ')} · window: last ${days} days · rows: ${rows.length}\n`);

    const reasons = new Map<string, number>();
    let kept = 0;
    let dropped = 0;
    let purged = 0;
    const falseDrops: string[] = [];
    const otherDrops: string[] = [];
    const judged = new Map(judgeStoredRows(rows, allow, own, orderNo).map((j) => [j.id, j]));
    for (const r of rows) {
      const j = judged.get(r.id)!;
      if (j.skipped) {
        purged++;
        continue;
      }
      const d = j;
      const bucket = /^(allowed address|allowed domain|shipment key|thread matched|thread kept by allowed|internal only|not on the allow-list)/.exec(d.reason)?.[1] ?? d.reason;
      reasons.set(`${d.keep ? 'KEEP' : 'DROP'} · ${bucket}`, (reasons.get(`${d.keep ? 'KEEP' : 'DROP'} · ${bucket}`) ?? 0) + 1);
      const line = `${r.createdAt.toISOString().slice(0, 10)} | ${(addressOf(r.fromAddress).split('@')[1] ?? '?').padEnd(22)} | ${(r.subject ?? '').replace(/\s+/g, ' ').slice(0, 60).padEnd(60)} | ${r.verdict ?? '-'}/${r.inboxState ?? '-'} | ${d.reason}`;
      if (d.keep) kept++;
      else {
        dropped++;
        (r.verdict === 'SHIPMENT' || r.verdict === 'UNSURE' || r.orderId ? falseDrops : otherDrops).push(line);
      }
    }
    console.log(`KEPT ${kept} · WOULD DROP ${dropped} · purged/filtered (no metadata, not judged) ${purged}\n`);
    for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
    console.log(`\nFALSE DROPS (would drop, but triage said SHIPMENT/UNSURE or it is matched to an order): ${falseDrops.length}`);
    falseDrops.forEach((l) => console.log(`  ${l}`));
    console.log(`\nOther would-drops: ${otherDrops.length}`);
    otherDrops.forEach((l) => console.log(`  ${l}`));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
