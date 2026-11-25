/**
 * ABSS (MYOB) report readers for the tab-separated .txt exports (WCT group full-history import, 2026-11-25/26).
 * Pure functions, no I/O: covered by scripts/__tests__/abss-reports.test.js (node --test). Used by
 * scripts/wct-abss-history.ts (--org racking | ymm). One reader per report type (merged from the two parallel
 * dry-run libs: the column-driven journal reader of the YMM run, the cp1252 decoding, stray-CR handling and the
 * ledger / invoice / reconciliation readers of the Racking run).
 *
 * Every export is CRLF, tab-separated. Plain ASCII, or Windows-1252 when a name has a special character (0x92 =
 * right quote in "Captain’s Eye"). Some card names carry a stray CR ("KEMSA (Far East) Pte Ltd\r\t…"): splitLines()
 * splits on CRLF only and drops lone CRs (counted in .strayCr) so the caller can report them.
 *
 *   decode(buf)                    bytes -> { text, encoding, oddChars, nonAscii, crlf }
 *   parseJournal(text, src?)       SJ / PJ / CR / CD / GJ journal -> entries with lines + Grand Total (column-driven)
 *   parseAccountsList(text)        Accounts List [Summary] -> { asAt, rows: [{ name, balance }] } (printed order, no codes)
 *   parseChartFile(text)           our chart file "level|code|name|balance" (_imports/wct/abss/<org>-coa-*.txt)
 *   parseCustomerLedger(text)      Customer Ledger -> cards with opening balance + transactions + closing
 *   parseInvoiceTransactions(text) Invoice Transactions [Accrual] -> invoices with their charges / payments
 *   parseClosedInvoices(text)      Customer Payments [Closed Invoices] -> cards with fully paid invoices
 *   parseSupplierPayments(text)    Supplier Payment History -> cards + flat rows (cheques applied to purchases)
 *   parseReconciliation(text)      Reconciliation Report -> per bank account: outstanding items + summary
 *   posNumber(memo), receiptChannel(memo), nameKey(s), entryTotals(e), netOn(e, code), naturalSign(code)
 */
'use strict';

// cp1252 0x80-0x9F that differ from latin1 (the printable ones ABSS can emit)
const CP1252 = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹',
  0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™',
  0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/**
 * Bytes -> text. Valid UTF-8 with non-ASCII bytes (incl. a BOM) decodes as UTF-8; otherwise every byte >= 0x80 is
 * Windows-1252 (latin1 above 0x9F). oddChars lists each non-ASCII character with its line, for the flags.
 */
function decode(buf) {
  let nonAscii = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) nonAscii++;
  const oddChars = [];
  let text;
  let encoding = 'ascii';
  if (nonAscii) {
    const utf8 = buf.toString('utf8');
    if (!utf8.includes('\uFFFD') && Buffer.from(utf8, 'utf8').equals(buf)) {
      encoding = 'utf8';
      text = utf8;
    } else {
      encoding = 'cp1252';
      let out = '';
      let line = 1;
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b === 0x0a) line++;
        if (b < 0x80) { out += String.fromCharCode(b); continue; }
        const ch = CP1252[b] || String.fromCharCode(b);
        oddChars.push({ byte: '0x' + b.toString(16), char: ch, line });
        out += ch;
      }
      text = out;
    }
  } else text = buf.toString('latin1');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, encoding, oddChars, nonAscii, crlf: /\r\n/.test(text) };
}

/** CRLF (or LF) lines; a lone CR inside a line is dropped (counted in .strayCr). */
function splitLines(text) {
  const raw = String(text).split(/\r?\n/);
  let strayCr = 0;
  const lines = raw.map((l) => {
    const n = (l.match(/\r/g) || []).length;
    strayCr += n;
    return n ? l.replace(/\r/g, '') : l;
  });
  lines.strayCr = strayCr;
  return lines;
}

