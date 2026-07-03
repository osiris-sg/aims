// Default Singapore SME Chart of Accounts seed data.
// Modelled after the A's Accounting "Accounts Definition" screen.
// Seeded when an organization first opens the Accounting module.

export type SeedAccount = {
  code: string;
  name: string;
  accountType: string;
  category: 'PNL' | 'BALANCE_SHEET';
  normalBalance: 'DEBIT' | 'CREDIT';
  isControlAccount?: boolean;
};

export const DEFAULT_CHART_OF_ACCOUNTS: SeedAccount[] = [
  // ---------- P&L: SALES ----------
  { code: 'SS001', name: 'Credit Sales', accountType: 'SALES', category: 'PNL', normalBalance: 'CREDIT' },

  // ---------- P&L: PURCHASES / COST OF SALES ----------
  { code: 'CS001', name: 'Purchases', accountType: 'PURCHASE', category: 'PNL', normalBalance: 'DEBIT' },

  // ---------- P&L: INCOME ----------
  { code: 'IC001', name: 'Other Income', accountType: 'INCOME', category: 'PNL', normalBalance: 'CREDIT' },
  { code: 'IC005', name: 'Fixed Deposit Received', accountType: 'INCOME', category: 'PNL', normalBalance: 'CREDIT' },

  // ---------- P&L: EXPENSES ----------
  { code: 'EX001', name: 'General Expenses', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX203', name: 'Telephone Charges', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },
  { code: 'EX410', name: 'Bad Debts Written Off', accountType: 'EXPENSE', category: 'PNL', normalBalance: 'DEBIT' },

  // ---------- P&L: TAX ----------
  { code: 'TX001', name: 'Income Tax', accountType: 'TAX', category: 'PNL', normalBalance: 'DEBIT' },

  // ---------- P&L: EXTRAORDINARY ----------
  { code: 'XI001', name: 'Extraordinary Items', accountType: 'EXTRAORDINARY', category: 'PNL', normalBalance: 'DEBIT' },

  // ---------- P&L: EXCHANGE GAIN / LOSS ----------
  { code: 'EX070', name: 'Exchange Gain / Loss', accountType: 'EXCHANGE_GAIN_LOSS', category: 'PNL', normalBalance: 'CREDIT' },

  // ---------- BALANCE SHEET: FIXED ASSETS ----------
  { code: 'FA001', name: 'Fixed Assets', accountType: 'FIXED_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },

  // ---------- BALANCE SHEET: INTANGIBLE ASSETS ----------
  { code: 'IA001', name: 'Intangible Assets', accountType: 'INTANGIBLE_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },

  // ---------- BALANCE SHEET: CURRENT ASSETS ----------
  { code: 'CA001', name: 'Trade Receivables', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT', isControlAccount: true }, // Debtor control
  { code: 'CA002', name: 'Opening Stock', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CA004', name: 'Cash In Hand', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CA100', name: 'Bank — Main Account', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CA600', name: 'Cash at Bank', accountType: 'CURRENT_ASSET', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },

  // ---------- BALANCE SHEET: CURRENT LIABILITIES ----------
  { code: 'CL001', name: 'Trade Payables', accountType: 'CURRENT_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT', isControlAccount: true }, // Creditor control
  { code: 'CL900', name: 'GST / VAT Payable', accountType: 'TAX_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT', isControlAccount: true }, // Tax control

  // ---------- BALANCE SHEET: EQUITY / LONG TERM ----------
  { code: 'SC001', name: 'Share Capital', accountType: 'SHARE_CAPITAL', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  { code: 'RTPL', name: 'Retained Profit / Loss', accountType: 'RETAINED_PROFIT', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  { code: 'DV001', name: 'Dividends', accountType: 'DIVIDEND', category: 'BALANCE_SHEET', normalBalance: 'DEBIT' },
  { code: 'CR001', name: 'Capital Reserve', accountType: 'CAPITAL_RESERVE', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  { code: 'PD001', name: 'Provision for Depreciation', accountType: 'DEPRECIATION_PROVISION', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  { code: 'MT001', name: 'Medium Term Liability', accountType: 'MEDIUM_TERM_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
  { code: 'LT001', name: 'Long Term Liability', accountType: 'LONG_TERM_LIABILITY', category: 'BALANCE_SHEET', normalBalance: 'CREDIT' },
];

// Default code-range map used in Accounts Definition tab.
export const DEFAULT_ACCOUNT_CODE_RANGES = {
  // P&L
  sales: { from: 'SS001', to: 'SS999' },
  purchase: { from: 'CS001', to: 'CS999' },
  income: { from: 'IC001', to: 'IC999' },
  expenses: { from: 'EX001', to: 'EX999' },
  tax: { from: 'TX001', to: 'TX999' },
  extraordinary: { from: 'XI001', to: 'XI999' },
  exchangeGainLoss: { from: 'EX070', to: 'EX070' },
  // Balance Sheet
  fixedAssets: { from: 'FA001', to: 'FA999' },
  intangibleAssets: { from: 'IA001', to: 'IA999' },
  currentAssets: { from: 'CA001', to: 'CA999' },
  currentLiabilities: { from: 'CL001', to: 'CL999' },
  openingStock: { from: 'CA002', to: 'CA002' },
  taxLiabilities: { from: 'CL900', to: 'CL900' },
  // Equity / Control
  dividends: { from: 'DV001', to: 'DV999' },
  shareCapitals: { from: 'SC001', to: 'SC999' },
  provisionForDepreciation: { from: 'PD001', to: 'PD999' },
  retainedProfits: { from: 'RTPL', to: 'RTPL' },
  capitalReserve: { from: 'CR001', to: 'CR999' },
  mediumTermLiabilities: { from: 'MT001', to: 'MT999' },
  longTermLiabilities: { from: 'LT001', to: 'LT999' },
  foreignBankAccount: { from: 'CA100', to: 'CA105' },
  workInProgress: { from: 'CA500', to: 'CA599' },
};

export const DEFAULT_CONTROL_ACCOUNTS = {
  debtorControl: 'CA001',
  creditorControl: 'CL001',
  taxLiabilities: 'CL900',

  dividends: 'DV001',
  shareCapitals: 'SC001',
  provisionForDepreciation: 'PD001',
  retainedProfits: 'RTPL',
  capitalReserve: 'CR001',
  mediumTermLiabilities: 'MT001',
  longTermLiabilities: 'LT001',
  foreignBankAccount: 'CA100',
  workInProgress: 'CA500',
};

export const DEFAULT_NEXT_NUMBERS = {
  quotation: 1,
  salesOrder: 1,
  deliveryOrder: 1,
  invoice: 1,
  debitNote: 1,
  creditNote: 1,
  proforma: 1,
  allocationOrder: 1,
  productionOrder: 1,
  stockAdjustment: 1,
  purchaseOrder: 1,
  purchaseReturn: 1,
  receipt: 1,
  paymentVoucher: 1,
  journalVoucher: 1,
  purchaseRequisition: 1,
};
