/** Build the topup→customer mapping by joining the Airwallex report's payment
 *  intent ids against JPSG's payment_intents + companies. READ-ONLY on JPSG. */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
const SP = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad';
const m = fs.readFileSync('.env', 'utf8').match(/^JPSG_DATABASE=\s*(.+)$/m)!;
async function main() {
  const c = new Client({ connectionString: m[1].trim() });
  await c.connect();
  const intents = await c.query(`
    SELECT pi.airwallex_intent_id, pi.company_id, co.name, pi.amount, pi.status
    FROM payment_intents pi JOIN companies co ON co.id = pi.company_id`);
  console.log(`JPSG payment_intents: ${intents.rows.length}`);
  const byIntent = new Map(intents.rows.map((r: any) => [r.airwallex_intent_id, r.name]));
  await c.end();

  // Airwallex xlsx → parsed txns don't carry intent id; re-read raw json? The
  // parse dropped it — re-derive from the xlsx via the saved rows if present.
  // airwallex-txns.json lacks intentId, so rebuild from xlsx quickly in py was
  // done earlier; here read the original file again through a helper json if
  // available, else fall back to matching by base topup id via ORDER ids in
  // payment_intents? JPSG's payment_intents.id is the topup uuid itself!
  // orderId = topup_<payment_intents.id>_<ts>. Verify:
  const txns: any[] = JSON.parse(fs.readFileSync(`${SP}/airwallex-txns.json`, 'utf8'));
  const c2 = new Client({ connectionString: m[1].trim() });
  await c2.connect();
  const ids = [...new Set(txns.map(t => (t.baseTopupId || '').replace(/^topup_/, '')).filter(Boolean))];
  const found = await c2.query(`SELECT pi.id, co.name FROM payment_intents pi JOIN companies co ON co.id = pi.company_id WHERE pi.id = ANY($1)`, [ids]);
  console.log(`matched by payment_intents.id: ${found.rows.length}/${ids.length}`);
  const nameById = new Map(found.rows.map((r: any) => [r.id, r.name]));
  await c2.end();

  const mappingPath = path.resolve('scripts/airwallex-topup-mapping.json');
  const mapping: Record<string, any> = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  let filled = 0, still = 0;
  for (const bid of Object.keys(mapping)) {
    const uuid = bid.replace(/^topup_/, '');
    const name = nameById.get(uuid);
    if (name) { mapping[bid].customerName = name; filled++; }
    else if (mapping[bid].customerName === 'TODO') still++;
  }
  fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 1));
  console.log(`mapping: filled=${filled} still-TODO=${still}`);
  for (const [bid, v] of Object.entries(mapping)) console.log(`  ${bid.slice(0, 22)}… → ${(v as any).customerName} ($${(v as any).fundedTotal})`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
