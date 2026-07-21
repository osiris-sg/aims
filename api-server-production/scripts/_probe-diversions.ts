import { Client } from 'pg';
import * as fs from 'fs';
const m = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)!;
async function main() {
  const c = new Client({ connectionString: m[1].trim() });
  await c.connect();
  const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='transactions' AND column_name ILIKE '%divert%'`)).rows;
  console.log('diversion columns:', cols.map((r: any) => r.column_name).join(', '));
  const smm = '0e2ef863-25a4-46b0-adf8-0d4be869ea23';
  const div = (await c.query(`
    SELECT t.diverted_to_company_id, co.name AS to_name, count(*)::int AS n, sum(t.total_charge)::float AS total
    FROM transactions t LEFT JOIN companies co ON co.id = t.diverted_to_company_id
    WHERE t.company_id = $1 AND t.diverted_to_company_id IS NOT NULL
    GROUP BY 1, 2`, [smm])).rows;
  console.log('SMM transactions diverted away:', JSON.stringify(div, null, 1));
  const gap = (await c.query(`
    SELECT coalesce(sum(t.total_charge),0)::float AS diverted_total
    FROM transactions t WHERE t.company_id = $1 AND t.diverted_to_company_id IS NOT NULL`, [smm])).rows[0];
  console.log('total diverted-away charge value:', gap.diverted_total, '(ledger-vs-balance gap was 3,047.82)');
  // does the ledger contain divert refunds? check the other 3 companies too
  for (const [name, id] of [['Chuan Lim','1d001809-c914-4f4c-8a60-6579b162d7'],['GS Perfect','c3cc362e-3713-48e3-bfe4-5a8ffdf2fa']] as const) {
    const r = (await c.query(`SELECT count(*)::int AS n, coalesce(sum(total_charge),0)::float AS tot FROM transactions WHERE company_id LIKE $1 || '%' AND diverted_to_company_id IS NOT NULL`, [id.slice(0, 20)])).rows[0];
    console.log(`${name}: diverted-away n=${r.n} total=${r.tot}`);
  }
  await c.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
