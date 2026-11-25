/**
 * ABSS (MYOB) report parser for the .txt exports (tab separated, CRLF). Pure functions, no I/O, so node --test can
 * cover them (scripts/__tests__/abss-report-parse.test.js). Used by scripts/wct-abss-history-ymm.ts (owner 2026-11-25).
 *
 * Reports understood:
 *   journal reports   Sales & Receivables / Purchases & Payables / Cash Receipts / Cash Disbursements / General Journal
 *                     ("SJ\t1/12/2024\tmemo" entry headers, "\t\tID#\tAcct#\tAccount Name\tDebit\tCredit\tJob No.[\tMemo\tName]" lines,
 *                     "Grand Total:" at the end)
 *   Accounts List [Summary]   "\tAccount name\t$balance" rows in chart order (no codes; pair them with the chart file)
 *   Supplier Payment History  supplier name rows, then "\tCheque #\tChq Date\tPO #\tDate\tSupplier's Inv. #\tPurchase Total\t\tApplied"
 *   chart file (ours)         "level|code|name|balance" (_imports/wct/abss/<org>-abss-coa-*.txt)
 */
'use strict';

/** Bytes -> text. ABSS writes Windows-1252/latin1 when a name has an accent; plain ASCII otherwise. */
function decode(buf) {
  let nonAscii = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) nonAscii++;
  let encoding = 'ascii';
  let text;
  if (nonAscii) {
    const utf8 = buf.toString('utf8');
    // valid UTF-8 round-trips; otherwise latin1 (every byte is a character)
    if (!utf8.includes('�') && Buffer.from(utf8, 'utf8').equals(buf)) (encoding = 'utf8'), (text = utf8);
    else (encoding = 'latin1'), (text = buf.toString('latin1'));
  } else text = buf.toString('latin1');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, encoding, nonAscii, crlf: /\r\n/.test(text) };
}

/** "$1,234.56" | "-$1.00" | "($1.00)" | "" -> number | null (cents exact). */
function money(s) {
  if (s === undefined || s === null) return null;
  let t = String(s).trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) (neg = true), (t = t.slice(1, -1));
  if (t.startsWith('-')) (neg = !neg), (t = t.slice(1));
  t = t.replace(/^\$/, '').replace(/,/g, '');
  if (t.startsWith('-')) (neg = !neg), (t = t.slice(1));
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const cents = Math.round(Number(t) * 100);
  return (neg ? -cents : cents) / 100;
}

/** "1/12/2024" (d/m/yyyy) -> "2024-12-01"; null when it is not a date. */
function dmyToIso(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.getUTCDate() === d ? iso : null;
}

const R = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const lines = (text) => String(text).split(/\r?\n/);

/**
 * Journal report -> { title, range, entries, grandTotal, unparsed, headerCount }.
 * entries: [{ seq, src, date (ISO), memo, lineNo, lines: [{ id, code, name, debit, credit, job, memo, card }] }]
 * unparsed: lines that are neither boilerplate, an entry header, an entry line, nor the grand total.
 */
function parseJournalReport(text) {
  const out = { title: null, range: null, entries: [], grandTotal: null, unparsed: [], headerCount: 0, columns: null };
  const all = lines(text);
  let cur = null;
  let col = null;
  for (let i = 0; i < all.length; i++) {
    const raw = all[i];
    const f = raw.split('\t');
    const lineNo = i + 1;
    if (!raw.trim()) continue;
    if (!col && /\bID#\t/.test(raw) && /Acct#/.test(raw)) {
      col = {};
      f.forEach((h, k) => {
        const key = h.trim();
        if (key === 'ID#') col.id = k;
        else if (key === 'Acct#') col.code = k;
        else if (key === 'Account Name') col.name = k;
        else if (key === 'Debit') col.debit = k;
        else if (key === 'Credit') col.credit = k;
        else if (key === 'Job No.') col.job = k;
        else if (key === 'Memo') col.memo = k;
        else if (key === 'Name') col.card = k;
      });
      out.columns = col;
      continue;
    }
    if (!col) {
      // preamble: company, address, title, range, print date/time
      const t = raw.trim();
      if (/ To \d/.test(t) && !out.range) {
        const m = t.match(/^(\d{1,2}\/\d{1,2}\/\d{4}) To (\d{1,2}\/\d{1,2}\/\d{4})$/);
        if (m) out.range = { from: dmyToIso(m[1]), to: dmyToIso(m[2]) };
      } else if (/Journal$/.test(t) && !out.title) out.title = t;
      continue;
    }
    if (/^[A-Z]{2}$/.test(f[0]) && dmyToIso(f[1])) {
      out.headerCount++;
      cur = { seq: out.entries.length, src: f[0], date: dmyToIso(f[1]), memo: f.slice(2).join('\t').trim(), lineNo, lines: [] };
      out.entries.push(cur);
      continue;
    }
    const gt = raw.match(/Grand Total:\t([^\t]*)\t([^\t]*)/);
    if (gt) {
      out.grandTotal = { debit: money(gt[1]), credit: money(gt[2]) };
      cur = null;
      continue;
    }
    if (f[0] === '' && f[1] === '' && col.code !== undefined && /^\d-\d{4}$/.test((f[col.code] || '').trim())) {
      if (!cur) {
        out.unparsed.push({ lineNo, text: raw, why: 'line before any entry header' });
        continue;
      }
      const debit = money(f[col.debit]) || 0;
      const credit = money(f[col.credit]) || 0;
      if (Number.isNaN(debit) || Number.isNaN(credit)) {
        out.unparsed.push({ lineNo, text: raw, why: 'amount not readable' });
        continue;
      }
      cur.lines.push({
        id: (f[col.id] || '').trim(),
        code: f[col.code].trim(),
        name: (f[col.name] || '').trim(),
        debit,
        credit,
        job: col.job !== undefined ? (f[col.job] || '').trim() : '',
        memo: col.memo !== undefined ? (f[col.memo] || '').trim() : '',
        card: col.card !== undefined ? (f[col.card] || '').trim() : '',
      });
      continue;
    }
    out.unparsed.push({ lineNo, text: raw, why: 'unrecognised line' });
  }
  return out;
}

