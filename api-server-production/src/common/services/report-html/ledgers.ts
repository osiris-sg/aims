/**
 * Aged receivables/payables and the trial balance.
 *
 * The aged reports have a VARIABLE column count — the caller chooses how many
 * ageing periods and how long each is — so the columns are derived from the
 * service's own bucketLabels rather than hard-coded. Hard-coding 30/60/90
 * would silently mislabel a report run with periodDays=14.
 */
import { ReportModel, ReportColumn, ReportSection } from './shared';

const fmtAsOf = (iso: any): string => {
  const d = iso ? new Date(iso) : new Date();
  return `As at ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' })}`;
};

/** Aged receivables / payables, summary or detail, from xero-reports.aged(). */
export function agedModel(
  data: any,
  ctx: { side: 'AR' | 'AP'; organizationName?: string | null; currency?: string | null },
): ReportModel {
  const labels: string[] = data?.bucketLabels || [];
  const columns: ReportColumn[] = [
    { key: 'contact', label: ctx.side === 'AR' ? 'Customer' : 'Supplier' },
    ...labels.map((l, i) => ({ key: `b${i}`, label: l, money: true })),
    { key: 'total', label: 'Total', money: true },
  ];

  const spread = (buckets: number[] = []) =>
    Object.fromEntries(labels.map((_, i) => [`b${i}`, buckets[i] ?? 0]));

  let sections: ReportSection[];
  if (Array.isArray(data?.groups)) {
    // detail: one section per contact, a row per document
    sections = data.groups.map((g: any) => ({
      title: g.contactName || g.name,
      rows: (g.docs || []).map((d: any) => ({
        contact: `${d.documentNumber || d.number || ''}${d.date ? ` · ${new Date(d.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}`,
        ...spread(d.buckets),
        total: d.outstanding ?? d.total ?? 0,
      })),
      total: { contact: 'Subtotal', ...spread(g.buckets), total: g.total ?? 0 },
    }));
  } else {
    sections = [
      {
        rows: (data?.rows || []).map((r: any) => ({
          contact: r.contactName,
          ...spread(r.buckets),
          total: r.total,
        })),
      },
    ];
  }

  return {
    title: ctx.side === 'AR' ? 'Aged Receivables Summary' : 'Aged Payables Summary',
    period: fmtAsOf(data?.asOf),
    subject: null,
    organizationName: ctx.organizationName ?? null,
    currency: ctx.currency ?? null,
    facts: data?.ageingBy ? [{ label: 'Ageing by', value: data.ageingBy === 'dueDate' ? 'Due date' : 'Document date' }] : [],
    columns,
    sections,
    grandTotal: { contact: 'Total', ...spread(data?.totals), total: data?.grandTotal ?? 0 },
    notes: [`All amounts are in ${ctx.currency || 'SGD'}.`],
  };
}

/** Trial balance, from journal.service.trialBalance(). */
export function trialBalanceModel(
  data: any,
  ctx: { organizationName?: string | null; currency?: string | null },
): ReportModel {
  return {
    title: 'Trial Balance',
    period: fmtAsOf(data?.asOfDate),
    subject: null,
    organizationName: ctx.organizationName ?? null,
    currency: ctx.currency ?? null,
    facts: [
      {
        label: 'Status',
        // Say it plainly on the page. An out-of-balance TB that looks tidy is
        // worse than one that admits it.
        value: data?.isBalanced ? 'Balanced' : 'OUT OF BALANCE',
      },
    ],
    columns: [
      { key: 'code', label: 'Code', width: '12%' },
      { key: 'name', label: 'Account' },
      { key: 'debit', label: 'Debit', money: true, width: '18%' },
      { key: 'credit', label: 'Credit', money: true, width: '18%' },
    ],
    sections: [
      {
        rows: (data?.rows || []).map((r: any) => ({
          code: r.code,
          name: r.name,
          debit: r.debit || '',
          credit: r.credit || '',
        })),
      },
    ],
    grandTotal: { code: '', name: 'Total', debit: data?.totalDebit ?? 0, credit: data?.totalCredit ?? 0 },
    notes: [`All amounts are in ${ctx.currency || 'SGD'}.`],
  };
}
