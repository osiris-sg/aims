import { Client } from 'pg';
import * as fs from 'fs';
const m = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)!;
async function main() {
  const c = new Client({ connectionString: m[1].trim() });
  await c.connect();
  // company types
  const types = await c.query(`SELECT company_type::text, count(*)::int FROM companies GROUP BY 1`);
  console.log('company types:', JSON.stringify(types.rows));
  // the zero-balance-but-charged companies
  const probe = await c.query(`
    SELECT co.name, co.company_type::text AS ctype, co.credit_balance::float AS bal,
      (SELECT count(*)::int FROM consolidated_invoices ci WHERE ci.company_id = co.id) AS consol_invoices,
      (SELECT coalesce(sum(le.amount),0)::float FROM ledger_entries le WHERE le.company_id = co.id) AS ledger_sum,
      (SELECT coalesce(sum(le.red_deducted),0)::float + coalesce(sum(le.green_deducted),0)::float FROM ledger_entries le WHERE le.company_id = co.id) AS pool_deducted
    FROM companies co WHERE co.name IN ('CCDC (Telok Blangah)','CSCEC (Bulim Infra 1)','SMM Engineering & Services Pte Ltd ','GS PERFECT ENGINEERING PTE LTD','Chuan Lim Construction Pte Ltd','Osiris Technologies Pte Ltd','CR101')`);
  for (const r of probe.rows) console.log(JSON.stringify(r));
  // red/green usage overall
  const rg = await c.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE coalesce(red_deducted,0) <> 0 OR coalesce(green_deducted,0) <> 0 OR coalesce(green_refunded,0) <> 0 OR coalesce(red_refunded,0) <> 0`);
  console.log('ledger rows using red/green pools:', rg.rows[0].n);
  await c.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
