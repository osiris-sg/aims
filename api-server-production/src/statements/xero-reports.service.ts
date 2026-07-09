import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

// Xero-parity AR/AP reports: Aged Summary/Detail, Invoice Summary, Contact
// Transactions, Income & Expenses by Contact. All read the Document table
// (INVOICE for AR, BILL for AP) + Payment/BillPayment — same sources as the
// SOA/aging in statements.service.ts.
//
// Outstanding-per-document rule (fixes the xeroBalance-only blind spot):
//   outstanding = config.xeroBalance   when present (Xero-imported docs)
//               = gross − Σ payments   otherwise (AIMS-native docs)

export type Side = 'receivable' | 'payable';

const R = (n: number) => Math.round(n * 100) / 100;

interface DocRow {
  id: string;
  number: string;
  contactId: string;
  contactName: string;
  date: Date;
  dueDate: Date | null;
  reference: string;
  gross: number; // BASE currency
  net: number; // BASE, excluding GST — Xero's income/expense analysis basis
  paid: number; // BASE payments + credits applied
  outstanding: number; // BASE
  lastPaymentDate: Date | null;
  status: string;
  source: string;
  // Multi-currency: trading currency + face amounts (null when base-currency doc)
  currency: string | null;
  foreignGross: number | null;
  foreignOutstanding: number | null;
}

