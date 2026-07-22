/** READ-ONLY: compare template + config shape of $0 drafts vs confirmed JPSG invoices. */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const p = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
async function main() {
  const invs = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'BIPL-JPSG' } },
    select: { name: true, status: true, documentTemplateId: true, config: true },
  });
  // group by templateId with value stats
  const byTmpl = new Map<string, { n: number; zero: number; statuses: Map<string, number> }>();
  for (const i of invs) {
    const c: any = i.config || {};
    const amt = Number(c.nettTotal ?? c.xeroGross ?? c.summary?.grandTotal ?? 0);
    const e = byTmpl.get(i.documentTemplateId) || { n: 0, zero: 0, statuses: new Map() };
    e.n++; if (amt < 0.005) e.zero++;
    e.statuses.set(String(i.status), (e.statuses.get(String(i.status)) || 0) + 1);
    byTmpl.set(i.documentTemplateId, e);
  }
  for (const [tid, e] of byTmpl) {
    const t = await p.documentTemplate.findUnique({ where: { id: tid }, select: { name: true, type: true, templateVariant: true, organizationId: true } });
    console.log(`template ${tid.slice(0, 8)} "${t?.name}" (${t?.type}/${t?.templateVariant}) ownerOrg=${t?.organizationId?.slice(0, 8)}: n=${e.n} zero-value=${e.zero} statuses=${JSON.stringify([...e.statuses])}`);
  }
  // shape comparison: one zero draft vs one confirmed
  const zero = invs.find(i => Number((i.config as any)?.nettTotal ?? 0) < 0.005 && String(i.status) === 'draft' && (i.config as any)?.items?.length);
  const conf = invs.find(i => String(i.status) === 'confirmed');
  const shape = (c: any) => ({ keys: Object.keys(c || {}).sort().slice(0, 30).join(','), items: (c?.items || []).length, item0: c?.items?.[0] ? Object.keys(c.items[0]).sort().join(',') : null, nettTotal: c?.nettTotal, summary: c?.summary ? Object.keys(c.summary).join(',') : null });
  console.log('\nZERO-DRAFT sample', zero?.name, JSON.stringify(shape(zero?.config), null, 1));
  console.log('\nCONFIRMED sample', conf?.name, JSON.stringify(shape(conf?.config), null, 1));
  // does the zero draft have items with amounts?
  const zc: any = zero?.config || {};
  for (const it of (zc.items || []).slice(0, 4)) console.log('  zero-draft item:', JSON.stringify(it).slice(0, 200));
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => p.$disconnect());
