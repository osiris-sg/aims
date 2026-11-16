"use client";

// The section page (AR / AP / GL) tells the report it is showing which other
// reports live beside it, so the ReportShell can offer "View other reports"
// without the user going Back to the directory (guru 2026-11-16). Provided by
// AccountingReportsView around the active report; null outside a section page.

import { createContext, useContext } from "react";

export interface ReportDirectoryLink {
  key: string;
  label: string;
  description: string;
}

export interface ReportDirectory {
  /** section heading for the menu, e.g. "Receivables reports" */
  title: string;
  /** the section's reports, directory order, the active one included */
  reports: ReportDirectoryLink[];
  activeKey: string;
  open: (key: string) => void;
}

export const ReportDirectoryContext = createContext<ReportDirectory | null>(null);
export const useReportDirectory = () => useContext(ReportDirectoryContext);