/** "$1,234.56" / "-$1,234.56" / "$-1.00" / "($1,234.56)" / "" -> number (cents exact) | null. Throws on anything else. */
function parseMoney(s) {
  let t = String(s == null ? '' : s).trim();
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  t = t.replace(/^\$/, '').replace(/,/g, '');
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  if (!/^(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(t)) throw new Error(`not money: "${String(s).trim()}"`);
  const cents = Math.round(Number(t) * 100);
  return (neg ? -cents : cents) / 100;
}

/** "d/m/yyyy" -> "yyyy-mm-dd"; null when it is not a real date. */
function parseDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00Z`).getUTCDate() === d ? iso : null;
}

const R2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isCode = (s) => /^\d-\d{4}$/.test(String(s || '').trim());
const clean = (s) => String(s == null ? '' : s).trim();

/** Name key for matching cards: lower case, ’ -> ', & -> and, "pte. ltd." -> "pte ltd", punctuation / spacing folded. */
function nameKey(s) {
  return clean(s)
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\bpte\.?\s*ltd\.?/g, 'pte ltd')
    .replace(/\bprivate limited\b/g, 'pte ltd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Report header (company, address, title, date, page, time) ends at the column-heading line. */
function bodyStart(lines, headingRe) {
  const i = lines.findIndex((l) => headingRe.test(l));
  return i < 0 ? 0 : i + 1;
}

// ------------------------------------------------------------------ journals
/**
 * Journal export (column-driven: the heading row names the columns, so the Purchases layout with
 * "Linked Customer / Memo / Name / Payee" reads the same way as the plain one). An entry header is
 * `SRC\td/m/yyyy\tmemo` (memo may be missing), then lines `\t\tID#\tAcct#\tName\tDebit\tCredit\tJob No.[\t…]`,
 * blank lines between entries, `\t\t\t\tGrand Total:\tDr\tCr` at the end.
 * @returns {{ src, title, range, columns, entries: Array<{ src, seq, date, memo, id, lineNo, lines: Array<{ id, code, name,
 *   dr, cr, job, memo, card, linkedCustomer, payee }>, dr, cr }>, headerCount, grandTotal: {dr, cr}|null, parsed: {dr, cr}, flags, strayCr }}
 */
function parseJournal(text, src) {
  const all = splitLines(text);
  const out = { src: src || null, title: null, range: null, columns: null, entries: [], headerCount: 0, grandTotal: null, parsed: null, flags: [], strayCr: all.strayCr };
  let col = null;
  let cur = null;
  for (let i = 0; i < all.length; i++) {
    const raw = all[i];
    const lineNo = i + 1;
    if (!raw.trim()) continue;
    const f = raw.split('\t');
    if (!col) {
      if (/\bID#\t/.test(raw) && /Acct#/.test(raw)) {
        col = {};
        f.forEach((h, k) => {
          const key = h.trim();
          if (key === 'ID#') col.id = k;
          else if (key === 'Acct#') col.code = k;
          else if (key === 'Account Name') col.name = k;
          else if (key === 'Debit') col.debit = k;
          else if (key === 'Credit') col.credit = k;
          else if (key === 'Job No.') col.job = k;
          else if (key === 'Linked Customer') col.linkedCustomer = k;
          else if (key === 'Memo') col.memo = k;
          else if (key === 'Name') col.card = k;
          else if (key === 'Payee') col.payee = k;
        });
        if (col.debit === undefined) col.debit = col.code + 2;
        if (col.credit === undefined) col.credit = col.code + 3;
        out.columns = col;
        continue;
      }
      const t = raw.trim();
      const m = t.match(/^(\d{1,2}\/\d{1,2}\/\d{4}) To (\d{1,2}\/\d{1,2}\/\d{4})$/);
      if (m && !out.range) out.range = { from: parseDate(m[1]), to: parseDate(m[2]) };
      else if (/Journal$|Receipts$|Disbursements$/.test(t) && !out.title) out.title = t;
      continue;
    }
    if (/^[A-Z]{2}$/.test(f[0]) && parseDate(f[1]) && (!src || f[0] === src)) {
      out.headerCount++;
      cur = { src: f[0], seq: out.entries.length + 1, date: parseDate(f[1]), memo: clean(f.slice(2).join('\t')), id: null, lineNo, lines: [], dr: 0, cr: 0 };
      out.entries.push(cur);
      continue;
    }
    const gt = raw.match(/Grand Total:\t([^\t]*)\t([^\t]*)/);
    if (gt) {
      try { out.grandTotal = { dr: parseMoney(gt[1]) || 0, cr: parseMoney(gt[2]) || 0 }; } catch (e) { out.flags.push({ kind: 'bad-amount', line: lineNo, text: raw }); }
      cur = null;
      continue;
    }
    if (f[0] === '' && f[1] === '' && isCode(f[col.code])) {
      if (!cur) { out.flags.push({ kind: 'line-without-entry', line: lineNo, text: raw }); continue; }
      let dr;
      let cr;
      try { dr = parseMoney(f[col.debit]) || 0; cr = parseMoney(f[col.credit]) || 0; } catch (e) { out.flags.push({ kind: 'bad-amount', line: lineNo, text: raw }); continue; }
      const get = (k) => (col[k] !== undefined ? clean(f[col[k]]) : '');
      const ln = { id: get('id'), code: f[col.code].trim(), name: get('name'), dr, cr, job: get('job') || null, memo: get('memo') || null, card: get('card') || null, linkedCustomer: get('linkedCustomer') || null, payee: get('payee') || null };
      if (cur.id === null) cur.id = ln.id;
      else if (cur.id !== ln.id) out.flags.push({ kind: 'mixed-id-in-entry', line: lineNo, entry: cur.id, id: ln.id });
      cur.lines.push(ln);
      cur.dr = R2(cur.dr + dr);
      cur.cr = R2(cur.cr + cr);
      continue;
    }
    out.flags.push({ kind: 'unparsed-line', line: lineNo, text: raw });
  }
  for (const e of out.entries) {
    if (!e.lines.length) out.flags.push({ kind: 'empty-entry', line: e.lineNo, memo: e.memo });
    if (Math.abs(e.dr - e.cr) > 0.005) out.flags.push({ kind: 'unbalanced-entry', line: e.lineNo, id: e.id, dr: e.dr, cr: e.cr });
  }
  const dr = R2(out.entries.reduce((a, e) => a + e.dr, 0));
  const cr = R2(out.entries.reduce((a, e) => a + e.cr, 0));
  out.parsed = { dr, cr };
  if (!col) out.flags.push({ kind: 'no-column-heading' });
  if (!out.grandTotal) out.flags.push({ kind: 'no-grand-total' });
  else if (Math.abs(out.grandTotal.dr - dr) > 0.005 || Math.abs(out.grandTotal.cr - cr) > 0.005) out.flags.push({ kind: 'grand-total-mismatch', grandTotal: out.grandTotal, parsed: { dr, cr } });
  return out;
}

/** Per entry: debit / credit sums and the ID(s) it carries. */
function entryTotals(e) {
  const dr = R2(e.lines.reduce((a, l) => a + l.dr, 0));
  const cr = R2(e.lines.reduce((a, l) => a + l.cr, 0));
  return { dr, cr, balanced: Math.abs(dr - cr) < 0.005, ids: [...new Set(e.lines.map((l) => l.id))] };
}

/** Net (debit - credit) of an entry on one account code. */
function netOn(e, code) {
  return R2(e.lines.filter((l) => l.code === code).reduce((a, l) => a + l.dr - l.cr, 0));
}

// ------------------------------------------------------------------ accounts list / chart
/** Accounts List [Summary]: `\tName\t$balance` rows in printed (code) order. Codes are not printed. */
function parseAccountsList(text) {
  const lines = splitLines(text);
  const flags = [];
  const rows = [];
  let asAt = null;
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].split('\t');
    if (!asAt && parseDate(f[0])) asAt = parseDate(f[0]);
    if (!started) {
      if (f[1] && f[1].trim() === 'Account') started = true;
      continue;
    }
    if (f[0] === '' && f.length >= 3 && f[1] && f[1].trim()) {
      try { rows.push({ seq: rows.length, name: clean(f[1]), balance: parseMoney(f[2]), line: i + 1 }); } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: lines[i] }); }
    }
  }
  return { asAt, rows, flags, strayCr: lines.strayCr };
}

