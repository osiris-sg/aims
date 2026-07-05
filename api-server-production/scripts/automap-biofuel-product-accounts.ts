import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const STOP = new Set(['sales','rental','rent','supply','disposal','of','the','and','for','with','our','one','set','unit','units','system','systems','complete','model','capacity','dated','no','sn','s','each','other','sale','income','revenue']);
const toks = (s: string) => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ').filter(w => w.length >= 3 && !STOP.has(w));
function score(aTok: string[], accTok: string[]) { const set = new Set(aTok); let n = 0; for (const t of accTok) if (set.has(t)) n++; return n; }

async function main() {
  const accts = await p.chartOfAccount.findMany({ where: { organizationId: ORG, accountType: { in: ['SALES','INCOME'] }, isActive: true }, select: { code: true, name: true } });
  const rentalAccts = accts.filter(a => /rental|rent /i.test(a.name)).map(a => ({ ...a, tok: toks(a.name) }));
  const salesAccts  = accts.filter(a => !/rental|rent /i.test(a.name)).map(a => ({ ...a, tok: toks(a.name) }));

  const assets = await p.asset.findMany({ where: { organizationId: ORG }, select: { id: true, name: true } });
  let setRental = 0, setSales = 0, both = 0, none = 0;
  const samples: string[] = [];
  for (const a of assets) {
    const at = toks(a.name);
    const bestR = rentalAccts.map(x => ({ x, s: score(at, x.tok) })).sort((m,n) => n.s - m.s)[0];
    const bestS = salesAccts.map(x => ({ x, s: score(at, x.tok) })).sort((m,n) => n.s - m.s)[0];
    const rentalCode = bestR && bestR.s >= 1 ? bestR.x.code : null;
    const salesCode  = bestS && bestS.s >= 1 ? bestS.x.code : null;
    if (!rentalCode && !salesCode) { none++; continue; }
    await p.asset.update({ where: { id: a.id }, data: { rentalAccountCode: rentalCode, salesAccountCode: salesCode } });
    if (rentalCode) setRental++; if (salesCode) setSales++; if (rentalCode && salesCode) both++;
    if (samples.length < 12) samples.push(`  "${a.name.slice(0,34).padEnd(36)}" → rent:${rentalCode||'-'} sale:${salesCode||'-'}`);
  }
  console.log(`Assets: ${assets.length}`);
  console.log(`Mapped rental: ${setRental}, sales: ${setSales}, both: ${both}, unmapped: ${none}`);
  console.log('Samples:'); samples.forEach(s => console.log(s));
}
main().catch(e => console.log('ERR', e.message)).finally(() => p.$disconnect());
