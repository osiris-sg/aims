"use client";

// The Cash Flow Statement in the standard report shell (guru 2026-11-18: one
// report UI). The ledger's ?tab=cf mounts this same page component.
import CashFlowReport from "../_lib/report-shell/CashFlowReport";

export default function CashFlowPage() {
  return <CashFlowReport />;
}
