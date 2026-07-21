/** READ-ONLY: explore the JPSG database schema for topup/customer data. */
import { Client } from 'pg';
import * as fs from 'fs';
const m = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)!;
const url = m[1].trim();
async function main() {
  const c = new Client({ connectionString: url });
  await c.connect();
  const tables = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
  console.log('tables:', tables.rows.map(r => r.table_name).join(', '));
  for (const t of tables.rows.map(r => r.table_name)) {
    const cols = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
    const cnt = await c.query(`SELECT count(*)::int AS n FROM "${t}"`);
    console.log(`\n${t} (${cnt.rows[0].n} rows): ${cols.rows.map(r => `${r.column_name}:${r.data_type.slice(0,12)}`).join(', ').slice(0, 500)}`);
  }
  await c.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
