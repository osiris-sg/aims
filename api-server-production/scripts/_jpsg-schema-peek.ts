import { Pool } from "pg";
import * as fs from "fs";
const url = fs.readFileSync(".env", "utf8").match(/^JPSG_DATABASE=\s*"?([^"\n]+)"?/m)?.[1]?.trim();
const pool = new Pool({ connectionString: url });
(async () => {
  const cols = await pool.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('companies','ledger_entries','transactions','payment_intents') ORDER BY table_name, ordinal_position`);
  const by: any = {};
  cols.rows.forEach(r => (by[r.table_name] = [...(by[r.table_name] || []), r.column_name]));
  for (const [t, c] of Object.entries(by)) console.log(t + ":", (c as string[]).join(", "));
  await pool.end();
})();
