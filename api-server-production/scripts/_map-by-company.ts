import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
const m = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)!;
async function main() {
  const c = new Client({ connectionString: m[1].trim() });
  await c.connect();
  const mappingPath = path.resolve('scripts/airwallex-topup-mapping.json');
  const mapping: Record<string, any> = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  const uuids = Object.keys(mapping).map(b => b.replace(/^topup_/, ''));
  const rows = await c.query(`SELECT id, name, credit_balance FROM companies WHERE id = ANY($1)`, [uuids]);
  console.log(`matched as company ids: ${rows.rows.length}/${uuids.length}`);
  const byId = new Map(rows.rows.map((r: any) => [r.id, r]));
  let filled = 0;
  for (const bid of Object.keys(mapping)) {
    const hit = byId.get(bid.replace(/^topup_/, ''));
    if (hit) { mapping[bid].customerName = hit.name; mapping[bid].jpsgCompanyId = hit.id; mapping[bid].jpsgCreditBalance = Number(hit.credit_balance); filled++; }
  }
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 1));
  console.log(`filled=${filled}`);
  for (const [bid, v] of Object.entries(mapping)) console.log(`  ${bid.slice(6, 20)}… → ${(v as any).customerName.padEnd(40)} funded=$${(v as any).fundedTotal}  jpsgBal=$${(v as any).jpsgCreditBalance ?? '?'}`);
  await c.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
