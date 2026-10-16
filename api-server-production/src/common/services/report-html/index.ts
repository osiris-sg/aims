/**
 * Accounting report → printable HTML. The report counterpart of
 * document-html/index.ts, and deliberately the same contract: a report that
 * has been ported renders, everything else returns null and the caller says
 * so honestly rather than inventing an excuse.
 *
 * PORTED SO FAR: soa, supplier-soa, aged-receivables, aged-payables,
 * trial-balance.
 *
 * NOT YET: profit-loss, balance-sheet, cash-flow, gl-detail, general-ledger,
 * journal, bank-summary, account-activity, gst, invoice-report,
 * contact-transactions, income-expense-by-contact, sales-by-customer,
 * purchases-by-supplier, aging-summary. Their DATA is all server-side already
 * (journal.service / xero-reports.service / statements.service) — only the
 * layout is missing, so each is a body renderer and a registry line.
 */
import { ReportModel, reportShell, REPORT_PDF_MARGIN } from './shared';
import { customerStatementModel, supplierStatementModel } from './statements';
import { agedModel, trialBalanceModel } from './ledgers';

export { REPORT_PDF_MARGIN, reportShell };
export type { ReportModel };

/** Every report the PDF renderer understands, with the wording users see. */
export const REPORT_KEYS = {
  soa: 'Statement of Account',
  'supplier-soa': 'Supplier Statement of Account',
  'aged-receivables': 'Aged Receivables Summary',
  'aged-payables': 'Aged Payables Summary',
  'trial-balance': 'Trial Balance',
} as const;

export type ReportKey = keyof typeof REPORT_KEYS;

export const isReportKey = (k: string): k is ReportKey => Object.prototype.hasOwnProperty.call(REPORT_KEYS, k);

export interface ReportContext {
  organizationName?: string | null;
  currency?: string | null;
  /** Period echoed into the header for the reports that take one. */
  from?: string | null;
  to?: string | null;
}

/**
 * Build the model for a report key from that report's OWN service payload.
 * `data` is the `.data` of the service response (or the raw object for the
 * journal reports, which do not wrap).
 */
export function reportModel(key: string, data: any, ctx: ReportContext): ReportModel | null {
  switch (key) {
    case 'soa':
      return customerStatementModel(data, ctx);
    case 'supplier-soa':
      return supplierStatementModel(data, ctx);
    case 'aged-receivables':
      return agedModel(data, { ...ctx, side: 'AR' });
    case 'aged-payables':
      return agedModel(data, { ...ctx, side: 'AP' });
    case 'trial-balance':
      return trialBalanceModel(data, ctx);
    default:
      return null;
  }
}

/** Model → full A4 HTML. Null when the report has not been ported yet. */
export function renderReportHtml(key: string, data: any, ctx: ReportContext): string | null {
  const model = reportModel(key, data, ctx);
  return model ? reportShell(model) : null;
}
