"use client";

import ComingSoon from "../_lib/ComingSoon";

export default function GstPage() {
  return (
    <ComingSoon
      title="Goods & Services Tax"
      description="GST / VAT calculation, return generation, and tax-period tracking."
      bullets={[
        "Output / input tax breakdown by period",
        "GST return form (F5 / GST-03 style export)",
        "Tax period locking",
        "Drill-down to tax-coded journal lines",
      ]}
    />
  );
}
