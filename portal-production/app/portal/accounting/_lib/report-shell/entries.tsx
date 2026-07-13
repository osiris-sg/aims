"use client";

// Prop-less wrappers so the AccountingReportsView registry (Component:
// React.ComponentType) can host the parameterised Xero-style reports.

import React from "react";
import AgedReport from "./AgedReport";
import InvoiceReport from "./InvoiceReport";
import ContactTransactionsReport from "./ContactTransactionsReport";
import IncomeExpenseByContactReport from "./IncomeExpenseByContactReport";
import { GLDetailReport, GLSummaryReport } from "./GLReports";
import { TrialBalanceXero, JournalReportXero, BankSummaryReport, ForeignBankListingReport } from "./LedgerReports";
import { ProfitLossXero, BalanceSheetXero } from "./FinancialStatements";
import GSTReportShell from "./GSTReport";

const AR_BASE = "/portal/accounting/receivables";
const AP_BASE = "/portal/accounting/payables";
const GL_BASE = "/portal/accounting/ledger";

export const AgedReceivablesSummary = () => <AgedReport side="receivable" level="summary" basePath={AR_BASE} />;
export const AgedReceivablesDetail = () => <AgedReport side="receivable" level="detail" basePath={AR_BASE} />;
export const AgedPayablesSummary = () => <AgedReport side="payable" level="summary" basePath={AP_BASE} />;
export const AgedPayablesDetail = () => <AgedReport side="payable" level="detail" basePath={AP_BASE} />;
export const ReceivableInvoices = () => <InvoiceReport side="receivable" basePath={AR_BASE} />;
export const ReceivableInvoiceDetail = () => <InvoiceReport side="receivable" level="detail" basePath={AR_BASE} />;
export const PayableInvoices = () => <InvoiceReport side="payable" basePath={AP_BASE} />;
export const PayableInvoiceDetail = () => <InvoiceReport side="payable" level="detail" basePath={AP_BASE} />;
export const ContactTransactionsSummary = () => <ContactTransactionsReport basePath={AR_BASE} />;
export const IncomeExpensesByContact = () => <IncomeExpenseByContactReport basePath={AR_BASE} />;
export const GeneralLedgerDetail = () => <GLDetailReport basePath={GL_BASE} />;
export const GeneralLedgerSummary = () => <GLSummaryReport basePath={GL_BASE} />;
export const AccountTransactions = () => <GLDetailReport basePath={GL_BASE} title="Account Transactions" />;
export const ExpenseListing = () => <GLDetailReport basePath={GL_BASE} title="Expense Listing" presetAccountTypes={["EXPENSE", "PURCHASE"]} />;
export const TrialBalanceReport = () => <TrialBalanceXero basePath={GL_BASE} />;
export const JournalReport = () => <JournalReportXero basePath={GL_BASE} />;
export const BankSummary = () => <BankSummaryReport basePath={GL_BASE} />;
export const ForeignBankListing = () => <ForeignBankListingReport basePath={GL_BASE} />;
export const ProfitLoss = () => <ProfitLossXero basePath="/portal/accounting/reports" />;
export const BalanceSheet = () => <BalanceSheetXero basePath="/portal/accounting/reports" />;
export const GSTReturn = () => <GSTReportShell basePath={GL_BASE} />;
