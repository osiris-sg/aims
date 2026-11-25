/**
 * ABSS (MYOB) report parsers for the tab-separated .txt exports (2026-11-25, WCT Racking history import).
 *
 * Every export is CRLF, tab-separated, Windows-1252 ("Non-ISO extended-ASCII"). Two quirks seen in the WCT Racking
 * files: byte 0x92 (cp1252 right single quote, e.g. "Captain’s Eye") and a stray CR glued to the end of some card
 * names ("KEMSA (Far East) Pte Ltd\r\t…"). decode() maps the bytes, splitLines() splits on CRLF only and strips the
 * stray CRs; both are reported as flags so the caller can list them.
 *
 * Parsers (pure, no I/O; each returns { ..., flags: [] }):
 *   parseJournal(text, src)        Sales & Receivables (SJ) / Purchases & Payables (PJ) / Cash Receipts (CR) /
 *                                  Cash Disbursements (CD) / General (GJ) journal -> entries with lines + Grand Total
 *   parseAccountsList(text)        Accounts List [Summary] -> [{ name, balance }] in printed order (no codes)
 *   parseCustomerLedger(text)      Customer Ledger -> cards with opening balance + transactions + totals
 *   parseInvoiceTransactions(text) Invoice Transactions [Accrual] -> invoices with their charges / payments
 *   parseClosedInvoices(text)      Customer Payments [Closed Invoices] -> cards with fully paid invoices
 *   parseSupplierPayments(text)    Supplier Payment History -> cards with cheques applied to purchases
 *   parseReconciliation(text)      Reconciliation Report -> per bank account: outstanding items + summary
 */

// cp1252 0x80-0x9F that differ from latin1 (only the printable ones ABSS can emit)
const CP1252 = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹',
  0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™',
  0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/** Buffer -> { text, oddChars: [{ byte, char, line }] }. Bytes >= 0x80 decode as cp1252 (latin1 above 0x9F). */
function decode(buf) {
  let out = '';
  const oddChars = [];
  let line = 1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0a) line++;
    if (b < 0x80) { out += String.fromCharCode(b); continue; }
    const ch = CP1252[b] || String.fromCharCode(b);
    oddChars.push({ byte: '0x' + b.toString(16), char: ch, line });
    out += ch;
  }
  return { text: out, oddChars };
}

/** CRLF (or LF) lines; a lone CR inside a line is dropped (counted in .strayCr). */
function splitLines(text) {
  const raw = text.split(/\r?\n/);
  let strayCr = 0;
  const lines = raw.map((l) => {
    const n = (l.match(/\r/g) || []).length;
    strayCr += n;
    return n ? l.replace(/\r/g, '') : l;
  });
  lines.strayCr = strayCr;
  return lines;
}

/** "$1,234.56" / "-$1,234.56" / "($1,234.56)" / "" -> number | null. Throws on garbage. */
function parseMoney(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return null;
  const m = t.match(/^(-)?\(?(-)?\$?(-)?([0-9,]*\.?[0-9]+)\)?$/);
  if (!m) throw new Error(`not money: "${t}"`);
  const neg = !!(m[1] || m[2] || m[3] || /^\(.*\)$/.test(t));
  const v = Number(m[4].replace(/,/g, ''));
  return Math.round((neg ? -v : v) * 100) / 100;
}

/** "d/m/yyyy" -> "yyyy-mm-dd" (null when not a date). */
function parseDate(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const R2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isCode = (s) => /^\d-\d{4}$/.test(String(s || '').trim());
const clean = (s) => String(s == null ? '' : s).replace(/\s+$/, '').replace(/^\s+/, '');
/** Name key for matching cards: lower case, ’ -> ', "pte. ltd." -> "pte ltd", punctuation / spacing folded. */
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
 * Journal export: an entry header `SRC\tdd/mm/yyyy\tmemo`, then lines `\t\tID#\tAcct#\tName\tDebit\tCredit\tJob[\t…PJ extras]`,
 * blank lines between entries, `\t\t\t\tGrand Total:\tDr\tCr` at the end.
 * @returns {{ src, entries: Array<{ src, seq, date, memo, id, lines: Array<{ id, code, name, dr, cr, job, linkedCustomer?, lineMemo?, cardName?, payee? }>, dr, cr }>, grandTotal, flags, strayCr }}
 */
function parseJournal(text, src) {
  const lines = splitLines(text);
  const flags = [];
  const entries = [];
  let cur = null;
  let grandTotal = null;
  const start = bodyStart(lines, /^\t\tID#\tAcct#/);
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const f = l.split('\t');
    if (f[0] === src && parseDate(f[1])) {
      cur = { src, seq: entries.length + 1, date: parseDate(f[1]), memo: clean(f.slice(2).join('\t')), id: null, lines: [], dr: 0, cr: 0, srcLine: i + 1 };
      entries.push(cur);
      continue;
    }
    if (f[0] === '' && /Grand Total:/.test(l)) {
      const k = f.findIndex((x) => /Grand Total:/.test(x));
      grandTotal = { dr: parseMoney(f[k + 1]), cr: parseMoney(f[k + 2]) };
      continue;
    }
    if (f[0] === '' && f[1] === '' && isCode(f[3])) {
      if (!cur) { flags.push({ kind: 'line-without-entry', line: i + 1, text: l }); continue; }
      let dr; let cr;
      try { dr = parseMoney(f[5]) || 0; cr = parseMoney(f[6]) || 0; } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); continue; }
      const ln = { id: clean(f[2]), code: f[3].trim(), name: clean(f[4]), dr, cr, job: clean(f[7]) || null };
      if (f.length > 8) Object.assign(ln, { linkedCustomer: clean(f[8]) || null, lineMemo: clean(f[9]) || null, cardName: clean(f[10]) || null, payee: clean(f[11]) || null });
      if (cur.id === null) cur.id = ln.id;
      else if (cur.id !== ln.id) flags.push({ kind: 'mixed-id-in-entry', line: i + 1, entry: cur.id, id: ln.id });
      cur.lines.push(ln);
      cur.dr = R2(cur.dr + dr);
      cur.cr = R2(cur.cr + cr);
      continue;
    }
    flags.push({ kind: 'unparsed-line', line: i + 1, text: l });
  }
  for (const e of entries) {
    if (!e.lines.length) flags.push({ kind: 'empty-entry', line: e.srcLine, memo: e.memo });
    if (Math.abs(e.dr - e.cr) > 0.005) flags.push({ kind: 'unbalanced-entry', line: e.srcLine, id: e.id, dr: e.dr, cr: e.cr });
  }
  const dr = R2(entries.reduce((a, e) => a + e.dr, 0));
  const cr = R2(entries.reduce((a, e) => a + e.cr, 0));
  if (!grandTotal) flags.push({ kind: 'no-grand-total' });
  else if (Math.abs(grandTotal.dr - dr) > 0.005 || Math.abs(grandTotal.cr - cr) > 0.005) flags.push({ kind: 'grand-total-mismatch', grandTotal, parsed: { dr, cr } });
  return { src, entries, grandTotal, parsed: { dr, cr }, flags, strayCr: lines.strayCr };
}

