"use client";

// Standalone route for the Expense Listing report — the same report that lives
// as a tab in the General Ledger workspace (every expense + purchase
// transaction, year to date, grouped by account). Was a ComingSoon stub long
// after the report shipped (fixed 2026-11-08, Summer's expenses-by-category ask).
import { ExpenseListing } from "../_lib/report-shell/entries";

export default function ExpenseListingPage() {
  return <ExpenseListing />;
}
