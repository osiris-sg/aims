/**
 * Round BO part 0.1 — the two SUS drafts of 2026-10-20 (9671f7bd Invoice #1, 8f69acab Invoice #2) still print DBS:
 * switch their header bank to CFSB (owner's go 2026-11-10). DRAFTS only (a FINAL is refused). Logged old → new.
 * Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node -r tsconfig-paths/register --transpile-only scripts/_bo-drafts-bank.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const DOCS = ['9671f7bd', '8f69acab'];
const TO = 'cfsb';
const mask = (s: unknown) => String(s ?? '').replace(/\d{5,}/g, (d) => '…' + d.slice(-4));
const acctOf = (block: string | null | undefined) => mask(/Account No:?\s*(\S+)/.exec(block ?? '')?.[1] ?? '?');

async function main() {
  const apply = process.argv.includes('--apply');
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const ts: any = await p.tradeSetting.findUnique({ where: { organizationId: ADH }, select: { docDefaults: true } });
  const bank = (ts?.docDefaults?.banks ?? []).find((b: any) => b.id === TO);
  if (!bank) throw new Error('No CFSB account in Settings');
  for (const prefix of DOCS) {
    const rows: any[] = await p.$queryRawUnsafe(`select id, "docType", status, header from "TradeGeneratedDoc" where "organizationId"=$1 and id::text like $2`, ADH, `${prefix}%`);
    if (rows.length !== 1) throw new Error(`${prefix}: ${rows.length} documents match`);
    const g = rows[0];
    const h = g.header ?? {};
    const line = `${prefix} ${g.docType} ${g.status}: ${h.bankId ?? '(none)'} ${(h.bankBlock ?? '').split('\n')[0]} ${acctOf(h.bankBlock)} → ${bank.id} ${bank.label} ${acctOf(bank.block)}`;
    if (g.status !== 'DRAFT') {
      console.log(`SKIP (not a draft) ${line}`);
      continue;
    }
    if (h.bankId === TO && h.bankBlock === bank.block) {
      console.log(`already CFSB ${prefix}`);
      continue;
    }
    console.log(`${apply ? 'write' : 'would write'} ${line}`);
    if (!apply) continue;
    await p.$transaction([
      p.tradeGeneratedDoc.update({ where: { id: g.id }, data: { header: { ...h, bankId: bank.id, bankBlock: bank.block } } }),
      p.actionLog.create({
        data: {
          actorType: 'SYSTEM', actorId: 'system:round-bo-drafts-bank', actorName: 'System creation', organizationId: ADH, channel: 'script',
          action: 'UPDATE', resource: 'TradeGeneratedDoc', resourceId: g.id,
          details: { script: 'scripts/_bo-drafts-bank.ts', go: 'owner 2026-11-10 (round BO part 0.1)', docType: g.docType, bank: { from: `${h.bankId ?? null} ${acctOf(h.bankBlock)}`, to: `${bank.id} ${acctOf(bank.block)}` } } as any,
        },
      }),
    ]);
  }
  console.log(apply ? 'done' : 'DRY RUN — nothing written');
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 300));
  process.exit(1);
});
