/**
 * Credit notes already consumed by Manual Offsets / receipts but still stamped (or never stamped) as owed in full
 * (all orgs, 2026-11-24). Before the fix in payments.service.ts (updateInvoiceStatusAfterPayment now re-stamps a
 * credit note through document-money.ts creditNoteMoneyAfterApplied) an offset never touched the credit note's own
 * money keys, so owedOf() read it as owed in full. This re-stamps outstanding / paid / gross from its Payment rows.
 *
 * Dry run by default (read only). Writes only the money keys (stampDocumentMoney) and one "System creation" Activity
 * Log row per credit note. Xero-imported credit notes are listed separately and need --include-xero.
 *
 *   npx ts-node --transpile-only scripts/cn-offset-restamp.ts
 *   npx ts-node --transpile-only scripts/cn-offset-restamp.ts --apply --confirm-prod [--include-xero]
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { grossOf, owedOf, stampDocumentMoney } from '../src/common/document-money';

const apply = process.argv.includes('--apply');
const confirmProd = process.argv.includes('--confirm-prod');
const includeXero = process.argv.includes('--include-xero');
const SCRIPT = 'system:cn-offset-restamp';

(async () => {
  const url = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('PROD_DATABASE_URL is not set in .env');
  if (apply && !confirmProd) throw new Error('Writing on prod needs --apply --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  let done = false;
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const rows = (
      await c.query(
        `with p as (select "documentId", sum(amount)::float8 applied from "Payment" group by 1)
         select d.id, d.name, d."organizationId" org, o.name "orgName", d.config, p.applied
         from "Document" d join p on p."documentId" = d.id join "Organization" o on o.id = d."organizationId"
         where d.type in ('CREDIT_NOTE','CN') order by o.name, d.name`,
      )
    ).rows;
    const plan: Array<{ id: string; name: string; org: string; orgName: string; xero: boolean; before: number; after: number; next: any }> = [];
    for (const r of rows) {
      const cfg = r.config || {};
      if (cfg.erpImport || cfg.voided) continue;
      const gross = Math.abs(grossOf(cfg) ?? 0);
      if (!(gross > 0)) continue;
      const used = Math.round(Number(r.applied) * 100) / 100;
      const after = Math.max(0, Math.round((gross - used) * 100) / 100);
      const before = owedOf(cfg);
      if (Math.abs(before - after) < 0.005 && cfg.outstandingBalance !== undefined) continue;
      plan.push({ id: r.id, name: r.name, org: r.org, orgName: r.orgName, xero: !!cfg.xeroImported, before, after, next: stampDocumentMoney(cfg, { gross, outstanding: after, paid: used }) });
    }
    console.log(`Credit notes consumed by offsets / receipts but read as owed: ${plan.length} (${apply ? 'APPLY' : 'DRY RUN'})`);
    for (const p of plan) console.log(`  ${p.orgName}  ${p.name}  owed ${p.before.toFixed(2)} -> ${p.after.toFixed(2)}${p.xero ? '  (Xero-imported: only with --include-xero)' : ''}`);
    if (!apply) {
      await c.query('ROLLBACK');
      console.log('Dry run: nothing written. --apply --confirm-prod to write.');
      return;
    }
    const now = new Date();
    for (const p of plan) {
      if (p.xero && !includeXero) continue;
      await c.query(`update "Document" set config = $2 where id = $1`, [p.id, JSON.stringify(p.next)]);
      await c.query(
        `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
         values ($1, 'SYSTEM', $2, 'System creation', $3, 'script', 'UPDATE', 'documents', $4, $5, 'SUCCESS', $6)`,
        [randomUUID(), SCRIPT, p.org, p.id, JSON.stringify({ note: `${p.name}: owed ${p.before.toFixed(2)} -> ${p.after.toFixed(2)} (offsets applied)` }), now],
      );
    }
    await c.query('COMMIT');
    done = true;
    console.log('Committed.');
  } catch (e) {
    if (!done) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