// ------------------------------------------------------------------ accounts list
/** Accounts List [Summary]: `\tName\t$balance` rows in printed (code) order. Codes are not printed. */
function parseAccountsList(text) {
  const lines = splitLines(text);
  const flags = [];
  const rows = [];
  let asAt = null;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].split('\t');
    if (!asAt && parseDate(f[0])) asAt = parseDate(f[0]);
    if (f[0] === '' && f.length >= 3 && f[1] && f[1] !== 'Account') {
      try { rows.push({ name: clean(f[1]), balance: parseMoney(f[2]), line: i + 1 }); } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: lines[i] }); }
    }
  }
  return { asAt, rows, flags, strayCr: lines.strayCr };
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
    const close = R2(c.opening + c.txns.reduce((a, t) => a + t.dr - t.cr, 0));
    c.closing = close;
    if (c.total && c.total.balance !== null && Math.abs(c.total.balance - close) > 0.005) flags.push({ kind: 'card-total-mismatch', card: c.name, printed: c.total.balance, computed: close });
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
      try { cur.invoices.push({ no: clean(f[1]), date: parseDate(f[2]), amount: parseMoney(f[3]) || 0, tax: parseMoney(f[4]) || 0, days: f[5] === '' ? null : Number(f[5]) }); } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); }
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
 * Supplier Payment History: card `Name` alone on a line, rows `\tCheque#\tChqDate\tPO#\tDate\tSupplierInv#\t$PurchaseTotal\t\t$Applied`,
 * `\t\t\t\t\t\t\tTotal for Payment X:\t$amount`.
 */
function parseSupplierPayments(text) {
  const lines = splitLines(text);
  const flags = [];
  const cards = [];
  let cur = null;
  const start = bodyStart(lines, /^\tCheque #\tChq Date/);
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const f = l.split('\t');
    if (f[0] && f.length === 1) { cur = { name: clean(f[0]), rows: [], totals: [] }; cards.push(cur); continue; }
    if (f[0] === '' && f[1] && parseDate(f[2])) {
      if (!cur) { flags.push({ kind: 'row-without-card', line: i + 1 }); continue; }
      try {
        cur.rows.push({ cheque: clean(f[1]), chqDate: parseDate(f[2]), po: clean(f[3]), date: parseDate(f[4]), supplierInv: clean(f[5]) || null, purchaseTotal: parseMoney(f[6]) || 0, applied: parseMoney(f[8]) || 0 });
      } catch (e) { flags.push({ kind: 'bad-amount', line: i + 1, text: l }); }
      continue;
    }
    const t = l.match(/Total for Payment ([^:]*):\t(\S+)/);
    if (t) { if (cur) cur.totals.push({ cheque: t[1].trim(), amount: parseMoney(t[2]) }); continue; }
    flags.push({ kind: 'unparsed-line', line: i + 1, text: l });
  }
  for (const c of cards) {
    for (const t of c.totals) {
      const s = R2(c.rows.filter((r) => r.cheque === t.cheque).reduce((a, r) => a + r.applied, 0));
      if (Math.abs(s - t.amount) > 0.005) flags.push({ kind: 'payment-total-mismatch', card: c.name, cheque: t.cheque, printed: t.amount, computed: s });
    }
  }
  return { cards, flags, strayCr: lines.strayCr };
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

module.exports = {
  decode, splitLines, parseMoney, parseDate, nameKey, R2,
  parseJournal, parseAccountsList, parseCustomerLedger, parseInvoiceTransactions, parseClosedInvoices, parseSupplierPayments, parseReconciliation,
};
