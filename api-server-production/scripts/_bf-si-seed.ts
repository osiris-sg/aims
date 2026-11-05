/**
 * Round BF — seed the 出庫・納入依頼書 wording of Kato's 6063 HSB 152×5800 billet (Clients › Products):
 *   ハイスピード / (High speed) / ビレット / (billet) / 152×5800
 * Empty fields only (a typed wording is never overwritten); every write is logged to ActionLog (System).
 *
 *   DRY RUN (default): DBURL=<url> TENANCY_MODE= npx ts-node --transpile-only scripts/_bf-si-seed.ts [--org=<id>]
 *   APPLY:             … scripts/_bf-si-seed.ts --apply
 */
import { PrismaClient } from '@prisma/client';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const APPLY = process.argv.includes('--apply');
const ORG = arg('org') ?? ADH;
const SEED = { docNameJa: 'ハイスピード\nビレット', docNameEn: 'High speed\nbillet', docSize: '152×5800' } as const;

async function main() {
  const url = process.env.DBURL;
  if (!url) throw new Error('DBURL is required');
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = await p.organization.findFirst({ where: { id: ORG }, select: { id: true, name: true } });
    if (!org) throw new Error(`Organization ${ORG} not found`);
    const kato = await p.customer.findFirst({ where: { organizationId: ORG, name: { startsWith: 'Kato Light Metal' } }, select: { id: true, name: true } });
    if (!kato) throw new Error('Kato not found');
    const ts = await p.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { id: true, customerProfiles: true } });
    const profiles = (ts?.customerProfiles ?? {}) as Record<string, any>;
    const cp = profiles[kato.id];
    const products: any[] = cp?.products ?? [];
    const hsb = products.filter((x) => !x.hidden && String(x.grade ?? '').startsWith('6063') && x.form === 'BILLET' && x.diameterMm === 152 && x.lengthMm === 5800);
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} · ${org.name} · ${kato.name}`);
    if (hsb.length !== 1) {
      console.log(`  expected exactly one 6063 billet 152 × 5800 product, found ${hsb.length} — nothing to do`);
      return;
    }
    const prod = hsb[0];
    const fill = Object.fromEntries(Object.entries(SEED).filter(([k]) => !String(prod[k] ?? '').trim()));
    console.log(`  product ${prod.id} (${prod.grade} billet ${prod.diameterMm} × ${prod.lengthMm}${prod.notes ? `, notes "${prod.notes}"` : ''})`);
    for (const k of Object.keys(SEED)) console.log(`  ${k}: ${JSON.stringify(prod[k] ?? null)} → ${k in fill ? JSON.stringify((SEED as any)[k]) : '(kept, already set)'}`);
    console.log(`  prints as: ${[...SEED.docNameJa.split('\n').flatMap((j, i) => [j, `(${SEED.docNameEn.split('\n')[i]})`]), SEED.docSize].join(' / ')}`);
    const others = Object.keys(profiles).filter((id) => id !== kato.id).length;
    console.log(`  other customer profiles untouched: ${others}`);
    if (!Object.keys(fill).length) return console.log('  nothing to fill');
    if (!APPLY) return console.log('  (dry run — nothing written; add --apply after the owner\'s go)');
    const now = new Date().toISOString();
    await p.$transaction(async (tx) => {
      const fresh = await tx.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { customerProfiles: true } });
      const all = (fresh?.customerProfiles ?? {}) as Record<string, any>;
      const list: any[] = all[kato.id]?.products ?? [];
      const i = list.findIndex((x) => x.id === prod.id);
      if (i < 0) throw new Error('product disappeared');
      const cur = list[i];
      const patch = Object.fromEntries(Object.entries(SEED).filter(([k]) => !String(cur[k] ?? '').trim()));
      list[i] = { ...cur, ...patch, updatedAt: now };
      await tx.tradeSetting.update({ where: { organizationId: ORG }, data: { customerProfiles: { ...all, [kato.id]: { ...all[kato.id], products: list } } as any } });
      await tx.actionLog.create({
        data: {
          actorType: 'SYSTEM',
          actorId: 'system:bf-si-seed',
          actorName: 'System creation',
          organizationId: ORG,
          channel: 'cron',
          action: 'UPDATE',
          resource: 'trade-clients',
          resourceId: kato.id,
          details: { note: 'Round BF: 出庫・納入依頼書 wording of Kato 6063 HSB 152×5800 (empty fields only)', productId: prod.id, filled: patch },
        },
      });
    });
    console.log('  applied + logged');
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
