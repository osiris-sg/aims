/**
 * ABSS history import: the pure planning rules (no I/O) of scripts/wct-abss-history.ts, kept apart so node --test
 * covers them (scripts/__tests__/abss-history-plan.test.js). Entries / lines are the shapes of lib/abss-reports.js.
 *
 * Conventions (read back from the WCT (S) ABSS ledger on prod, batch abss-gl:wct-abss-2026-11-23):
 *   journalNumber  ABSS-<SRC>-<ABSS ID#>; the 2nd / 3rd entry under the same ID gets -2 / -3 (date order, then report order)
 *   type           SJ: INVOICE (AR up) / CREDIT_NOTE (AR down) / ADJUSTMENT (AR net 0: credit applications)
 *                  PJ: BILL (a supplier credit stays BILL, negative);  CR / CD: PAYMENT;  GJ: MANUAL
 */
'use strict';
const { entryTotals, netOn, R2: R, nameKey: cardKey } = require('./abss-reports');

/** Number every entry of one report. Returns [{ entry, id, n, journalNumber, mixedIds }] in report order. */
function numberEntries(src, entries) {
  const byId = new Map();
  for (const e of entries) {
    const ids = entryTotals(e).ids;
    const id = ids[0] || `NOID-${e.seq}`;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push({ e, mixedIds: ids.length > 1 ? ids : null });
  }
  const out = [];
  for (const [id, list] of byId) {
    list.sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.e.seq - b.e.seq));
    list.forEach((x, k) => out.push({ entry: x.e, id, n: k + 1, journalNumber: `ABSS-${src}-${id}${k ? `-${k + 1}` : ''}`, mixedIds: x.mixedIds }));
  }
  out.sort((a, b) => a.entry.seq - b.entry.seq);
  return out;
}

/** Journal type by source and the control-account movement. */
function journalType(src, entry, ctl) {
  if (src === 'SJ') {
    const ar = netOn(entry, ctl.ar);
    return ar > 0.004 ? 'INVOICE' : ar < -0.004 ? 'CREDIT_NOTE' : 'ADJUSTMENT';
  }
  if (src === 'PJ') return 'BILL';
  if (src === 'CR' || src === 'CD') return 'PAYMENT';
  return 'MANUAL';
}

/**
 * Allocate receipt amounts (and credits) to open sale items by AMOUNT MATCHING (used when ABSS's Invoice
 * Transactions export is not in hand: the Cash Receipts export carries the amount but not the invoice number):
 *   1 exact     an open item with exactly that open amount, dated on or before the receipt (earliest first)
 *   2 partial   the earliest open item dated on or before the receipt whose open amount covers it
 *   3 spread    across the earliest open items dated on or before the receipt (FIFO)
 *   4 unplaced  nothing open on or before the date: kept as an unallocated receipt amount (flag)
 * items: [{ key, date, gross, order? }] (mutated: open, paid[]);  payments: [{ ref, date, amount, channel }] in date order.
 */
function allocate(items, payments) {
  for (const it of items) {
    it.open = R(it.gross);
    it.paid = it.paid || [];
  }
  const sorted = [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.order ?? 0) - (b.order ?? 0)));
  const byAmt = new Map();
  for (const it of sorted) {
    const k = it.open.toFixed(2);
    if (!byAmt.has(k)) byAmt.set(k, []);
    byAmt.get(k).push(it);
  }
  const allocations = [];
  const unplaced = [];
  const rules = { exact: 0, partial: 0, spread: 0 };
  const take = (it, amount, p, rule) => {
    it.open = R(it.open - amount);
    it.paid.push({ ref: p.ref, date: p.date, amount: R(amount), channel: p.channel || null, rule });
    allocations.push({ ref: p.ref, key: it.key, amount: R(amount), rule });
  };
  for (const p of payments) {
    let left = R(p.amount);
    if (left <= 0) continue;
    const exact = (byAmt.get(left.toFixed(2)) || []).find((it) => it.open === left && it.date <= p.date);
    if (exact) { take(exact, left, p, 'exact'); rules.exact++; continue; }
    const cover = sorted.find((it) => it.open >= left - 1e-9 && it.open > 0 && it.date <= p.date);
    if (cover) { take(cover, left, p, 'partial'); rules.partial++; continue; }
    let spread = false;
    for (const it of sorted) {
      if (left <= 0) break;
      if (it.open <= 0 || it.date > p.date) continue;
      const a = Math.min(it.open, left);
      take(it, a, p, 'spread');
      left = R(left - a);
      spread = true;
    }
    if (spread) rules.spread++;
    if (left > 0.004) unplaced.push({ ref: p.ref, date: p.date, amount: left });
  }
  return { allocations, unplaced, rules };
}

