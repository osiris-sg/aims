/**
 * Renumber ONE AIMS draft invoice on an imported order (Elroy 19 Nov 2026, ORD-Q-014154: the draft made by the
 * first Create invoice button, INV202611-0024, becomes I-014521-02, the number the new dialog prefills). Only a
 * draft / unconfirmed, not ERP-imported invoice with no journal; the new number must be unused in the org. Renames
 * Document.name + config.documentNumber (+ documentInfo.documentNumber when set) and the order's link entry. The
 * INV counter is not touched. One ActionLog row, log file. DRY RUN BY DEFAULT.
 *   node scripts/wct-renumber-draft-invoice.js --env prod --from INV202611-0024 --to I-014521-02 --order ORD-Q-014154 [--apply --confirm-prod]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const a = process.argv.slice(2);
const one = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
const ENV = one('--env') || 'dev';
const FROM = one('--from'), TO = one('--to'), ORDER = one('--order');
const APPLY = a.includes('--apply');
const WCT_GROUP = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000004'];
(async () => {
  if (!FROM || !TO || !ORDER) throw new Error('--from --to --order');
  if (APPLY && ENV === 'prod' && !a.includes('--confirm-prod')) throw new Error('--confirm-prod');
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_./]{0,39}$/.test(TO)) throw new Error(`bad number ${TO}`);
  const c = new Client({ connectionString: ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    if (!APPLY) await c.query('SET TRANSACTION READ ONLY');
    const o = (await c.query(`select id, "organizationId"::text org, "linkedDocuments" ld from "Order" where "orderNumber" = $1 and "organizationId"::text = any($2::text[])${APPLY ? ' for update' : ''}`, [ORDER, WCT_GROUP])).rows;
    if (o.length !== 1) throw new Error(`order ${ORDER}: ${o.length} rows`);
    const ord = o[0];
    const d = (await c.query(`select id, name, status::text status, config from "Document" where "organizationId"::text = $1 and type = 'INVOICE' and name = $2${APPLY ? ' for update' : ''}`, [ord.org, FROM])).rows;
    if (d.length !== 1) throw new Error(`${FROM}: ${d.length} rows`);
    const doc = d[0];
    if (!['draft', 'unconfirmed'].includes(doc.status)) throw new Error(`${FROM} is ${doc.status}, not a draft`);
    if (doc.config?.erpImport) throw new Error(`${FROM} is ERP-imported`);
    if (!(ord.ld?.invoice || []).some((x) => x.id === doc.id)) throw new Error(`${FROM} is not linked to ${ORDER}`);
    const j = (await c.query(`select count(*)::int n from "JournalEntry" where "sourceDocumentId" = $1`, [doc.id])).rows[0].n;
    if (j) throw new Error(`${FROM} has ${j} journal(s)`);
    const used = (await c.query(`select name from "Document" where "organizationId"::text = $1 and type = 'INVOICE' and lower(name) = lower($2)`, [ord.org, TO])).rows;
    if (used.length) throw new Error(`${TO} is already used`);
    const cfg = { ...doc.config, documentNumber: TO };
    if (cfg.documentInfo && typeof cfg.documentInfo === 'object' && cfg.documentInfo.documentNumber) cfg.documentInfo = { ...cfg.documentInfo, documentNumber: TO };
    const ld = { ...ord.ld, invoice: ord.ld.invoice.map((x) => (x.id === doc.id ? { ...x, name: TO } : x)) };
    console.log(`${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'}: ${ORDER} draft invoice ${FROM} (${doc.status}, total ${doc.config?.totalWithTax ?? doc.config?.nettTotal}) -> ${TO}; journals 0; INV counter untouched`);
    if (!APPLY) { await c.query('ROLLBACK'); return; }
    await c.query(`update "Document" set name = $2, config = $3, "updatedAt" = now() where id = $1`, [doc.id, TO, cfg]);
    await c.query(`update "Order" set "linkedDocuments" = $2, "updatedAt" = now() where id = $1`, [ord.id, ld]);
    await c.query(
      `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-renumber-draft-invoice', 'System creation', $1, 'operator', 'UPDATE', 'document', $2, $3, 'SUCCESS')`,
      [ord.org, doc.id, JSON.stringify({ note: `Draft invoice ${FROM} renumbered ${TO} on ${ORDER} (Elroy 19 Nov); INV counter untouched` })],
    );
    await c.query('COMMIT');
    const f = path.join(process.env.HOME || '', `Desktop/aims/_imports/wct/logs/wct-renumber-draft-invoice.${FROM}.${ENV}.log.json`);
    fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), order: ORDER, documentId: doc.id, before: { name: FROM, documentNumber: doc.config?.documentNumber ?? null }, after: { name: TO } }, null, 1));
    console.log(`applied · log ${f}`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
