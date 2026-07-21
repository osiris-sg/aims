/** Forensic: replay SMM's ledger vs JPSG balance; inspect red/green pools and
 *  activity log for non-ledger balance mutations. READ-ONLY. */
import { Client } from 'pg';
import * as fs from 'fs';
const m = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)!;
async function main() {
  const c = new Client({ connectionString: m[1].trim() });
  await c.connect();
  const co = (await c.query(`SELECT id, name, credit_balance::float AS bal FROM companies WHERE name ILIKE 'SMM%'`)).rows[0];
  console.log(`SMM id=${co.id} balance=${co.bal}`);
  const led = (await c.query(`
    SELECT type::text, amount::float, reference, created_at::date AS d,
           coalesce(red_deducted,0)::float AS rd, coalesce(green_deducted,0)::float AS gd,
           coalesce(red_refunded,0)::float AS rr, coalesce(green_refunded,0)::float AS gr
    FROM ledger_entries WHERE company_id=$1 ORDER BY created_at`, [co.id])).rows;
  let run = 0;
  console.log(`ledger rows: ${led.rows?.length ?? led.length}`);
  const byType: Record<string, { n: number; amt: number; rd: number; gd: number; rr: number; gr: number }> = {};
  for (const r of led) {
    run += r.amount;
    const t = byType[r.type] ||= { n: 0, amt: 0, rd: 0, gd: 0, rr: 0, gr: 0 };
    t.n++; t.amt += r.amount; t.rd += r.rd; t.gd += r.gd; t.rr += r.rr; t.gr += r.gr;
  }
  console.log('by type:', JSON.stringify(byType, null, 1));
  console.log(`ledger running sum = ${run.toFixed(2)}  vs balance ${co.bal}  gap=${(co.bal - run).toFixed(2)}`);
  // pool identity: deductions - refunds should relate amount?
  // activity log — balance edits outside ledger?
  const act = (await c.query(`
    SELECT activity_type, title, amount::float, description, created_at::date AS d, performed_by_name
    FROM company_activity_log WHERE company_id=$1 AND (activity_type ILIKE '%balance%' OR activity_type ILIKE '%credit%' OR activity_type ILIKE '%adjust%' OR title ILIKE '%balance%' OR title ILIKE '%credit%')
    ORDER BY created_at`, [co.id])).rows;
  console.log(`\nactivity log (credit/balance related): ${act.length}`);
  for (const a of act.slice(0, 30)) console.log(`  ${a.d} ${a.activity_type} "${a.title}" $${a.amount ?? ''} by ${a.performed_by_name || '?'} — ${(a.description || '').slice(0, 80)}`);
  // distinct activity types overall for reference
  const at = (await c.query(`SELECT activity_type, count(*)::int FROM company_activity_log WHERE company_id=$1 GROUP BY 1`, [co.id])).rows;
  console.log('\nall activity types for SMM:', JSON.stringify(at));
  await c.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
