import { Pool } from "pg";
import * as fs from "fs";
const url = fs.readFileSync(".env", "utf8").match(/^JPSG_DATABASE=\s*"?([^"\n]+)"?/m)?.[1]?.trim();
const pool = new Pool({ connectionString: url });
(async () => {
  const tabs = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
  console.log("tables:", tabs.rows.map(r => r.table_name).join(", "));
  const comp = await pool.query(`SELECT id, name, credit_balance FROM companies WHERE name ILIKE '%BRK%'`);
  console.log("company:", JSON.stringify(comp.rows));
  const id = comp.rows[0]?.id;
  const led = await pool.query(
    `SELECT type, amount, reference, invoice_id, created_at::date AS d FROM ledger_entries WHERE company_id = $1 ORDER BY created_at LIMIT 40`,
    [id],
  );
  led.rows.forEach(r => console.log(`${r.d.toISOString().slice(0,10)} ${String(r.type).padEnd(10)} $${String(r.amount).padStart(8)} ref=${(r.reference || "").slice(0, 60)} inv=${r.invoice_id || ""}`));
  await pool.end();
})();
