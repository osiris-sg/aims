/**
 * Backfill document IDs (trade-docref.ts) for trade documents stored before
 * they existed: numbers each contract's shipments (1, 2 … by creation), then
 * gives every in-app document and every file without one its ID, oldest first
 * so repeat counters follow upload order. A finalized PDF takes its in-app
 * document's ID. Files linked to no record are left without one.
 * Dry run by default.
 *
 *   TENANCY_MODE=per-org TS_NODE_TRANSPILE_ONLY=1 npx ts-node -r tsconfig-paths/register scripts/backfill-doc-refs.ts [--org=<id>] [--apply]
 *   (prod / public schema: DATABASE_URL=… without TENANCY_MODE; --confirm-prod to apply there)
 */
import 'dotenv/config';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { TradeConfigService } from '../src/shipments/trade-config.service';

const APPLY = process.argv.includes('--apply');
const ORG_ID = process.argv.find((a) => a.startsWith('--org='))?.slice(6) || '222c6494-96ae-42d0-9283-1b5eabf47b42';

export async function backfillDocRefs(prisma: any, config: TradeConfigService, organizationId: string, apply: boolean) {
  const out = { shipmentsNumbered: 0, generated: 0, files: 0, skippedUnlinked: 0, refs: [] as string[] };
  // A dry run must not write: run everything in a transaction and roll it back.
  const run = async (tx: any) => {
    for (const s of await tx.shipment.findMany({ where: { organizationId, seqNo: null }, select: { id: true, contractId: true } })) {
      await config.ensureSeqNo(tx, organizationId, s.contractId, s.id);
      out.shipmentsNumbered++;
    }
    const gens = await tx.tradeGeneratedDoc.findMany({ where: { organizationId, docRef: null }, orderBy: { createdAt: 'asc' }, select: { id: true, docType: true, contractId: true, shipmentId: true, finalFileId: true } });
    for (const g of gens) {
      const ref = await config.docRefFor(tx, organizationId, g.shipmentId ? { shipmentId: g.shipmentId } : { contractId: g.contractId }, g.docType);
      await tx.tradeGeneratedDoc.update({ where: { id: g.id }, data: { docRef: ref } });
      if (g.finalFileId) await tx.tradeFile.updateMany({ where: { id: g.finalFileId, organizationId, docRef: null }, data: { docRef: ref } });
      out.generated++;
      if (ref) out.refs.push(`${ref} (in-app ${g.docType})`);
    }
    const files = await tx.tradeFile.findMany({
      where: { organizationId, docRef: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, docType: true, links: { orderBy: { createdAt: 'asc' }, select: { contractId: true, shipmentId: true } } },
    });
    for (const f of files) {
      const link = f.links.find((l: { shipmentId: string | null }) => l.shipmentId) ?? f.links[0];
      if (!link) {
        out.skippedUnlinked++;
        continue;
      }
      const ref = await config.docRefFor(tx, organizationId, link.shipmentId ? { shipmentId: link.shipmentId } : { contractId: link.contractId }, f.docType);
      await tx.tradeFile.update({ where: { id: f.id }, data: { docRef: ref } });
      out.files++;
      if (ref) out.refs.push(`${ref} (${f.docType})`);
    }
    if (!apply) throw Object.assign(new Error('dry run'), { dryRun: true });
  };
  try {
    await prisma.$transaction(run, { timeout: 120_000 });
  } catch (e) {
    if (!(e as { dryRun?: boolean }).dryRun) throw e;
  }
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const prod = /ep-icy-moon/.test(url);
  if (prod && APPLY && !process.argv.includes('--confirm-prod')) throw new Error('DATABASE_URL is production — add --confirm-prod to apply');
  const prisma = new PrismaService();
  const config = new TradeConfigService(prisma);
  const go = async () => {
    const r = await backfillDocRefs(prisma, config, ORG_ID, APPLY);
    console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${r.shipmentsNumbered} shipment(s) numbered, ${r.generated} in-app document(s), ${r.files} file(s); ${r.skippedUnlinked} unlinked file(s) left`);
    for (const ref of r.refs) console.log('  ', ref);
  };
  if (process.env.TENANCY_MODE === 'per-org') await runAsOrg(ORG_ID, go);
  else await go();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('❌', e?.message ?? e);
      process.exit(1);
    });
}