/** Per entry: debit/credit sums and the ID(s) it carries. */
function entryTotals(e) {
  const dr = R(e.lines.reduce((a, l) => a + l.debit, 0));
  const cr = R(e.lines.reduce((a, l) => a + l.credit, 0));
  return { dr, cr, balanced: Math.abs(dr - cr) < 0.005, ids: [...new Set(e.lines.map((l) => l.id))] };
}

/** Net (debit - credit) of an entry on one account code. */
function netOn(e, code) {
  return R(e.lines.filter((l) => l.code === code).reduce((a, l) => a + l.debit - l.credit, 0));
}

/** Accounts List [Summary] -> [{ seq, name, balance }] in report order (no codes in this export). */
function parseAccountsList(text) {
  const rows = [];
  let started = false;
  for (const raw of lines(text)) {
    const f = raw.split('\t');
    if (!started) {
      if (f[1] && f[1].trim() === 'Account' && /Balance/.test(f[2] || '')) started = true;
      continue;
    }
    if (f[0] === '' && f.length >= 3 && f[1].trim() && /\$/.test(f[2])) rows.push({ seq: rows.length, name: f[1].trim(), balance: money(f[2]) });
  }
  return rows;
}

/** Our chart file "level|code|name|balance" -> [{ level, code, name, balance }]. */
function parseChartFile(text) {
  return lines(text)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [level, code, name, balance] = l.split('|');
      return { level: Number(level), code: code.trim(), name: name.trim(), balance: Number(balance) };
    });
}

/**
 * Supplier Payment History -> { rows, paymentTotals, unparsed }.
 * rows: [{ supplier, cheque, chqDate, po, date, supplierInv, purchaseTotal, applied, lineNo }]
 * paymentTotals: [{ supplier, cheque, total }] ("Total for Payment <cheque>:" lines, to cross-check the rows).
 */
function parseSupplierPaymentHistory(text) {
  const out = { rows: [], paymentTotals: [], unparsed: [] };
  let started = false;
  let supplier = null;
  const all = lines(text);
  for (let i = 0; i < all.length; i++) {
    const raw = all[i];
    if (!raw.trim()) continue;
    const f = raw.split('\t');
    if (!started) {
      if (/Cheque #/.test(raw) && /Amount Applied/.test(raw)) started = true;
      continue;
    }
    const tot = raw.match(/Total for Payment ([^:]+):\t([^\t]*)/);
    if (tot) {
      out.paymentTotals.push({ supplier, cheque: tot[1].trim(), total: money(tot[2]) });
      continue;
    }
    if (f[0] !== '' && f.length <= 2) {
      supplier = f[0].trim();
      continue;
    }
    if (f[0] === '' && dmyToIso(f[2]) && dmyToIso(f[4])) {
      out.rows.push({
        supplier,
        cheque: f[1].trim(),
        chqDate: dmyToIso(f[2]),
        po: f[3].trim(),
        date: dmyToIso(f[4]),
        supplierInv: (f[5] || '').trim(),
        purchaseTotal: money(f[6]),
        applied: money(f[f.length - 1]),
        lineNo: i + 1,
      });
      continue;
    }
    out.unparsed.push({ lineNo: i + 1, text: raw, why: 'unrecognised line' });
  }
  return out;
}

/** Natural sign of an ABSS account by its first digit: 1/5/6/9 debit-positive, 2/3/4/8 credit-positive. */
function naturalSign(code) {
  return /^[1569]/.test(code) ? 1 : -1;
}

/** "Invoice: 202412010001" POS number in a memo, if any. */
function posNumber(memo) {
  const m = String(memo || '').match(/Invoice:?\s*(\d{8,14})/i) || String(memo || '').match(/\((\d{12})\)/);
  return m ? m[1] : null;
}

/** Receipt channel from a Cash Receipts memo ("Received by Nets Pte Ltd", "FT; GrabCar Pte. Ltd", "Payment; Cash Sales"). */
function receiptChannel(memo) {
  const s = String(memo || '').toLowerCase();
  if (/grab/.test(s)) return 'GrabCar';
  if (/\bnets\b/.test(s)) return 'NETS';
  if (/paynow/.test(s)) return 'PayNow';
  if (/delivery hero|foodpanda/.test(s)) return 'Delivery Hero';
  if (/cash/.test(s)) return 'Cash';
  if (/transfer/.test(s)) return 'Transfer';
  return null;
}

module.exports = {
  decode,
  money,
  dmyToIso,
  parseJournalReport,
  entryTotals,
  netOn,
  parseAccountsList,
  parseChartFile,
  parseSupplierPaymentHistory,
  naturalSign,
  posNumber,
  receiptChannel,
  R,
};