/** Our chart file "level|code|name|balance" -> [{ level, code, name, balance }] in ABSS order. */
function parseChartFile(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [level, code, name, balance] = l.split('|');
      return { level: Number(level), code: code.trim(), name: name.trim(), balance: balance === undefined ? null : Number(balance) };
    });
}

// ------------------------------------------------------------------ customer ledger
/**
 * Customer Ledger: card header `Name\t\t*None\t\t\t\t$opening`, rows `d/m/yyyy\tSrc\tID#\tMemo\tDebit\tCredit\tBalance`,
 * `\t\t\tTotal:\tDr\tCr\tBalance` closing each card.
 */
function parseCustomerLedger(text) {
  const lines = splitLines(text);
  const flags = [];
  const cards = [];
  let cur = null;
  const start = bodyStart(lines, /^Date\tSrc\tID#/);
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const f = l.split('\t');
    if (parseDate(f[0])) {
      if (!cur) { flags.push({ kind: 'row-without-card', line: i + 1 }); continue; }
      try {
        cur.txns.push({ date: parseDate(f[0]), src: clean(f[1]), id: clean(f[2]), memo: clean(f[3]), dr: parseMoney(f[4]) || 0, cr: parseMoney(f[5]) || 0, balance: parseMoney(f[6]) });
      } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); }
      continue;
    }
    if (f[0] === '' && /Total:/.test(l)) {
      const k = f.findIndex((x) => /Total:/.test(x));
      if (cur) cur.total = { dr: parseMoney(f[k + 1]) || 0, cr: parseMoney(f[k + 2]) || 0, balance: parseMoney(f[k + 3]) };
      continue;
    }
    if (f[0] && f[2] === '*None') {
      cur = { name: clean(f[0]), opening: parseMoney(f[f.length - 1]) || 0, txns: [], total: null, line: i + 1 };
      cards.push(cur);
      continue;
    }
    flags.push({ kind: 'unparsed-line', line: i + 1, text: l });
  }
  for (const c of cards) {
    c.closing = R2(c.opening + c.txns.reduce((a, t) => a + t.dr - t.cr, 0));
    if (c.total && c.total.balance !== null && Math.abs(c.total.balance - c.closing) > 0.005) flags.push({ kind: 'card-total-mismatch', card: c.name, printed: c.total.balance, computed: c.closing });
  }
  return { cards, flags, strayCr: lines.strayCr };
}

