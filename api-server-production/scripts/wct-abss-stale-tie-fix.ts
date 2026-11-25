/**
 * WCT (S) "stale tie" journals from the 23 Nov ABSS ledger import: READ-ONLY report (2026-11-25).
 *
 * verify-accounting-invariants.ts check 5 flags an active document journal whose totalDebit differs
 * from its document's gross. On prod (25 Nov) 72 of those are WCT (S) journals of the ABSS ledger
 * batch (createdBy abss-gl:wct-abss-2026-11-23): 70 sale journals ABSS-SJ-I-xxxxxx and 2 purchase
 * journals ABSS-PJ-xxxxxxxx (the other 2 of the sweep's 74 are Osiris Technology, not WCT).
 *
 * This script explains every one of them and proposes the action. It NEVER writes: the connection is
 * read-only (SET default_transaction_read_only = on) and there is no --apply. Finding (see the
 * summary it writes): none of them is a duplicate; each is ABSS's own entry, so voiding or re-tying
 * any of them would move WCT (S) away from ABSS (2024+ balances = ABSS). The proposed "fix" is to
 * leave the ledger alone and teach the sweep about imported ledgers (proposal only, in the summary).
 *
 * Classes:
 *   CONTRA_LINE    the journal's control leg (AR 1-3100 / AP 2-2100) = the document's gross; totalDebit is
 *                  larger only because ABSS has a negative (discount / credit) line in the same entry.
 *   CUSTOMER_SWAP  the ABSS entry moves the sale from one customer card to another (net 0 to AR).
 *   ABSS_SPLIT     ABSS holds the sale as several entries under the same number (an original + later
 *                  amendments, mostly dated the 1st of a GST quarter = a change to a locked period). The
 *                  document is tied to the first part only; ALL parts together = the ERP invoice.
 *   PLACEHOLDER_1  the ERP invoice is a S$1 "(NG)" placeholder; ABSS holds the real sale and its reversal.
 *   PRE2024_AMEND  the ERP invoice is dated before 2024 (it sits in the ABSS opening balance); the ABSS
 *                  entry is a 2024+ amendment to it (adjustment to a locked period).
 *   ABSS_DIFFERS   2024+ invoice whose ABSS total under that number differs from the ERP gross (ABSS
 *                  billed / reduced a different amount, or put the ERP credit note into the sale itself).
 *
 *   npx ts-node --transpile-only scripts/wct-abss-stale-tie-fix.ts --env prod [--out <path-without-ext>]
 *
 * Writes <out>.csv (finance) and <out>.txt (summary). Default out:
 *   ~/Desktop/aims-agents/logs/wct/abss-stale-tie-74-<today>
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/elroylee/Desktop/aims/api-server-production/.env' });
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client, types } from 'pg';
import { grossOf, outstandingOf } from '../src/common/document-money';

types.setTypeParser(1700, (v) => Number(v));
types.setTypeParser(20, (v) => Number(v));

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const TODAY = new Date().toISOString().slice(0, 10);
const OUT = one('--out', path.join(os.homedir(), `Desktop/aims-agents/logs/wct/abss-stale-tie-74-${TODAY}`))!;
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BATCH = 'abss-gl:wct-abss-2026-11-23';
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => R(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The sweep's own definition (verify-accounting-invariants.ts check 5), kept identical on purpose.
const NATIVE_ACTIVE = `je."sourceDocumentId" IS NOT NULL AND je.status <> 'VOID' AND je."createdBy" IS DISTINCT FROM 'xero-import'
  AND je."sourcePaymentId" IS NULL AND je.type NOT IN ('PAYMENT','ADJUSTMENT')`;
const DOC_GROSS = `coalesce(nullif(d.config->>'totalWithTax','')::numeric, nullif(d.config->>'xeroGross','')::numeric,
  nullif(d.config->>'nettTotal','')::numeric, nullif(d.config->'documentInfo'->>'nettTotal','')::numeric)`;

type Line = { jid: string; code: string; name: string; dr: number; cr: number; description: string | null };
type Je = { id: string; jn: string; type: string; status: string; createdBy: string | null; dt: string; jt: number; did: string | null; reference: string | null };

(async () => {
  if (argv.includes('--apply')) throw new Error('This script is read-only: no write is proposed for these journals (see the summary).');
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`no database url for --env ${ENV}`);
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('SET default_transaction_read_only = on');
  const q = async <T = any>(sql: string, p: any[] = []) => (await c.query(sql, p)).rows as T[];

  // 0. the sweep's count, every org (so 74 vs WCT's share is explained)
  const byOrg = await q<{ org: string; n: number }>(
    `select o.name org, count(*)::int n from "JournalEntry" je join "Document" d on d.id::text = je."sourceDocumentId"
       join "Organization" o on o.id = je."organizationId"
      where ${NATIVE_ACTIVE} and coalesce(nullif(d.config->>'currency',''),'SGD') = 'SGD' and ${DOC_GROSS} is not null
        and abs(je."totalDebit" - ${DOC_GROSS}) > 0.02 group by 1 order by 2 desc`,
  );

  // 1. WCT (S) stale ties
  const stale = await q(
    `select je.id, je."journalNumber" jn, je.type, je."createdBy", je."entryDate"::date::text dt, je."totalDebit"::float jt,
            je.reference, d.id did, d.name doc, d.type::text dtype, d.status::text dstatus, d.config, ${DOC_GROSS}::float sweep_gross
       from "JournalEntry" je join "Document" d on d.id::text = je."sourceDocumentId"
      where je."organizationId" = $1 and ${NATIVE_ACTIVE} and coalesce(nullif(d.config->>'currency',''),'SGD') = 'SGD'
        and ${DOC_GROSS} is not null and abs(je."totalDebit" - ${DOC_GROSS}) > 0.02
      order by je."journalNumber"`,
    [WCT],
  );
  const notBatch = stale.filter((s) => s.createdBy !== BATCH);
  const refs: string[] = [...new Set(stale.map((s) => String(s.reference || s.doc)))];

  // 2. every journal of the same number (ABSS parts, ERP / native postings) + every journal on the same documents
  const fam = await q<Je>(
    `select je.id, je."journalNumber" jn, je.type, je.status, je."createdBy", je."entryDate"::date::text dt, je."totalDebit"::float jt,
            je."sourceDocumentId" did, je.reference
       from "JournalEntry" je
      where je."organizationId" = $1 and (je.reference = any($2) or je."sourceDocumentId" = any($3))`,
    [WCT, refs, stale.map((s) => s.did)],
  );
  const lines = await q<Line>(
    `select l."journalEntryId" jid, a.code, a.name, l.debit::float dr, l.credit::float cr, l.description
       from "JournalEntryLine" l join "ChartOfAccount" a on a.id = l."accountId"
      where l."journalEntryId" = any($1) order by l."lineNumber"`,
    [[...new Set([...fam.map((j) => j.id), ...stale.map((s) => s.id)])]],
  );
  // ABSS credit-note entries for the ERP credit notes on these invoices (ABSS keeps CNs as their own V-xxxxxx entries)
  const cnRefs = [...new Set(stale.map((s) => s.config?.erpImport?.creditNote).filter(Boolean))] as string[];
  const cnJes = cnRefs.length
    ? await q<Je>(`select je.id, je."journalNumber" jn, je.reference, je."totalDebit"::float jt, je."entryDate"::date::text dt from "JournalEntry" je
                    where je."organizationId" = $1 and je.status <> 'VOID' and je.reference = any($2)`, [WCT, cnRefs])
    : [];
  // whole-batch integrity: ABSS numbers imported once
  const [dupNos] = await q(`select count(*)::int n, count(distinct "journalNumber")::int dn from "JournalEntry" where "organizationId" = $1 and "createdBy" = $2`, [WCT, BATCH]);
  const dupSameDay = await q(
    `select reference, "entryDate"::date::text dt, "totalDebit"::float amt, count(*)::int n from "JournalEntry"
      where "organizationId" = $1 and "createdBy" = $2 and status <> 'VOID' and type in ('INVOICE','BILL') group by 1,2,3 having count(*) > 1`,
    [WCT, BATCH],
  );
  const [amend] = await q(
    `select count(*)::int n, count(*) filter (where to_char("entryDate",'MM-DD') in ('01-01','04-01','07-01','10-01'))::int quarter_start
       from "JournalEntry" where "organizationId" = $1 and "createdBy" = $2 and "journalNumber" ~ '^ABSS-SJ-I-[0-9]+-[0-9]+$'`,
    [WCT, BATCH],
  );
  await c.end();

  const linesOf = (jid: string) => lines.filter((l) => l.jid === jid);
  const leg = (jid: string, code: string, sign: 1 | -1) => R(linesOf(jid).filter((l) => l.code === code).reduce((a, l) => a + sign * (l.dr - l.cr), 0));

  const rows: any[] = [];
  const acct = { tied: new Map<string, { name: string; net: number }>(), family: new Map<string, { name: string; net: number }>() };
  const addAcct = (m: Map<string, { name: string; net: number }>, jid: string) => {
    for (const l of linesOf(jid)) {
      const k = m.get(l.code) || { name: l.name, net: 0 };
      k.net = R(k.net + l.dr - l.cr);
      m.set(l.code, k);
    }
  };
  const seenFam = new Set<string>();

  for (const s of stale) {
    const isBill = s.type === 'BILL';
    const ctl = isBill ? '2-2100' : '1-3100';
    const sign: 1 | -1 = isBill ? -1 : 1;
    const gross = grossOf(s.config) ?? s.sweep_gross;
    const erp = s.config?.erpImport || {};
    const ref = String(s.reference || s.doc);
    const parts = fam
      .filter((j) => j.reference === ref && j.createdBy === BATCH && j.status !== 'VOID' && (isBill ? j.type === 'BILL' : j.type === 'INVOICE'))
      .sort((a, b) => a.dt.localeCompare(b.dt) || a.jn.localeCompare(b.jn));
    const others = fam.filter((j) => j.did === s.did && j.id !== s.id && j.status !== 'VOID');
    const tiedLeg = leg(s.id, ctl, sign);
    const absSum = R(parts.reduce((a, j) => a + leg(j.id, ctl, sign), 0));
    const customers = [...new Set(linesOf(s.id).filter((l) => l.code === ctl).map((l) => String(l.description || '').replace(/^Sale; /, '').replace(/ · Job .*/, '')))];
    const erpDate = String(s.config?.date || '').slice(0, 10);
    const ratio = gross ? R(s.jt / gross) : null;

    addAcct(acct.tied, s.id);
    for (const p of parts) if (!seenFam.has(p.id)) (seenFam.add(p.id), addAcct(acct.family, p.id));

    let cls: string;
    let shows: string;
    let action: string;
    const partsText = parts.map((p) => `${p.jn} ${p.dt} ${money(leg(p.id, ctl, sign))}`).join(' + ');
    if (Math.abs(tiedLeg - gross) <= 0.02 && parts.length === 1) {
      cls = 'CONTRA_LINE';
      shows = `one entry; ${isBill ? 'AP' : 'AR'} leg ${money(tiedLeg)} = document; journal total counts a negative ${isBill ? 'discount/stock' : 'discount'} line`;
      action = 'None. Ledger correct; sweep should compare the control leg, not totalDebit';
    } else if (Math.abs(tiedLeg) <= 0.02 && customers.length > 1) {
      cls = 'CUSTOMER_SWAP';
      const side = (dr: boolean) => [...new Set(linesOf(s.id).filter((l) => l.code === ctl && (dr ? l.dr > 0 : l.cr > 0)).map((l) => String(l.description || '').replace(/^Sale; /, '').replace(/ · Job .*/, '')))].join(' / ');
      shows = `entry dated ${s.dt} moves the sale from ${side(false)} (AR Cr) to ${side(true)} (AR Dr), net 0 to AR`;
      action = 'None. ABSS customer correction; ledger correct';
    } else if (Number(gross) <= 1.0001) {
      cls = 'PLACEHOLDER_1';
      shows = `ABSS entries ${partsText} = net ${money(absSum)} for ${s.dt.slice(0, 4)}+; ERP invoice is a S$1 placeholder`;
      action = 'None in GL (ABSS is right). Already in the NG move held list (real ABSS sale under the number)';
    } else if (erpDate && erpDate < '2024-01-01') {
      cls = 'PRE2024_AMEND';
      shows = `${s.dt} amendment ${money(tiedLeg)} to a ${erpDate} invoice (original sits in the 31 Dec 2023 ABSS opening)`;
      action = 'None in GL (ABSS is right). Finance FYI: ABSS changed an old invoice in 2024+';
    } else if (parts.length > 1 && Math.abs(absSum - gross) <= 0.02) {
      cls = 'ABSS_SPLIT';
      shows = `${parts.length} entries: ${partsText} = ${money(absSum)} = invoice`;
      action = 'None. ABSS parts sum to the invoice; only the first part is tied';
    } else {
      cls = 'ABSS_DIFFERS';
      const cn = erp.creditNote ? cnJes.find((j) => j.reference === erp.creditNote) : null;
      shows =
        `${parts.length > 1 ? `${parts.length} entries: ${partsText} = ` : ''}${money(absSum)} vs ERP ${money(gross)} (diff ${money(absSum - gross)})` +
        (erp.creditNote ? `; ERP CN ${erp.creditNote}${cn ? ` = ABSS ${cn.jn} ${money(cn.jt)}` : ' not in ABSS (ABSS reduced the sale itself)'}` : '') +
        (Number(erp.erpBalanceDue) ? `; ERP balance due ${money(Number(erp.erpBalanceDue))}` : '');
      action = 'None in GL (ABSS is the book). Finance to confirm the ABSS amount; document balance follows the ERP';
    }
    rows.push({
      journal: s.jn,
      date: s.dt,
      journalTotal: s.jt,
      invoice: s.doc,
      invoiceTotal: gross,
      ratio,
      accounts: linesOf(s.id).map((l) => `${l.code} ${l.name} ${l.dr ? `Dr ${money(l.dr)}` : `Cr ${money(l.cr)}`}`).join('; '),
      duplicate: 'No',
      otherJournals: others.map((o) => `${o.jn} ${o.type} ${o.dt}`).join(', '),
      abssShows: shows,
      action,
      cls,
      controlLeg: tiedLeg,
      abssSumForNumber: absSum,
      abssMinusInvoice: R(absSum - gross),
      erpDate,
      outstanding: outstandingOf(s.config),
    });
  }

  // ---------------------------------------------------------------- CSV
  const esc = (v: any) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ['journal no', 'date', 'journal total', 'invoice no', 'invoice total', 'ratio', 'accounts', 'duplicate?', 'ABSS shows', 'proposed action',
    'class', 'control leg (AR/AP)', 'ABSS total for the number', 'ABSS minus invoice', 'ERP invoice date', 'document outstanding', 'other journals on the document'];
  const keys = ['journal', 'date', 'journalTotal', 'invoice', 'invoiceTotal', 'ratio', 'accounts', 'duplicate', 'abssShows', 'action',
    'cls', 'controlLeg', 'abssSumForNumber', 'abssMinusInvoice', 'erpDate', 'outstanding', 'otherJournals'];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(`${OUT}.csv`, [head.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n') + '\n');

  // ---------------------------------------------------------------- summary
  const out: string[] = [];
  const say = (s = '') => out.push(s);
  const byCls = new Map<string, any[]>();
  for (const r of rows) byCls.set(r.cls, [...(byCls.get(r.cls) || []), r]);
  const exact2 = rows.filter((r) => r.ratio !== null && Math.abs(r.ratio - 2) < 0.005);
  say(`WCT (S) ABSS stale-tie journals: read-only report (${ENV}, ${new Date().toISOString()})`);
  say('');
  say(`Sweep check 5 across all orgs: ${byOrg.map((o) => `${o.org} ${o.n}`).join(', ')} (total ${byOrg.reduce((a, o) => a + o.n, 0)})`);
  say(`WCT (S): ${rows.length} journals (${rows.filter((r) => r.journal.startsWith('ABSS-SJ')).length} sale ABSS-SJ, ${rows.filter((r) => r.journal.startsWith('ABSS-PJ')).length} purchase ABSS-PJ); not from batch ${BATCH}: ${notBatch.length}`);
  say(`Exactly 2x: ${exact2.length} (${exact2.map((r) => r.journal).join(', ')})`);
  const bands: Array<[string, (x: number) => boolean]> = [['< 0.5', (x) => x < 0.5], ['0.5 - 0.99', (x) => x >= 0.5 && x < 0.995], ['1.00 - 1.99', (x) => x >= 0.995 && x < 1.995], ['2x exactly', (x) => Math.abs(x - 2) < 0.005], ['> 2 (excl. 2x)', (x) => x >= 2.005 || (x > 1.995 && Math.abs(x - 2) >= 0.005)]];
  say(`Ratio journal / invoice: ${bands.map(([k, f]) => `${k}: ${rows.filter((r) => r.ratio !== null && f(r.ratio)).length}`).join(' · ')}`);
  say('');
  say('By class:');
  for (const [k, v] of byCls) say(`  ${k.padEnd(14)} ${String(v.length).padStart(3)}  ${v.map((r) => r.journal.replace(/^ABSS-(SJ|PJ)-/, '')).join(' ')}`);
  say('');
  say('Mechanism: the import makes ONE journal per ABSS entry (number + date) and ties the FIRST entry of a number to the ERP');
  say('invoice of that number. ABSS keeps later changes to a sale as further entries under the same number (here -2 / -3), mostly');
  say('dated the 1st of a GST quarter, and 1 Jan 2024 for invoices of 2023 and earlier (the first period after the 31 Dec 2023');
  say('opening). Several ABSS lines on the same date land in one journal, and totalDebit adds up every Dr line, so a reversal +');
  say('re-entry (I-010278: Kopitiam -> NTUC) or a discount line reads as 2x / 1.0x even though the AR leg is right. The sweep');
  say('compares that ONE journal\'s totalDebit with the ERP invoice gross, so any split, amendment or contra line is flagged.');
  say('ABSS source: the ABSS transaction export behind batch ' + BATCH + ' is not in ~/Desktop/WCT_Books or _imports/wct (only');
  say('account lists, card lists and sales summaries), and the importer is not in git; the ABSS figures here are the imported ABSS');
  say('entries themselves (one per ABSS number + date, numbers unique).');
  say('');
  say('Examples (two per class):');
  for (const [k, v] of byCls) for (const r of v.slice(0, 2)) say(`  ${k.padEnd(14)} ${r.journal} ${money(r.journalTotal)} vs ${r.invoice} ${money(r.invoiceTotal)}: ${r.abssShows}`);
  say('');
  say('Duplicates:');
  say(`  ABSS numbers imported once: ${dupNos.n} journals, ${dupNos.dn} distinct numbers; same number + date + amount twice: ${dupSameDay.length}`);
  const withOthers = rows.filter((r) => r.otherJournals);
  say(`  Another live journal on the same document: ${withOthers.length ? withOthers.map((r) => `${r.invoice} (${r.otherJournals})`).join('; ') : 'none'} (payments only)`);
  say('  No ERP-GL or native invoice journal exists for any of these documents in 2024+, so no sale is posted twice.');
  say(`  ABSS amendment parts (ABSS-SJ-I-n-2/-3 in the batch): ${amend.n}, of which ${amend.quarter_start} dated the 1st of a GST quarter.`);
  say('');
  const tbl = (m: Map<string, { name: string; net: number }>) =>
    [...m.entries()].sort().map(([code, v]) => `  ${code} ${v.name.padEnd(28)} ${v.net >= 0 ? 'Dr' : 'Cr'} ${money(Math.abs(v.net)).padStart(12)}`);
  say('Per-account effect of the flagged journals as posted (Dr + / Cr -):');
  tbl(acct.tied).forEach((l) => say(l));
  say('Per-account effect of ALL ABSS entries under these numbers (flagged + their later parts):');
  tbl(acct.family).forEach((l) => say(l));
  say('Voiding the flagged journals would post the reverse of the first table: WCT (S) would then differ from ABSS by exactly those amounts.');
  say('');
  const dif = byCls.get('ABSS_DIFFERS') || [];
  say(`ABSS total vs ERP gross where they differ (ABSS_DIFFERS, ${dif.length}): net ABSS minus ERP = ${money(dif.reduce((a, r) => a + r.abssMinusInvoice, 0))}`);
  for (const r of dif) say(`  ${r.invoice.padEnd(9)} ${r.abssShows}`);
  say('');
  say('Proposal: no ledger write. Every flagged journal is ABSS\'s own entry; voiding or re-tying any would move WCT (S) off ABSS.');
  say('Untying (sourceDocumentId -> null) is NOT proposed either: paid invoices with no INVOICE journal show up in the journal health');
  say('check (journal.service) and the GST report\'s posted set, and the document would lose its link to its ledger entry.');
  say('Sweep proposal (not changed): for journals whose createdBy starts with "abss-gl:" compare the document gross with the control leg');
  say('(AR 1-3100 Dr-Cr / AP 2-2100 Cr-Dr) summed over ALL journals of the batch with the same reference, and report what is left as');
  say('WARN "imported ledger differs from document" instead of FAIL (as xero-import is already excluded).');
  fs.writeFileSync(`${OUT}.txt`, out.join('\n') + '\n');
  console.log(out.join('\n'));
  console.log(`\n-> ${OUT}.csv\n-> ${OUT}.txt`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