/**
 * ABSS's REAL allocation from the Invoice Transactions export: every payment row (CR id + date + amount) under an
 * invoice number. items: [{ key, no, date, gross }] (mutated: open, paid[]); receipts: [{ ref, id, date }] (the CR
 * journals). A row whose receipt is not among the CR journals, or whose invoice has no item, is returned unplaced.
 */
function allocateFromInvoiceTransactions(items, invoices, receipts) {
  for (const it of items) { it.open = R(it.gross); it.paid = it.paid || []; }
  const byNo = new Map();
  for (const it of items) if (!byNo.has(it.no)) byNo.set(it.no, it); // the first part of a number takes ABSS's payments
  const rcpt = new Map();
  for (const r of receipts) rcpt.set(`${r.id}|${r.date}`, r);
  const rcptById = new Map();
  for (const r of receipts) rcptById.set(r.id, [...(rcptById.get(r.id) || []), r]);
  const allocations = [];
  const unplaced = [];
  for (const v of invoices) {
    for (const t of v.txns) {
      if (!(t.payment > 0) || t.src !== 'CR') continue;
      const r = rcpt.get(`${t.id}|${t.date}`) || ((rcptById.get(t.id) || []).length === 1 ? rcptById.get(t.id)[0] : null);
      const it = byNo.get(v.no);
      if (!r || !it) { unplaced.push({ ref: r ? r.ref : t.id, invoice: v.no, date: t.date, amount: t.payment, why: r ? 'invoice not imported' : 'receipt not in Cash Receipts' }); continue; }
      it.open = R(it.open - t.payment);
      it.paid.push({ ref: r.ref, date: t.date, amount: R(t.payment), rule: 'abss' });
      allocations.push({ ref: r.ref, key: it.key, amount: R(t.payment), rule: 'abss' });
    }
  }
  return { allocations, unplaced, rules: { abss: allocations.length } };
}

/** Loose party key for supplier matching (drops pte / ltd / co …; same rule as scripts/wct-abss-ap-opening.ts). */
function partyKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pte|private|ltd|limited|llp|sdn|bhd|co|company|inc|corp|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Same party? Keys equal, or (ABSS card lists cut names at ~38 characters and sometimes append a phone number) one
 * key, without trailing number groups, is a prefix of the other and at least 12 characters long.
 */
function sameName(a, b) {
  const strip = (k) => k.replace(/(\s\d{5,})+$/, '').trim();
  const x = strip(partyKey(a));
  const y = strip(partyKey(b));
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 12 && l.startsWith(s);
}

/** The existing record whose name is the same party: exact key first, then a unique prefix match. */
function findByName(name, records) {
  const k = partyKey(name);
  const exact = records.filter((r) => partyKey(r.name) === k);
  if (exact.length) return exact[0];
  const near = records.filter((r) => sameName(r.name, name));
  return near.length === 1 ? near[0] : null;
}