// ------------------------------------------------------------------ invoice transactions
/**
 * Invoice Transactions [Accrual]: invoice header `No\tCustomer\t*None`, rows `\tID#\tSrc\td/m/yyyy\tMemo\tAccount\tCharges\tPayments`,
 * `\t\t\t\t\t\tCharges\tPayments` totals.
 */
function parseInvoiceTransactions(text) {
  const lines = splitLines(text);
  const flags = [];
  const invoices = [];
  let cur = null;
  const start = bodyStart(lines, /^\tID#\tSrc\tDate/);
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const f = l.split('\t');
    if (f[0] && f[2] === '*None') {
      cur = { no: clean(f[0]), customer: clean(f[1]), txns: [], total: null, line: i + 1 };
      invoices.push(cur);
      continue;
    }
    if (f[0] === '' && f[1] && parseDate(f[3])) {
      if (!cur) { flags.push({ kind: 'row-without-invoice', line: i + 1 }); continue; }
      try {
        cur.txns.push({ id: clean(f[1]), src: clean(f[2]), date: parseDate(f[3]), memo: clean(f[4]), account: clean(f[5]), charge: parseMoney(f[6]) || 0, payment: parseMoney(f[7]) || 0 });
      } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); }
      continue;
    }
    if (f.slice(0, 6).every((x) => x === '') && f.length >= 8) {
      if (cur) cur.total = { charges: parseMoney(f[6]) || 0, payments: parseMoney(f[7]) || 0 };
      continue;
    }
    flags.push({ kind: 'unparsed-line', line: i + 1, text: l });
  }
  for (const v of invoices) {
    v.charges = R2(v.txns.reduce((a, t) => a + t.charge, 0));
    v.payments = R2(v.txns.reduce((a, t) => a + t.payment, 0));
    v.open = R2(v.charges - v.payments);
    if (v.total && (Math.abs(v.total.charges - v.charges) > 0.005 || Math.abs(v.total.payments - v.payments) > 0.005)) flags.push({ kind: 'invoice-total-mismatch', invoice: v.no });
  }
  return { invoices, flags, strayCr: lines.strayCr };
}

