/**
 * Statement of Account (customer and supplier) as a printable report.
 *
 * The column set and wording follow the portal's statement-of-account page so
 * the PDF the agent sends and the PDF a user exports from the screen are the
 * same document (guru's rule: legacy reports word-for-word).
 */
import { ReportModel } from './shared';

const fmtDate = (d: any): string => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' });
};

const periodText = (from?: string | null, to?: string | null): string | null => {
  if (from && to) return `${fmtDate(from)} to ${fmtDate(to)}`;
  if (to) return `As at ${fmtDate(to)}`;
  if (from) return `From ${fmtDate(from)}`;
  return null;
};

const agingFacts = (aging: any): Array<{ label: string; value: string }> => {
  if (!aging) return [];
  const n = (v: any) => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pick = (...keys: string[]) => {
    for (const k of keys) if (aging[k] !== undefined) return aging[k];
    return 0;
  };
  return [
    { label: 'Current', value: n(pick('current')) },
    { label: '1-30 days', value: n(pick('days30', 'days1To30', 'd30')) },
    { label: '31-60 days', value: n(pick('days60', 'days31To60', 'd60')) },
    { label: '61-90 days', value: n(pick('days90', 'days61To90', 'd90')) },
    { label: '90+ days', value: n(pick('days120Plus', 'days90Plus', 'over90')) },
  ];
};

/** Shared by both directions — only the counterparty and labels differ. */
function statementModel(args: {
  title: string;
  subject: string;
  contactLines: string[];
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  transactions: any[];
  aging?: any;
  period?: string | null;
  organizationName?: string | null;
  currency?: string | null;
  debitLabel: string;
  creditLabel: string;
}): ReportModel {
  const rows: Array<Record<string, any>> = [
    { date: '', reference: '', description: 'Opening balance', debit: '', credit: '', balance: args.openingBalance },
    ...args.transactions.map((t) => ({
      date: fmtDate(t.date),
      reference: t.reference || '',
      description: t.description || t.transactionType || '',
      debit: t.debit || '',
      credit: t.credit || '',
      balance: t.balance,
    })),
  ];

  return {
    title: args.title,
    subject: args.subject,
    period: args.period ?? null,
    organizationName: args.organizationName ?? null,
    currency: args.currency ?? null,
    facts: [
      ...args.contactLines.filter(Boolean).map((v, i) => ({ label: i === 0 ? 'Contact' : '', value: v })),
      ...agingFacts(args.aging),
    ],
    columns: [
      { key: 'date', label: 'Date', width: '16%' },
      { key: 'reference', label: 'Reference', width: '16%' },
      { key: 'description', label: 'Description' },
      { key: 'debit', label: args.debitLabel, money: true, width: '13%' },
      { key: 'credit', label: args.creditLabel, money: true, width: '13%' },
      { key: 'balance', label: 'Balance', money: true, width: '14%' },
    ],
    sections: [{ rows }],
    grandTotal: {
      date: '',
      reference: '',
      description: `Closing balance (${args.transactions.length} transaction${args.transactions.length === 1 ? '' : 's'})`,
      debit: args.totalDebit,
      credit: args.totalCredit,
      balance: args.closingBalance,
    },
    notes: [`All amounts are in ${args.currency || 'SGD'}.`],
  };
}

/** Customer SOA, from statements.service.generateSOA(...).data */
export function customerStatementModel(data: any, ctx: { organizationName?: string | null; currency?: string | null; from?: string | null; to?: string | null }): ReportModel {
  const c = data?.customer || {};
  const s = data?.statement || {};
  return statementModel({
    title: 'Statement of Account',
    subject: c.name || 'Customer',
    contactLines: [c.email, c.phone, c.address].filter(Boolean),
    openingBalance: Number(s.openingBalance) || 0,
    closingBalance: Number(s.currentBalance) || 0,
    totalDebit: Number(s.totalDebit) || 0,
    totalCredit: Number(s.totalCredit) || 0,
    transactions: data?.transactions || [],
    aging: data?.agingAnalysis,
    period: periodText(ctx.from, ctx.to),
    organizationName: ctx.organizationName,
    currency: ctx.currency,
    debitLabel: 'Invoiced',
    creditLabel: 'Paid',
  });
}

/** Supplier SOA, from statements.service.generateSupplierSOA(...).data */
export function supplierStatementModel(data: any, ctx: { organizationName?: string | null; currency?: string | null }): ReportModel {
  const sup = data?.supplier || {};
  const s = data?.summary || {};
  return statementModel({
    title: 'Supplier Statement of Account',
    subject: sup.name || 'Supplier',
    contactLines: [sup.email, sup.phone, sup.address].filter(Boolean),
    openingBalance: Number(s.openingBalance) || 0,
    closingBalance: Number(s.closingBalance) || 0,
    totalDebit: Number(s.totalDebit) || 0,
    totalCredit: Number(s.totalCredit) || 0,
    transactions: data?.transactions || [],
    aging: data?.aging,
    period: periodText(data?.period?.startDate, data?.period?.endDate),
    organizationName: ctx.organizationName,
    currency: ctx.currency,
    debitLabel: 'Billed',
    creditLabel: 'Paid',
  });
}
