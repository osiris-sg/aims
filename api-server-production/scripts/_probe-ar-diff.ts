import { getXeroTokens, xeroGet, createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
const R = (n: number) => Math.round(n * 100) / 100;
type Row = { num: string; id: string; status: string; due: number; date?: string };
async function pull(tokens: any, summaryOnly: boolean): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  for (let page = 1; ; page++) {
    const q: any = { where: 'Type=="ACCREC"', page };
    if (summaryOnly) q.summaryOnly = 'true';
    const res = await xeroGet<any>(tokens, '/Invoices', q);
    const invs: any[] = res.Invoices || [];
    if (!invs.length) break;
    for (const i of invs) out.set(i.InvoiceID, { num: (i.InvoiceNumber || '').trim(), id: i.InvoiceID, status: i.Status, due: Number(i.AmountDue) || 0, date: i.DateString });
    if (invs.length < 100) break;
  }
  return out;
}
async function main() {
  const tokens = await getXeroTokens(prisma, BIOFUEL_ORG_ID);
  const summary = await pull(tokens, true);
  const full = await pull(tokens, false);
  console.log(`summaryOnly=${summary.size} rows, full=${full.size} rows`);
  const sum = (m: Map<string, Row>) => { let t = 0, n = 0; for (const r of m.values()) { if (['VOIDED','DELETED'].includes(r.status)) continue; if (r.due > 0.005) { t += r.due; n++; } } return { t: R(t), n }; };
  console.log('summaryOnly open:', sum(summary), ' full open:', sum(full));
  for (const [id, f] of full) {
    const s = summary.get(id);
    if (!s) { console.log(`only in FULL: ${f.num} ${f.status} due=${f.due}`); continue; }
    if (R(s.due) !== R(f.due) || s.status !== f.status) console.log(`DIFFERS: ${f.num} full{${f.status},${f.due}} summary{${s.status},${s.due}}`);
  }
  for (const [id, s] of summary) if (!full.has(id)) console.log(`only in SUMMARY: ${s.num} ${s.status} due=${s.due}`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