// ------------------------------------------------------------------ closed invoices
/** Customer Payments [Closed Invoices]: card `Name\t*None`, rows `\tNo\td/m/yyyy\t$amount\t$tax\tdays`, `\t\t\tTotal\tTax\tAvgDays`. */
function parseClosedInvoices(text) {
  const lines = splitLines(text);
  const flags = [];
  const cards = [];
  let cur = null;
  const start = bodyStart(lines, /^\tID#\tOrig Date/);
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const f = l.split('\t');
    if (f[0] && f[1] === '*None') { cur = { name: clean(f[0]), invoices: [], total: null }; cards.push(cur); continue; }
    if (f[0] === '' && f[1] && parseDate(f[2])) {
      if (!cur) { flags.push({ kind: 'row-without-card', line: i + 1 }); continue; }
      try { cur.invoices.push({ no: clean(f[1]), date: parseDate(f[2]), amount: parseMoney(f[3]) || 0, tax: parseMoney(f[4]) || 0, days: f[5] === '' || f[5] === undefined ? null : Number(f[5]) }); } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); }
      continue;
    }
    if (f[0] === '' && f[1] === '' && f[2] === '' && f[3]) { if (cur) cur.total = { amount: parseMoney(f[3]) || 0, tax: parseMoney(f[4]) || 0 }; continue; }
    flags.push({ kind: 'unparsed-line', line: i + 1, text: l });
  }
  for (const c of cards) {
    const s = R2(c.invoices.reduce((a, v) => a + v.amount, 0));
    if (c.total && Math.abs(c.total.amount - s) > 0.005) flags.push({ kind: 'card-total-mismatch', card: c.name, printed: c.total.amount, computed: s });
  }
  return { cards, flags, strayCr: lines.strayCr };
}

// ------------------------------------------------------------------ supplier payment history
/**
 * Supplier Payment History: card name alone on a line, rows `\tCheque#\tChqDate\tPO#\tDate\tSupplierInv#\t$PurchaseTotal\t\t$Applied`
 * (PO# / Date empty for purchases from before the ABSS conversion), `\t…\tTotal for Payment X:\t$amount`.
 * Returns { cards: [{ name, rows, totals }], rows (flat, with .supplier), paymentTotals: [{ supplier, cheque, total }], flags }.
 */
function parseSupplierPayments(text) {
  const lines = splitLines(text);
  const flags = [];
  const cards = [];
  const rows = [];
  const paymentTotals = [];
  let cur = null;
  const start = bodyStart(lines, /^\tCheque #\tChq Date/);
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const f = l.split('\t');
    const t = l.match(/Total for Payment ([^:]*):\t([^\t]*)/);
    if (t) {
      try {
        const tot = { cheque: t[1].trim(), amount: parseMoney(t[2]) };
        if (cur) cur.totals.push(tot);
        paymentTotals.push({ supplier: cur ? cur.name : null, cheque: tot.cheque, total: tot.amount });
      } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); }
      continue;
    }
    if (f[0] && f.length <= 2) { cur = { name: clean(f[0]), rows: [], totals: [] }; cards.push(cur); continue; }
    if (f[0] === '' && f[1] && parseDate(f[2])) {
      if (!cur) { flags.push({ kind: 'row-without-card', line: i + 1 }); continue; }
      try {
        const r = { supplier: cur.name, cheque: clean(f[1]), chqDate: parseDate(f[2]), po: clean(f[3]), date: parseDate(f[4]), supplierInv: clean(f[5]) || null, purchaseTotal: parseMoney(f[6]), applied: parseMoney(f[f.length - 1]) || 0, line: i + 1 };
        cur.rows.push(r);
        rows.push(r);
      } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); }
      continue;
    }
    flags.push({ kind: 'unparsed-line', line: i + 1, text: l });
  }
  for (const c of cards) {
    for (const t of c.totals) {
      const s = R2(c.rows.filter((r) => r.cheque === t.cheque).reduce((a, r) => a + r.applied, 0));
      if (Math.abs(s - t.amount) > 0.005) flags.push({ kind: 'payment-total-mismatch', card: c.name, cheque: t.cheque, printed: t.amount, computed: s });
    }
  }
  return { cards, rows, paymentTotals, flags, strayCr: lines.strayCr };
}