@Injectable()
export class XeroReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Shared document scan: normalized per-document rows for one side.
  // ------------------------------------------------------------------
  private async scanDocs(organizationId: string, side: Side, opts?: { paymentsUpTo?: Date }): Promise<DocRow[]> {
    const isAR = side === 'receivable';
    const [docs, setting] = await Promise.all([
      this.prisma.document.findMany({
        where: { organizationId, type: isAR ? 'INVOICE' : 'BILL' },
        select: { id: true, name: true, type: true, status: true, createdAt: true, config: true },
      }),
      this.prisma.accountingSetting.findUnique({
        where: { organizationId },
        select: { baseCurrency: true, currencyRates: true },
      }),
    ]);
    const baseCurrency = setting?.baseCurrency || 'SGD';
    const fxRates = (setting?.currencyRates as Record<string, number> | null) ?? {};

    // Payments keyed by document id (AR: Payment.documentId, AP: BillPayment.billId).
    const payByDoc = new Map<string, { total: number; last: Date | null }>();
    if (isAR) {
      const pays = await this.prisma.payment.findMany({
        where: { organizationId, ...(opts?.paymentsUpTo ? { paymentDate: { lte: opts.paymentsUpTo } } : {}) },
        select: { documentId: true, amount: true, paymentDate: true },
      });
      for (const p of pays) {
        const e = payByDoc.get(p.documentId) || { total: 0, last: null };
        e.total += p.amount;
        if (!e.last || p.paymentDate > e.last) e.last = p.paymentDate;
        payByDoc.set(p.documentId, e);
      }
    } else {
      const pays = await this.prisma.billPayment.findMany({
        where: { organizationId, ...(opts?.paymentsUpTo ? { paymentDate: { lte: opts.paymentsUpTo } } : {}) },
        select: { billId: true, amount: true, paymentDate: true },
      });
      for (const p of pays) {
        const e = payByDoc.get(p.billId) || { total: 0, last: null };
        e.total += p.amount;
        if (!e.last || p.paymentDate > e.last) e.last = p.paymentDate;
        payByDoc.set(p.billId, e);
      }
    }

    const rows: DocRow[] = [];
    for (const doc of docs) {
      const c: any = doc.config || {};
      if (c.voided) continue;
      let gross = R(Number(c.xeroGross ?? c.nettTotal ?? c.totalAmount ?? c.summary?.grandTotal ?? 0));
      if (gross <= 0.005) continue;
      // Net (excl GST): imported invoices carry `subtotal`+`taxAmount`, bills
      // carry `xeroTax`; native docs carry `subTotal`. Fall back to gross.
      const tax = Number(c.taxAmount ?? c.xeroTax ?? c.gstAmount ?? 0);
      let net = R(Number(c.subtotal ?? c.subTotal ?? (tax ? gross - tax : gross)));
      const contactId = isAR ? (c.customerId || c.customer?.id) : (c.supplierId || c.supplier?.id);
      if (!contactId) continue;
      const contactName = (isAR ? (c.customerName || c.customer?.name) : (c.supplierName || c.supplier?.name)) || 'Unknown';
      const date = c.date ? new Date(c.date) : doc.createdAt;
      const dueDate = c.dueDate ? new Date(c.dueDate) : null;
      const payInfo = payByDoc.get(doc.id);
      const recordedPaid = R(payInfo?.total ?? 0);
      let outstanding: number;
      let paid: number;
      if (c.xeroBalance !== undefined && c.xeroBalance !== null) {
        outstanding = R(Number(c.xeroBalance));
        // AIMS payments recorded after import reduce it further.
        outstanding = R(Math.max(0, outstanding - recordedPaid));
        paid = R(gross - outstanding);
      } else {
        paid = recordedPaid;
        outstanding = R(Math.max(0, gross - paid));
      }
      // Multi-currency: face amounts are in the doc's trading currency —
      // convert to base at the standing rate so report totals stay coherent.
      const docCurrency = String(c.currency || baseCurrency).toUpperCase();
      const isForeign = docCurrency !== baseCurrency;
      const fxRate = isForeign ? Number(fxRates[docCurrency]) || 1 : 1;
      const foreignGross = isForeign ? gross : null;
      const foreignOutstanding = isForeign ? outstanding : null;
      if (isForeign) {
        gross = R(gross * fxRate);
        net = R(net * fxRate);
        paid = R(paid * fxRate);
        outstanding = R(outstanding * fxRate);
      }

      rows.push({
        id: doc.id,
        number: doc.name || '(no #)',
        contactId,
        contactName,
        date,
        dueDate,
        reference: c.reference || c.xeroReference || '',
        gross,
        net,
        paid,
        outstanding,
        lastPaymentDate: payInfo?.last ?? null,
        status: doc.status || (outstanding <= 0.005 ? 'paid' : 'outstanding'),
        source: isAR ? 'Receivable Invoice' : 'Payable Invoice',
        currency: isForeign ? docCurrency : null,
        foreignGross,
        foreignOutstanding,
      });
    }

    // Docs saved with only a flat contact id (e.g. recurring-generated
    // invoices) have no name in config — resolve from the contact master.
    const unknownIds = [...new Set(rows.filter((r) => r.contactName === 'Unknown').map((r) => r.contactId))];
    if (unknownIds.length) {
      const found = isAR
        ? await this.prisma.customer.findMany({ where: { id: { in: unknownIds } }, select: { id: true, name: true } })
        : await this.prisma.supplier.findMany({ where: { id: { in: unknownIds } }, select: { id: true, name: true } });
      const nameById = new Map(found.map((f) => [f.id, f.name]));
      for (const r of rows) {
        if (r.contactName === 'Unknown' && nameById.has(r.contactId)) r.contactName = nameById.get(r.contactId)!;
      }
    }
    return rows;
  }

  // ------------------------------------------------------------------
  // Aged report — summary (per contact) or detail (per document).
  // Buckets: Current (not yet due) + N periods of periodDays + Older.
  // ------------------------------------------------------------------
  async aged(
    organizationId: string,
    side: Side,
    opts: { asOf?: string; periods?: number; periodDays?: number; ageingBy?: 'dueDate' | 'documentDate'; level?: 'summary' | 'detail' },
  ) {
    const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
    const periods = Math.min(Math.max(opts.periods ?? 4, 1), 12);
    const periodDays = Math.min(Math.max(opts.periodDays ?? 30, 7), 120);
    const ageingBy = opts.ageingBy === 'documentDate' ? 'documentDate' : 'dueDate';
    const level = opts.level === 'detail' ? 'detail' : 'summary';

    const docs = (await this.scanDocs(organizationId, side, { paymentsUpTo: asOf })).filter(
      (d) => d.outstanding > 0.005 && d.date <= asOf,
    );

    // bucketIndex: 0 = Current (age <= 0), 1..periods = aged periods, periods+1 = Older
    const bucketOf = (d: DocRow) => {
      const ref = ageingBy === 'dueDate' ? (d.dueDate ?? d.date) : d.date;
      const age = Math.floor((asOf.getTime() - ref.getTime()) / 86400000);
      if (age <= 0) return 0;
      const idx = Math.ceil(age / periodDays);
      return idx <= periods ? idx : periods + 1;
    };

    const bucketLabels = [
      'Current',
      ...Array.from({ length: periods }, (_, i) => (i === 0 ? `< 1 ${this.periodLabel(periodDays)}` : `${i} ${this.periodLabel(periodDays, i > 1)}`)),
      'Older',
    ];

    const nBuckets = periods + 2;
    if (level === 'summary') {
      const byContact = new Map<string, { name: string; buckets: number[]; total: number; currency: string | null; foreignTotal: number }>();
      for (const d of docs) {
        const e = byContact.get(d.contactId) || { name: d.contactName, buckets: Array(nBuckets).fill(0), total: 0, currency: null, foreignTotal: 0 };
        e.buckets[bucketOf(d)] += d.outstanding;
        e.total += d.outstanding;
        if (d.currency) {
          e.currency = d.currency; // one currency per customer code (master-file rule)
          e.foreignTotal += d.foreignOutstanding ?? 0;
        }
        byContact.set(d.contactId, e);
      }
      const rows = [...byContact.entries()]
        .map(([contactId, e]) => ({ contactId, contactName: e.name, buckets: e.buckets.map(R), total: R(e.total), currency: e.currency, foreignTotal: e.currency ? R(e.foreignTotal) : null }))
        .sort((a, b) => a.contactName.localeCompare(b.contactName));
      const totals = Array(nBuckets).fill(0);
      let grand = 0;
      for (const r of rows) {
        r.buckets.forEach((v, i) => (totals[i] += v));
        grand += r.total;
      }
      return {
        success: true,
        data: {
          asOf: asOf.toISOString(),
          ageingBy,
          bucketLabels,
          rows,
          totals: totals.map(R),
          grandTotal: R(grand),
        },
      };
    }

    // detail: group by contact, one row per document
    const byContact = new Map<string, { name: string; docs: any[]; buckets: number[]; total: number }>();
    for (const d of docs) {
      const e = byContact.get(d.contactId) || { name: d.contactName, docs: [], buckets: Array(nBuckets).fill(0), total: 0 };
      const b = bucketOf(d);
      const bucketAmounts = Array(nBuckets).fill(0);
      bucketAmounts[b] = d.outstanding;
      e.docs.push({
        id: d.id,
        number: d.number,
        date: d.date.toISOString(),
        dueDate: d.dueDate?.toISOString() ?? null,
        reference: d.reference,
        buckets: bucketAmounts.map(R),
        total: R(d.outstanding),
        currency: d.currency,
        foreignTotal: d.foreignOutstanding,
      });
      e.buckets[b] += d.outstanding;
      e.total += d.outstanding;
      byContact.set(d.contactId, e);
    }
    const groups = [...byContact.entries()]
      .map(([contactId, e]) => ({
        contactId,
        contactName: e.name,
        docs: e.docs.sort((a: any, b: any) => a.date.localeCompare(b.date)),
        subtotals: e.buckets.map(R),
        total: R(e.total),
      }))
      .sort((a, b) => a.contactName.localeCompare(b.contactName));
    const totals = Array(nBuckets).fill(0);
    let grand = 0;
    for (const g of groups) {
      g.subtotals.forEach((v: number, i: number) => (totals[i] += v));
      grand += g.total;
    }
    return {
      success: true,
      data: { asOf: asOf.toISOString(), ageingBy, bucketLabels, groups, totals: totals.map(R), grandTotal: R(grand) },
    };
  }

  private periodLabel(periodDays: number, plural = false) {
    if (periodDays === 30 || periodDays === 31) return plural ? 'Months' : 'Month';
    if (periodDays === 7) return plural ? 'Weeks' : 'Week';
    return `× ${periodDays} days`;
  }

  // ------------------------------------------------------------------
  // Invoice report — per-document listing (summary) or per-line-item
  // listing (detail, Xero's "Receivable/Payable Invoice Detail").
  // status: all | outstanding | paid
  // ------------------------------------------------------------------
  async invoiceReport(
    organizationId: string,
    side: Side,
    opts: { from?: string; to?: string; dateBasis?: 'documentDate' | 'dueDate'; status?: 'all' | 'outstanding' | 'paid'; level?: 'summary' | 'detail' },
  ) {
    const from = opts.from ? new Date(opts.from) : new Date(0);
    const to = opts.to ? new Date(opts.to) : new Date();
    const dateBasis = opts.dateBasis === 'dueDate' ? 'dueDate' : 'documentDate';
    const status = opts.status ?? 'all';
    const level = opts.level === 'detail' ? 'detail' : 'summary';

    let docs = (await this.scanDocs(organizationId, side)).filter((d) => {
      const ref = dateBasis === 'dueDate' ? (d.dueDate ?? d.date) : d.date;
      return ref >= from && ref <= to;
    });
    if (status === 'outstanding') docs = docs.filter((d) => d.outstanding > 0.005);
    if (status === 'paid') docs = docs.filter((d) => d.outstanding <= 0.005);

    if (level === 'detail') return this.invoiceDetailReport(organizationId, side, docs, { from, to, dateBasis, status });

    const byContact = new Map<string, { name: string; docs: any[]; gross: number; paid: number; balance: number }>();
    for (const d of docs) {
      const e = byContact.get(d.contactId) || { name: d.contactName, docs: [], gross: 0, paid: 0, balance: 0 };
      e.docs.push({
        id: d.id,
        number: d.number,
        date: d.date.toISOString(),
        dueDate: d.dueDate?.toISOString() ?? null,
        lastPaymentDate: d.lastPaymentDate?.toISOString() ?? null,
        reference: d.reference,
        gross: d.gross,
        paid: d.paid,
        balance: d.outstanding,
        source: d.source,
        status: d.outstanding <= 0.005 ? 'Paid' : d.status === 'confirmed' ? 'Approved' : d.status.charAt(0).toUpperCase() + d.status.slice(1),
        currency: d.currency,
        foreignGross: d.foreignGross,
        foreignBalance: d.foreignOutstanding,
      });
      e.gross += d.gross;
      e.paid += d.paid;
      e.balance += d.outstanding;
      byContact.set(d.contactId, e);
    }
    const groups = [...byContact.entries()]
      .map(([contactId, e]) => ({
        contactId,
        contactName: e.name,
        docs: e.docs.sort((a: any, b: any) => a.date.localeCompare(b.date)),
        subtotals: { gross: R(e.gross), paid: R(e.paid), balance: R(e.balance) },
      }))
      .sort((a, b) => a.contactName.localeCompare(b.contactName));
    const totals = groups.reduce(
      (s, g) => ({ gross: s.gross + g.subtotals.gross, paid: s.paid + g.subtotals.paid, balance: s.balance + g.subtotals.balance }),
      { gross: 0, paid: 0, balance: 0 },
    );
    return {
      success: true,
      data: {
        period: { from: from.toISOString(), to: to.toISOString() },
        dateBasis,
        status,
        groups,
        totals: { gross: R(totals.gross), paid: R(totals.paid), balance: R(totals.balance) },
        documentCount: docs.length,
      },
    };
  }

  // Line-item level detail. Bills' imported items carry amount=gross incl
  // taxAmount; native editor/recurring items carry amount=net + tax %. Docs
  // whose items are empty/zero (e.g. Xero invoice import kept no lines) get
  // one synthesized line from the document totals.
  private async invoiceDetailReport(
    organizationId: string,
    side: Side,
    docs: DocRow[],
    period: { from: Date; to: Date; dateBasis: string; status: string },
  ) {
    const configs = await this.prisma.document.findMany({
      where: { id: { in: docs.map((d) => d.id) } },
      select: { id: true, config: true },
    });
    const cfgById = new Map(configs.map((c) => [c.id, c.config as any]));

    type Line = {
      docId: string; date: string; source: string; reference: string; itemCode: string;
      description: string; quantity: number; unitPrice: number; tax: number; gross: number;
      invoiceTotal: number; status: string;
    };
    const byContact = new Map<string, { name: string; lines: Line[]; qty: number; tax: number; gross: number }>();

    for (const d of docs) {
      const c: any = cfgById.get(d.id) || {};
      const rawItems: any[] = Array.isArray(c.items) ? c.items : [];
      const usable = rawItems.filter((it) => {
        const amt = Number(it?.amount) || (Number(it?.quantity) || 0) * (Number(it?.unitPrice) || 0);
        return amt > 0.005;
      });
      const lines: Line[] = [];
      const statusLabel = d.outstanding <= 0.005 ? 'Paid' : (d.status === 'confirmed' ? 'Approved' : d.status.charAt(0).toUpperCase() + d.status.slice(1));
      if (usable.length) {
        for (const it of usable) {
          const qty = Number(it.quantity) || 1;
          const unitPrice = Number(it.unitPrice) || 0;
          const amount = Number(it.amount) || qty * unitPrice;
          let tax: number;
          let gross: number;
          if (it.taxAmount !== undefined && it.taxAmount !== null) {
            tax = R(Number(it.taxAmount));
            gross = R(amount); // importer convention: amount includes tax
          } else {
            tax = R(amount * ((Number(it.tax) || 0) / 100));
            gross = R(amount + tax);
          }
          lines.push({
            docId: d.id, date: d.date.toISOString(), source: d.source, reference: d.reference || d.number,
            itemCode: it.itemCode || it.sku || '', description: it.description || '', quantity: qty,
            unitPrice: R(unitPrice), tax, gross, invoiceTotal: d.gross, status: statusLabel,
          });
        }
      } else {
        lines.push({
          docId: d.id, date: d.date.toISOString(), source: d.source, reference: d.reference || d.number,
          itemCode: '', description: c.reference || d.number, quantity: 1,
          unitPrice: d.net, tax: R(d.gross - d.net), gross: d.gross, invoiceTotal: d.gross, status: statusLabel,
        });
      }
      const e = byContact.get(d.contactId) || { name: d.contactName, lines: [], qty: 0, tax: 0, gross: 0 };
      for (const l of lines) {
        e.lines.push(l);
        e.qty += l.quantity;
        e.tax += l.tax;
        e.gross += l.gross;
      }
      byContact.set(d.contactId, e);
    }

    const groups = [...byContact.entries()]
      .map(([contactId, e]) => ({
        contactId,
        contactName: e.name,
        lines: e.lines.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference)),
        subtotals: { quantity: R(e.qty), tax: R(e.tax), gross: R(e.gross) },
      }))
      .sort((a, b) => a.contactName.localeCompare(b.contactName));
    const totals = groups.reduce(
      (s, g) => ({ quantity: s.quantity + g.subtotals.quantity, tax: s.tax + g.subtotals.tax, gross: s.gross + g.subtotals.gross }),
      { quantity: 0, tax: 0, gross: 0 },
    );
    return {
      success: true,
      data: {
        period: { from: period.from.toISOString(), to: period.to.toISOString() },
        dateBasis: period.dateBasis,
        status: period.status,
        level: 'detail',
        groups,
        totals: { quantity: R(totals.quantity), tax: R(totals.tax), gross: R(totals.gross) },
        lineCount: groups.reduce((s, g) => s + g.lines.length, 0),
      },
    };
  }

  // ------------------------------------------------------------------
  // Contact Transactions — Summary: opening / movement / closing for one
  // contact over a period, receivables and payables sections.
  // ------------------------------------------------------------------
  async contactTransactions(
    organizationId: string,
    opts: { contactType: 'customer' | 'supplier'; contactId: string; from?: string; to?: string },
  ) {
    const from = opts.from ? new Date(opts.from) : new Date(0);
    const to = opts.to ? new Date(opts.to) : new Date();
    const side: Side = opts.contactType === 'supplier' ? 'payable' : 'receivable';
    const isAR = side === 'receivable';

    const contact = isAR
      ? await this.prisma.customer.findFirst({ where: { id: opts.contactId, organizationId }, select: { id: true, name: true } })
      : await this.prisma.supplier.findFirst({ where: { id: opts.contactId, organizationId }, select: { id: true, name: true } });
    if (!contact) throw new HttpException('Contact not found', HttpStatus.NOT_FOUND);

    // Balance = Σ outstanding effect over time: +gross at doc date, −payment at payment date.
    const docs = (await this.scanDocs(organizationId, side)).filter((d) => d.contactId === opts.contactId);

    let opening = 0;
    let invoiced = 0; // movement: new documents in period
    let settled = 0; // movement: payments/credits in period
    for (const d of docs) {
      if (d.date < from) {
        opening += d.gross;
      } else if (d.date <= to) {
        invoiced += d.gross;
      }
    }
    // Payments: AR from Payment table (+ implied settlements on imported docs
    // dated at the doc date), AP from BillPayment (+ implied on import).
    if (isAR) {
      const pays = await this.prisma.payment.findMany({
        where: { organizationId, customerId: opts.contactId },
        select: { amount: true, paymentDate: true },
      });
      for (const p of pays) {
        if (p.paymentDate < from) opening -= p.amount;
        else if (p.paymentDate <= to) settled += p.amount;
      }
    } else {
      const pays = await this.prisma.billPayment.findMany({
        where: { organizationId, supplierId: opts.contactId },
        select: { amount: true, paymentDate: true },
      });
      for (const p of pays) {
        if (p.paymentDate < from) opening -= p.amount;
        else if (p.paymentDate <= to) settled += p.amount;
      }
    }
    // Imported docs carry settled amounts with no Payment rows. Treat that
    // implied portion (paid − recorded payments) as settling on the document
    // date — same convention as the SOA/supplier-SOA reconstructions.
    const payRows = isAR
      ? await this.prisma.payment.findMany({ where: { organizationId, customerId: opts.contactId }, select: { documentId: true, amount: true } })
      : await this.prisma.billPayment.findMany({ where: { organizationId, supplierId: opts.contactId }, select: { billId: true, amount: true } });
    const recordedByDoc = new Map<string, number>();
    for (const p of payRows as any[]) {
      const key = p.documentId || p.billId;
      recordedByDoc.set(key, (recordedByDoc.get(key) || 0) + p.amount);
    }
    for (const d of docs) {
      const implied = R(Math.max(0, d.paid - (recordedByDoc.get(d.id) || 0)));
      if (implied <= 0.005) continue;
      if (d.date < from) opening -= implied;
      else if (d.date <= to) settled += implied;
    }

    const openingR = R(opening);
    const movement = R(invoiced - settled);
    const closing = R(openingR + movement);

    return {
      success: true,
      data: {
        contact: { id: contact.id, name: contact.name, type: opts.contactType },
        period: { from: from.toISOString(), to: to.toISOString() },
        section: isAR ? 'Receivables' : 'Payables',
        openingBalance: openingR,
        invoiced: R(invoiced),
        settled: R(settled),
        movement,
        closingBalance: closing,
      },
    };
  }

  // ------------------------------------------------------------------
  // Income and Expenses by Contact — per-contact totals per month column.
  // compareMonths = number of month columns (newest first), anchored on `to`.
  // ------------------------------------------------------------------
  async incomeExpenseByContact(organizationId: string, opts: { to?: string; compareMonths?: number }) {
    const anchor = opts.to ? new Date(opts.to) : new Date();
    const months = Math.min(Math.max(opts.compareMonths ?? 4, 1), 12);

    // Month windows, newest first.
    const windows: { label: string; start: Date; end: Date }[] = [];
    for (let i = 0; i < months; i++) {
      const start = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() - i + 1, 0, 23, 59, 59, 999);
      windows.push({ label: start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), start, end });
    }
    const oldest = windows[windows.length - 1].start;
    const newest = windows[0].end;

    const [invoices, bills] = await Promise.all([
      this.scanDocs(organizationId, 'receivable'),
      this.scanDocs(organizationId, 'payable'),
    ]);

    type Row = { contactName: string; type: 'Income' | 'Expense'; cells: number[]; total: number };
    const rows = new Map<string, Row>();
    const addTo = (key: string, name: string, type: 'Income' | 'Expense', date: Date, amount: number) => {
      if (date < oldest || date > newest) return;
      const idx = windows.findIndex((w) => date >= w.start && date <= w.end);
      if (idx === -1) return;
      const row = rows.get(key) || { contactName: name, type, cells: Array(months).fill(0), total: 0 };
      row.cells[idx] += amount;
      row.total += amount;
      rows.set(key, row);
    };
    // Xero's Income & Expenses by Contact reports NET of GST.
    for (const d of invoices) addTo(`${d.contactId}:I`, d.contactName, 'Income', d.date, d.net);
    for (const d of bills) addTo(`${d.contactId}:E`, d.contactName, 'Expense', d.date, d.net);

    const list = [...rows.values()]
      .map((r) => ({ ...r, cells: r.cells.map(R), total: R(r.total) }))
      .sort((a, b) => a.contactName.localeCompare(b.contactName) || a.type.localeCompare(b.type));

    const totals = {
      income: Array(months).fill(0),
      expense: Array(months).fill(0),
    };
    for (const r of list) {
      const target = r.type === 'Income' ? totals.income : totals.expense;
      r.cells.forEach((v, i) => (target[i] += v));
    }

    return {
      success: true,
      data: {
        columns: windows.map((w) => w.label),
        rows: list,
        totals: { income: totals.income.map(R), expense: totals.expense.map(R) },
      },
    };
  }
}
