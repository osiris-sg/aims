/**
 * ABSS supplier cards + opening AP bills for the WCT group (Elroy 19 Nov).
 *
 * Source: the org's ABSS "Card List [Summary]" (13 Nov 2026, parsed from the PDF into
 * _imports/wct/abss/ap/cardlist-<org>-2026-11-13.json: [{ name, phone, type, balance, currency }]).
 *  - Supplier cards: every card, matched to an existing Supplier of the org by name (the card list has no
 *    codes or UENs); the rest are created with the app's code rule (S + first letter + max+1).
 *  - Opening bills: one BILL per supplier with a balance, dated the org's cutover, "Opening balance",
 *    billStatus POSTED, money stamped (owed = balance), marked imported (config.erpImport, source
 *    abss-opening): no journal ever (the GL already carries the ABSS AP balance from the cutover journal).
 *    A payment voucher later settles it as usual (Dr AP / Cr bank).
 *  - Reconciliation: the AP control account (AccountingSetting.creditorControl) at the cutover, against the
 *    opening bills plus the AIMS-native AP documents dated on or before the cutover.
 * DRY RUN BY DEFAULT. One ActionLog row per org on apply, log JSON with every id (rollback input).
 *   npx ts-node --transpile-only scripts/wct-abss-ap-opening.ts --env prod --org wct|ymm [--cards-only] [--apply --confirm-prod]
 *   npx ts-node --transpile-only scripts/wct-abss-ap-opening.ts --env prod --org ymm --rollback <log.json> [--apply --confirm-prod]
 *   dev (per-org schemas): add --schema org_wct
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/elroylee/Desktop/aims/api-server-production/.env' });
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { stampDocumentMoney } from '../src/common/document-money';

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const ORG_KEY = one('--org')!;
const APPLY = argv.includes('--apply');
const CARDS_ONLY = argv.includes('--cards-only');
const ROLLBACK = one('--rollback');
// --difference <amount> (Elroy 19 Nov, WCT (S)): one extra bill "Cutover difference (to confirm)" under a placeholder
// supplier so the opening bills tie to the AP control at cutover while finance says which supplier it belongs to.
const DIFFERENCE = argv.includes('--difference') ? Number(one('--difference')) : null;
const DIFF_SUPPLIER = 'ABSS cutover difference';
const DIFF_TEXT = 'Cutover difference (to confirm)';
const SCHEMA = one('--schema');
const IMPORTS = '/Users/elroylee/Desktop/aims/_imports/wct';
const ORGS: Record<string, { id: string; label: string; cutover: string; cards: string }> = {
  wct: { id: '5c700000-0000-4000-8000-5c7000000001', label: 'WCT (S)', cutover: '2026-11-05', cards: `${IMPORTS}/abss/ap/cardlist-wct-2026-11-13.json` },
  ymm: { id: '5c700000-0000-4000-8000-5c7000000003', label: 'YMM', cutover: '2026-11-06', cards: `${IMPORTS}/abss/ap/cardlist-ymm-2026-11-13.json` },
};
const CARD_LIST_DATE = '2026-11-13';
const R = (n: number) => Math.round(n * 100) / 100;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Name key: lower case, & = and, punctuation dropped, company suffixes dropped. */
export function nameKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pte|private|ltd|limited|llp|sdn|bhd|co|company|inc|corp|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The app's supplier code rule (suppliers.service generateSupplierCode): S + first A-Z/0-9 + (max + 1), 3 digits. */
export function nextSupplierCode(name: string, taken: Set<string>): string {
  const first = name.normalize('NFD').toUpperCase().match(/[A-Z0-9]/)?.[0] || 'X';
  const prefix = `S${first}`;
  let max = 0;
  for (const c of taken) {
    const m = c.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const code = `${prefix}${String(max + 1).padStart(3, '0')}`;
  taken.add(code);
  return code;
}

(async () => {
  const org = ORGS[ORG_KEY];
  if (!org) throw new Error('--org wct|ymm');
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const c = new Client({ connectionString: ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL });
  await c.connect();
  if (SCHEMA) await c.query(`SET search_path TO "${SCHEMA.replace(/"/g, '')}", platform, public`);
  if (!APPLY) await c.query('SET default_transaction_read_only = on');
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const batch = `abss-ap-opening-${org.cutover}`;
  console.log(`${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'} ${ROLLBACK ? 'ROLLBACK ' : ''}${org.label} (cutover ${org.cutover}, card list ${CARD_LIST_DATE})`);

  if (ROLLBACK) {
    const log = JSON.parse(fs.readFileSync(ROLLBACK, 'utf8'));
    if (log.organizationId !== org.id) throw new Error('log is for another org');
    const billIds: string[] = (log.bills || []).map((b: any) => b.id);
    const supIds: string[] = (log.createdSuppliers || []).map((s: any) => s.id);
    const paid = billIds.length ? await q(`select "billId"::text from "BillPayment" where "billId"::text = any($1)`, [billIds]) : [];
    const jes = billIds.length ? await q(`select id from "JournalEntry" where "sourceDocumentId"::text = any($1) and status <> 'VOID'`, [billIds]) : [];
    if (paid.length || jes.length) throw new Error(`refused: ${paid.length} payments / ${jes.length} journals on these bills; settle by hand`);
    const used = supIds.length ? await q(`select distinct config->>'supplierId' s from "Document" where "organizationId"::text = $1 and config->>'supplierId' = any($2) and not (id::text = any($3))`, [org.id, supIds, billIds]) : [];
    const keepSup = new Set(used.map((r: any) => r.s));
    console.log(`  delete ${billIds.length} opening bills, ${supIds.length - keepSup.size} created suppliers (${keepSup.size} kept: used by other documents)`);
    if (APPLY) {
      await c.query('BEGIN');
      if (billIds.length) await c.query(`delete from "Document" where "organizationId"::text = $1 and id::text = any($2) and config->'erpImport'->>'source' = 'abss-opening'`, [org.id, billIds]);
      const del = supIds.filter((id) => !keepSup.has(id));
      if (del.length) await c.query(`delete from "Supplier" where "organizationId"::text = $1 and id::text = any($2)`, [org.id, del]);
      await c.query(
        `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-abss-ap-opening', 'System creation', $1, 'operator', 'DELETE', 'bill', null, $2::jsonb, 'SUCCESS')`,
        [org.id, JSON.stringify({ note: `Rolled back ABSS opening AP (${batch}): ${billIds.length} bills, ${del.length} suppliers` })],
      );
      await c.query('COMMIT');
      console.log('  rolled back');
    }
    await c.end();
    return;
  }

  // ── Cards ──
  const cards: Array<{ name: string; phone: string; balance: number; currency: string }> = JSON.parse(fs.readFileSync(org.cards, 'utf8'));
  const byKey = new Map<string, { name: string; phone: string; balance: number; currency: string; lines: number }>();
  for (const k of cards) {
    const key = nameKey(k.name);
    const cur = byKey.get(key);
    if (cur) {
      console.log(`    merged card line: "${k.name}" into "${cur.name}" (${k.balance.toFixed(2)})`);
      cur.balance = R(cur.balance + k.balance);
      cur.lines++;
      if (!cur.phone && k.phone) cur.phone = k.phone;
    } else byKey.set(key, { ...k, lines: 1 });
  }
  const existing = await q(`select id::text, "supplierCode" code, name, currency from "Supplier" where "organizationId"::text = $1`, [org.id]);
  const existingByKey = new Map<string, any>(existing.map((s: any) => [nameKey(s.name), s]));
  const taken = new Set<string>(existing.map((s: any) => s.code).filter(Boolean));
  const plan: Array<{ key: string; name: string; phone: string; balance: number; currency: string; lines: number; supplier: any; create: boolean; code: string }> = [];
  for (const [key, k] of byKey) {
    const ex = existingByKey.get(key);
    plan.push({ key, ...k, supplier: ex ?? null, create: !ex, code: ex?.code ?? nextSupplierCode(k.name, taken) });
  }
  plan.sort((a, b) => a.name.localeCompare(b.name));
  const cardSum = R(cards.reduce((s, k) => s + k.balance, 0));
  if (DIFFERENCE !== null) {
    if (!isFinite(DIFFERENCE) || Math.abs(DIFFERENCE) < 0.005) throw new Error('--difference needs a non-zero amount');
    const key = nameKey(DIFF_SUPPLIER);
    const ex = existingByKey.get(key);
    plan.push({ key, name: DIFF_SUPPLIER, phone: '', balance: R(DIFFERENCE), currency: 'SGD', lines: 0, supplier: ex ?? null, create: !ex, code: ex?.code ?? nextSupplierCode(DIFF_SUPPLIER, taken), diff: true } as any);
    console.log(`  cutover difference: ${R(DIFFERENCE).toFixed(2)} as "${DIFF_TEXT}" under supplier "${DIFF_SUPPLIER}"`);
  }
  const withBal = plan.filter((p) => Math.abs(p.balance) > 0.004);
  const neg = withBal.filter((p) => p.balance < 0);
  const foreign = withBal.filter((p) => p.currency !== 'SGD');
  console.log(`  card list: ${cards.length} lines, ${plan.length} suppliers (${cards.length - plan.length} duplicate lines merged), balances ${cardSum.toFixed(2)}`);
  console.log(`  suppliers: ${plan.filter((p) => !p.create).length} matched to existing, ${plan.filter((p) => p.create).length} new`);
  for (const p of plan.filter((p) => !p.create)) console.log(`    matched: "${p.name}" -> ${p.supplier.code} ${p.supplier.name}`);
  if (neg.length) throw new Error(`negative balances (supplier credits) need a credit note path: ${neg.map((p) => p.name).join(', ')}`);
  if (foreign.length) throw new Error(`foreign-currency balances: ${foreign.map((p) => p.name).join(', ')}`);

  // ── Reconciliation ──
  const ctl = (await q(`select "controlAccounts"->>'creditorControl' cc from "AccountingSetting" where "organizationId"::text = $1`, [org.id]))[0]?.cc || 'CL001';
  const acc = (await q(`select id from "ChartOfAccount" where "organizationId"::text = $1 and code = $2`, [org.id, ctl]))[0];
  const gl = acc
    ? Number((await q(`select coalesce(sum(l.credit - l.debit), 0)::numeric(14,2) b from "JournalEntryLine" l join "JournalEntry" je on je.id = l."journalEntryId" where l."accountId" = $1 and je.status <> 'VOID' and je."entryDate" < ($2::date + 1)`, [acc.id, org.cutover]))[0].b)
    : 0;
  const native = await q(
    `select d.id::text, d.name, d.type, d.config->>'totalAmount' tot, coalesce(d.config->>'billDate', d.config->>'date') dt, d.config->>'billStatus' bs,
            (select coalesce(sum(p.amount), 0) from "BillPayment" p where p."billId"::text = d.id::text) paid
       from "Document" d where d."organizationId"::text = $1 and d.type in ('BILL', 'CREDIT_NOTE') and d.config->'erpImport' is null
        and coalesce(d.config->>'billStatus', '') in ('POSTED', 'PAID') and coalesce(d.config->>'billDate', d.config->>'date') <= $2`,
    [org.id, org.cutover],
  );
  const nativeOwed = R(native.reduce((s: number, d: any) => s + (d.type === 'CREDIT_NOTE' ? -1 : 1) * (Number(d.tot) - Number(d.paid)), 0));
  const openingSum = R(withBal.reduce((s, p) => s + p.balance, 0));
  const diff = R(gl - nativeOwed - openingSum);
  console.log(`  AP control ${ctl} at ${org.cutover}: ${gl.toFixed(2)} (GL, includes AIMS documents dated on or before the cutover)`);
  for (const d of native) console.log(`    native ${d.type} ${d.name} dated ${d.dt} owed ${R(Number(d.tot) - Number(d.paid)).toFixed(2)}`);
  console.log(`  opening bills: ${withBal.length}, total ${openingSum.toFixed(2)}; native AP owed at cutover ${nativeOwed.toFixed(2)}`);
  console.log(`  ${Math.abs(diff) < 0.005 ? 'RECONCILES' : `DIFFERENCE ${diff.toFixed(2)} (GL minus native minus opening bills)`}`);

  const existingBills = await q(`select name from "Document" where "organizationId"::text = $1 and type = 'BILL' and config->'erpImport'->>'source' = 'abss-opening'`, [org.id]);
  if (existingBills.length && !CARDS_ONLY) throw new Error(`${existingBills.length} opening bills already exist for this org; roll back first`);

  const outDir = path.join(IMPORTS, 'abss', 'ap');
  fs.writeFileSync(
    path.join(outDir, `plan-${ORG_KEY}-${ENV}.csv`),
    ['name,code,action,existing,balance,lines', ...plan.map((p) => [JSON.stringify(p.name), p.code, p.create ? 'create' : 'match', p.supplier ? JSON.stringify(p.supplier.name) : '', p.balance.toFixed(2), p.lines].join(','))].join('\n') + '\n',
  );
  console.log(`  plan ${path.join(outDir, `plan-${ORG_KEY}-${ENV}.csv`)}`);
  if (!APPLY) {
    await c.end();
    return;
  }

  // ── Apply ──
  const log: any = { at: new Date().toISOString(), env: ENV, organizationId: org.id, batch, createdSuppliers: [], matchedSuppliers: [], bills: [], reconciliation: { control: ctl, gl, nativeOwed, openingSum, diff } };
  await c.query('BEGIN');
  for (const p of plan) {
    if (p.create) {
      const r = (await q(`insert into "Supplier"(id, "supplierCode", name, phone, currency, "organizationId", "createdAt", "updatedAt") values (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now()) returning id::text`, [p.code, p.name, p.phone || null, p.currency, org.id]))[0];
      p.supplier = { id: r.id, code: p.code, name: p.name };
      log.createdSuppliers.push({ id: r.id, code: p.code, name: p.name });
    } else log.matchedSuppliers.push({ id: p.supplier.id, code: p.supplier.code, name: p.supplier.name, card: p.name });
  }
  if (!CARDS_ONLY && withBal.length) {
    let tmpl = (await q(`select id::text from "DocumentTemplate" where "organizationId"::text = $1 and type = 'BILL' order by "createdAt" asc limit 1`, [org.id]))[0];
    if (!tmpl) {
      tmpl = (await q(
        `insert into "DocumentTemplate"(id, "organizationId", name, type, "isActive", "templateVariant", "designName", config, "createdAt", "updatedAt")
         values (gen_random_uuid(), $1, 'Bill', 'BILL', true, 'Default', 'Default', $2::jsonb, now(), now()) returning id::text`,
        [org.id, JSON.stringify({ tableColumnOrder: ['description', 'quantity', 'unitPrice', 'taxAmount', 'amount'], columnLabels: { description: 'Description', quantity: 'Qty', unitPrice: 'Unit Price', taxAmount: 'Tax', amount: 'Amount' }, formFields: [] })],
      ))[0];
      log.createdTemplate = tmpl.id;
    }
    for (const p of withBal) {
      const name = `OB-${p.supplier.code}`;
      const text = (p as any).diff ? DIFF_TEXT : `Opening balance at ${dmy(org.cutover)} (ABSS)`;
      const cfg = stampDocumentMoney(
        {
          kind: 'SIN',
          supplierId: p.supplier.id,
          supplier: { id: p.supplier.id, name: p.supplier.name },
          billDate: org.cutover,
          date: org.cutover,
          dueDate: org.cutover,
          currency: 'SGD',
          referenceNo: (p as any).diff ? DIFF_TEXT : 'Opening balance',
          reference: (p as any).diff ? DIFF_TEXT : 'Opening balance',
          description: text,
          subtotal: p.balance,
          taxAmount: 0,
          totalAmount: p.balance,
          amountPaid: 0,
          amountsAre: 'EXCLUSIVE',
          lines: [{ description: text, quantity: 1, unitPrice: p.balance, amount: p.balance, taxAmount: 0 }],
          billStatus: 'POSTED',
          inboundChannel: 'IMPORT',
          erpImport: { source: 'abss-opening', batch, erpId: (p as any).diff ? 'abss-cutover-difference' : `abss-card:${p.name}`, originalNumber: name, status: 'Open', balanceAtImport: p.balance, ...((p as any).diff ? { cutoverDifference: true, toConfirm: 'which supplier (WCT finance)' } : {}), cardListDate: CARD_LIST_DATE, cutover: org.cutover },
        },
        { gross: p.balance, outstanding: p.balance, paid: 0 },
      );
      const r = (await q(
        `insert into "Document"(id, "createdAt", "updatedAt", config, "documentTemplateId", type, "organizationId", name, status)
         values (gen_random_uuid(), now(), now(), $1::jsonb, $2, 'BILL', $3, $4, 'confirmed') returning id::text`,
        [JSON.stringify(cfg), tmpl.id, org.id, name],
      ))[0];
      log.bills.push({ id: r.id, name, supplierId: p.supplier.id, supplier: p.supplier.name, amount: p.balance });
    }
  }
  await c.query(
    `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
     values (gen_random_uuid(), 'SYSTEM', 'system:wct-abss-ap-opening', 'System creation', $1, 'operator', 'CREATE', 'bill', null, $2::jsonb, 'SUCCESS')`,
    [org.id, JSON.stringify({ note: `ABSS suppliers + opening AP (${batch}, card list ${CARD_LIST_DATE}): ${log.createdSuppliers.length} suppliers created, ${log.matchedSuppliers.length} matched, ${log.bills.length} opening bills ${openingSum.toFixed(2)}; AP control ${gl.toFixed(2)}`, batch })],
  );
  await c.query('COMMIT');
  const f = path.join(IMPORTS, 'logs', `wct-abss-ap-opening.${ORG_KEY}.${ENV}.${new Date().toISOString().replace(/[:.]/g, '-')}.log.json`);
  fs.writeFileSync(f, JSON.stringify(log, null, 1));
  console.log(`  written: ${log.createdSuppliers.length} suppliers, ${log.bills.length} bills; log ${f}`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