/** The app's code rule (suppliers.service / customers.service): <S|C> + first A-Z/0-9 + (max + 1), 3 digits. */
function nextCode(kind, name, taken) {
  const first = String(name || '').normalize('NFD').toUpperCase().match(/[A-Z0-9]/)?.[0] || 'X';
  const prefix = `${kind}${first}`;
  let max = 0;
  for (const c of taken) {
    const m = String(c).match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const code = `${prefix}${String(max + 1).padStart(3, '0')}`;
  taken.add(code);
  return code;
}

/**
 * ABSS's view of a ledger, per account code, signed Σ(debit - credit): balance-sheet accounts at their full balance;
 * P&L accounts only from `fyStart` (ABSS's current year; null = all, i.e. ABSS never closed a year); retained
 * earnings without the AIMS year-end closes dated from fyStart (ABSS has not closed those years yet).
 * lines: [{ code, dr, cr, date, close? }] (close = the line belongs to a year-end close journal).
 */
function abssView(lines, opts = {}) {
  const fy = opts.fyStart || null;
  const re = opts.retainedEarnings || '3-8000';
  const asAt = opts.asAt || null;
  const pnl = (c) => /^[4-9]/.test(c);
  const m = new Map();
  for (const l of lines) {
    if (asAt && l.date > asAt) continue;
    if (fy && pnl(l.code) && (l.date < fy || l.close)) continue;
    if (!fy && pnl(l.code) && l.close) continue;
    if (l.code === re && l.close && (!fy || l.date >= fy)) continue;
    m.set(l.code, R((m.get(l.code) || 0) + l.dr - l.cr));
  }
  return m;
}

/**
 * Trial balance vs the ABSS Accounts List. chart: [{ level, code, name }] in ABSS order; list: [{ name, balance }]
 * in the same order; signed: Map code -> Σ(debit - credit) (abssView). Header rows = the sum of the posting
 * accounts under them; 3-9000 Current Year Earnings = all P&L in the map (ABSS computes it).
 * Returns [{ code, name, level, header, abss, aims, diff, ok, nameOk }].
 */
function compareTrialBalance(chart, list, signed, opts = {}) {
  const cye = opts.currentYearEarnings || '3-9000';
  const isHeader = (i) => i + 1 < chart.length && chart[i + 1].level > chart[i].level;
  const nat = (code, v) => (/^[1569]/.test(code) ? 1 : -1) * v;
  const pnl = (code) => /^[4-9]/.test(code);
  const cyeValue = R([...signed.entries()].filter(([c]) => pnl(c)).reduce((a, [, v]) => a - v, 0));
  const value = (i) => {
    const row = chart[i];
    if (row.code === cye) return cyeValue;
    if (!isHeader(i)) return R(nat(row.code, signed.get(row.code) || 0));
    let s = 0;
    for (let j = i + 1; j < chart.length && chart[j].level > row.level; j++) {
      if (isHeader(j)) continue;
      const c = chart[j].code;
      s += c === cye ? cyeValue : nat(c, signed.get(c) || 0);
    }
    return R(s);
  };
  return chart.map((row, i) => {
    const l = list[i] || {};
    const aims = value(i);
    const abss = l.balance ?? null;
    const diff = abss === null ? null : R(aims - abss);
    return { code: row.code, name: row.name, level: row.level, header: isHeader(i), abss, aims, diff, ok: diff !== null && Math.abs(diff) < 0.005, nameOk: cardKey(l.name) === cardKey(row.name), listName: l.name ?? null };
  });
}

/**
 * Possible duplicates for finance (owner 2026-11-26: import as ABSS has them, list them). One row per entry in a
 * group; a group is flagged when, under DIFFERENT ABSS numbers or as a repeated number:
 *   same-reference  same source, same POS / supplier invoice number in the memo, same amount
 *   same-card-day   same source (SJ / PJ), same card, same date, same amount
 *   repeated-number the same ABSS ID# carries two or more entries (all -2 / -3 parts); "identical" when the lines match
 * entries: [{ jn, src, id, date, memo, card, amount, lines }]. Returns one row per entry: [{ group, why, jn, src, id, date, card, amount, memo, with }].
 */
function findDuplicates(entries, refOf) {
  const groups = [];
  const add = (why, list) => { if (list.length > 1) groups.push({ why, list }); };
  const by = (keyFn) => {
    const m = new Map();
    for (const e of entries) {
      const k = keyFn(e);
      if (!k) continue;
      m.set(k, [...(m.get(k) || []), e]);
    }
    return m;
  };
  for (const [k, v] of by((e) => (['SJ', 'PJ'].includes(e.src) && refOf(e) ? `${e.src}|${refOf(e)}|${e.amount.toFixed(2)}` : null))) if (new Set(v.map((x) => x.id)).size > 1) add(`same ${k.split('|')[0]} reference ${k.split('|')[1]} and amount under ${new Set(v.map((x) => x.id)).size} ABSS numbers`, v);
  for (const [, v] of by((e) => (['SJ', 'PJ'].includes(e.src) && (e.card || e.memo) ? `${e.src}|${e.date}|${e.amount.toFixed(2)}|${cardKey(e.card || e.memo)}` : null))) if (new Set(v.map((x) => x.id)).size > 1) add('same card, date and amount under different ABSS numbers', v);
  for (const [, v] of by((e) => `${e.src}|${e.id}`)) {
    if (v.length < 2) continue;
    const sig = v.map((x) => `${x.date}|${x.lines.map((l) => `${l.code}:${l.dr}:${l.cr}`).sort().join(',')}`);
    add(sig.length !== new Set(sig).size ? 'ABSS number used twice with identical lines (exact double entry?)' : `ABSS number used by ${v.length} entries (imported as -2 / -3)`, v);
  }
  // one row per entry; an entry caught by two rules carries both reasons and groups
  const byJn = new Map();
  groups.forEach((g, i) => {
    for (const e of g.list) {
      const r = byJn.get(e.jn) || { group: String(i + 1), why: g.why, jn: e.jn, src: e.src, id: e.id, date: e.date, card: e.card || '', amount: e.amount, memo: e.memo, with: '' };
      if (byJn.has(e.jn)) { r.group += ` ${i + 1}`; r.why += `; ${g.why}`; }
      const others = g.list.filter((x) => x.jn !== e.jn).map((x) => x.jn);
      r.with = [...new Set([...(r.with ? r.with.split(' ') : []), ...others])].join(' ');
      byJn.set(e.jn, r);
    }
  });
  return [...byJn.values()];
}

module.exports = { numberEntries, journalType, allocate, allocateFromInvoiceTransactions, partyKey, sameName, findByName, nextCode, abssView, compareTrialBalance, findDuplicates };
