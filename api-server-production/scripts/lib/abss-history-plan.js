/**
 * ABSS history import: pure planning steps (no I/O), shared by scripts/wct-abss-history-ymm.ts and its tests.
 *
 * Conventions reverse-engineered from the WCT (S) ABSS ledger on prod (batch abss-gl:wct-abss-2026-11-23):
 *   journalNumber  ABSS-<SRC>-<ABSS ID#>, the 2nd / 3rd entry under the same ID gets -2 / -3 (date order, then report order)
 *   reference      the ABSS ID#;  description "ABSS <SRC> <ID#> · <memo>";  line description = the memo (PJ: line memo)
 *   type           SJ: INVOICE (AR up) / CREDIT_NOTE (AR down) / ADJUSTMENT (AR net 0: credit applications)
 *                  PJ: BILL;  CR / CD: PAYMENT;  GJ: MANUAL
 */
'use strict';
const { entryTotals, netOn, R } = require('./abss-report-parse');

/** Number every entry of one report. Returns [{ entry, id, n, journalNumber, mixedIds }]. */
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
  // a supplier credit (AP down) stays BILL, as in WCT (S) (17 such ABSS-PJ journals there); the document says it is a credit
  if (src === 'PJ') return 'BILL';
  if (src === 'CR' || src === 'CD') return 'PAYMENT';
  if (src === 'GJ') return 'MANUAL';
  return 'MANUAL';
}

/**
 * Allocate receipt lines (and credits) to open sale items, oldest-first by rule. ABSS's Cash Receipts export carries
 * the amount applied per invoice but NOT the invoice number, so the pairing is inferred:
 *   1 exact     an open item with exactly that open amount, dated on or before the receipt (earliest first)
 *   2 partial   the earliest open item dated on or before the receipt whose open amount covers it
 *   3 spread    across the earliest open items dated on or before the receipt (FIFO)
 *   4 unplaced  nothing open on or before the date: kept as an unallocated receipt amount (flag)
 * items: [{ key, date, gross }] (mutated: open, paid[]);  payments: [{ ref, date, amount, channel }] in date order.
 * Returns { allocations: [{ ref, key, amount, rule }], unplaced: [{ ref, amount }] , rules: {exact,partial,spread} }.
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
    if (exact) {
      take(exact, left, p, 'exact');
      rules.exact++;
      continue;
    }
    const cover = sorted.find((it) => it.open >= left - 1e-9 && it.open > 0 && it.date <= p.date);
    if (cover) {
      take(cover, left, p, 'partial');
      rules.partial++;
      continue;
    }
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

/** Name key for supplier matching (same rule as scripts/wct-abss-ap-opening.ts nameKey). */
function nameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pte|private|ltd|limited|llp|sdn|bhd|co|company|inc|corp|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Same supplier? Name keys equal, or (ABSS card lists cut names at ~38 characters and sometimes append a phone number)
 * one key, without trailing number groups, is a prefix of the other and at least 12 characters long.
 */
function sameName(a, b) {
  const strip = (k) => k.replace(/(\s\d{5,})+$/, '').trim();
  const x = strip(nameKey(a));
  const y = strip(nameKey(b));
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 12 && l.startsWith(s);
}

/** The existing record whose name is the same supplier: exact key first, then a unique prefix match. */
function findByName(name, records) {
  const k = nameKey(name);
  const exact = records.filter((r) => nameKey(r.name) === k);
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
 * Trial balance vs the ABSS Accounts List. chart: [{ level, code, name }] in ABSS order; list: [{ name, balance }]
 * in the same order; signed: Map code -> Σ(debit - credit) in AIMS. Header rows = the sum of the posting accounts
 * under them (next rows with a deeper level); 3-9000 Current Year Earnings = all P&L (ABSS computes it).
 * Returns [{ code, name, level, header, abss, aims, diff, nameOk }].
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
      // sign of a child in its parent's section (an Equity header adds the computed CYE, same sign)
      s += c === cye ? cyeValue : nat(c, signed.get(c) || 0);
    }
    return R(s);
  };
  return chart.map((row, i) => {
    const l = list[i] || {};
    const aims = value(i);
    const abss = l.balance ?? null;
    return { code: row.code, name: row.name, level: row.level, header: isHeader(i), abss, aims, diff: abss === null ? null : R(aims - abss), nameOk: l.name === row.name, listName: l.name ?? null };
  });
}

module.exports = { numberEntries, journalType, allocate, nameKey, sameName, findByName, nextCode, compareTrialBalance };
