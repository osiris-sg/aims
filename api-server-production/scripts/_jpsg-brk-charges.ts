import { Pool } from "pg";
import * as fs from "fs";
const url = fs.readFileSync(".env", "utf8").match(/^JPSG_DATABASE=\s*"?([^"\n]+)"?/m)?.[1]?.trim();
const pool = new Pool({ connectionString: url });
(async () => {
  const comp = await pool.query(`SELECT id, name, credit_balance FROM companies WHERE name ILIKE '%BRK%'`);
  console.log("company:", comp.rows);
  const id = comp.rows[0]?.id;
  const led = await pool.query(
    `SELECT type, amount, description, created_at::date FROM ledger_entries WHERE company_id = $1 ORDER BY created_at`,
    [id],
  );
  led.rows.forEach(r => console.log(`${String(r.created_at.toISOString().slice(0,10))} ${r.type.padEnd(10)} $${String(r.amount).padStart(8)} ${(r.description || "").slice(0, 90)}`));
  await pool.end();
})();