// ------------------------------------------------------------------ reconciliation report
/** Reconciliation Report: per `Cheque Account:\tcode\tname` block, outstanding cheques / deposits and the summary lines. */
function parseReconciliation(text) {
  const lines = splitLines(text);
  const flags = [];
  const accounts = [];
  let cur = null;
  let section = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const f = l.split('\t');
    if (f[0] === 'Cheque Account:') { cur = { code: clean(f[1]), name: clean(f[2]), cheques: [], deposits: [], summary: {} }; accounts.push(cur); section = null; continue; }
    if (!cur) continue;
    if (f[0] === 'Date of Bank Statement:') { cur.statementDate = parseDate(f[1]); continue; }
    if (/^Outstanding Cheques/.test(f[0])) { section = 'cheques'; continue; }
    if (/^Outstanding Deposits/.test(f[0])) { section = 'deposits'; continue; }
    if (/^Reconciliation/.test(f[0])) { section = 'summary'; continue; }
    if (f[0] && parseDate(f[1]) && section && section !== 'summary') {
      try { cur[section].push({ id: clean(f[0]), date: parseDate(f[1]), memo: clean(f[2]), deposit: parseMoney(f[3]) || 0, withdrawal: parseMoney(f[4]) || 0 }); } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); }
      continue;
    }
    if (f[0] === '' && /Total:/.test(l) && section && section !== 'summary') {
      const k = f.findIndex((x) => /Total:/.test(x));
      cur[`${section}Total`] = { deposit: parseMoney(f[k + 1]) || 0, withdrawal: parseMoney(f[k + 2]) || 0 };
      continue;
    }
    if (section === 'summary' && f[0] === '') {
      const k = f.findIndex((x) => x.trim());
      if (k >= 0) cur.summary[f[k].replace(/\s+/g, ' ').replace(/:$/, '').trim()] = parseMoney(f[k + 1]);
      continue;
    }
    flags.push({ kind: 'unparsed-line', line: i + 1, text: l });
  }
  for (const a of accounts) {
    const w = R2(a.cheques.reduce((s, x) => s + x.withdrawal - x.deposit, 0));
    const d = R2(a.deposits.reduce((s, x) => s + x.deposit - x.withdrawal, 0));
    if (a.chequesTotal && Math.abs(a.chequesTotal.withdrawal - a.chequesTotal.deposit - w) > 0.005) flags.push({ kind: 'cheques-total-mismatch', account: a.code, printed: a.chequesTotal, computed: w });
    if (a.depositsTotal && Math.abs(a.depositsTotal.deposit - a.depositsTotal.withdrawal - d) > 0.005) flags.push({ kind: 'deposits-total-mismatch', account: a.code, printed: a.depositsTotal, computed: d });
    a.outstandingCheques = w;
    a.outstandingDeposits = d;
  }
  return { accounts, flags, strayCr: lines.strayCr };
}

// ------------------------------------------------------------------ memo helpers
/** Natural sign of an ABSS account by its first digit: 1/5/6/9 debit-positive, 2/3/4/8 credit-positive. */
function naturalSign(code) {
  return /^[1569]/.test(code) ? 1 : -1;
}

/** The POS / supplier invoice number in a memo ("Sales for BHOP (Invoice: 202412010001)"), if any. */
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
  decode, splitLines, parseMoney, parseDate, nameKey, R2, entryTotals, netOn, naturalSign, posNumber, receiptChannel,
  parseJournal, parseAccountsList, parseChartFile, parseCustomerLedger, parseInvoiceTransactions, parseClosedInvoices,
  parseSupplierPayments, parseReconciliation,
};
