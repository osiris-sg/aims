/** READ-ONLY: SHENGYI's full JPSG ledger + how top-ups happen platform-wide. */
import { Client } from 'pg';
import * as fs from 'fs';
const m = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)!;
const SHENGYI = 'd07606d1-2569-45ed-9f09-742b3585c9';
async function main() {
  const c = new Client({ connectionString: m[1].trim() });
  await c.connect();
  const co = await c.query(`SELECT name, credit_balance, allow_overdraft, credit_limit, created_at FROM companies WHERE id LIKE $1 || '%'`, [SHENGYI.slice(0, 20)]);
  console.log('company:', JSON.stringify(co.rows[0]));

  // ledger entry types platform-wide
  const types = await c.query(`SELECT type, count(*)::int AS n, sum(amount)::numeric(14,2) AS total FROM ledger_entries GROUP BY 1 ORDER BY 2 DESC`);
  console.log('\nledger entry types (all companies):');
  for (const r of types.rows) console.log(`  ${r.type}: ${r.n} rows, total ${r.total}`);

  const cid = (await c.query(`SELECT id FROM companies WHERE id LIKE $1 || '%'`, [SHENGYI.slice(0, 20)])).rows[0].id;
  const led = await c.query(`SELECT type, count(*)::int AS n, sum(amount)::numeric(14,2) AS total, min(created_at)::date AS first, max(created_at)::date AS last FROM ledger_entries WHERE company_id = $1 GROUP BY 1`, [cid]);
  console.log('\nSHENGYI ledger summary:');
  for (const r of led.rows) console.log(`  ${r.type}: ${r.n} rows, ${r.total} (${r.first} → ${r.last})`);

  const topups = await c.query(`SELECT type, amount, reference, created_at FROM ledger_entries WHERE company_id = $1 AND type::text ILIKE '%top%' OR company_id = $1 AND type::text ILIKE '%credit%' ORDER BY created_at LIMIT 20`, [cid]);
  console.log('\nSHENGYI credit/topup entries:');
  for (const r of topups.rows) console.log(`  ${String(r.created_at).slice(0, 10)} ${r.type} ${r.amount} ref=${(r.reference || '').slice(0, 60)}`);

  const pis = await c.query(`SELECT airwallex_intent_id, amount, status, created_at FROM payment_intents WHERE company_id = $1 ORDER BY created_at`, [cid]);
  console.log(`\nSHENGYI payment_intents (Airwallex): ${pis.rows.length}`);
  for (const r of pis.rows) console.log(`  ${String(r.created_at).slice(0, 16)} $${r.amount} ${r.status} ${r.airwallex_intent_id || ''}`);
  await c.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
