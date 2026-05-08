"use client";

import ComingSoon from "../_lib/ComingSoon";

export default function BankReconciliationPage() {
  return (
    <ComingSoon
      title="Bank Reconciliation"
      description="Match bank statement lines against book entries and identify outstanding items."
      bullets={[
        "Statement import (CSV / OFX / MT940)",
        "Auto-match by reference, amount, and date proximity",
        "Manual match / unmatch / split workflow",
        "Outstanding deposits & checks list",
        "Reconciliation summary with closing balance proof",
      ]}
    />
  );
}
