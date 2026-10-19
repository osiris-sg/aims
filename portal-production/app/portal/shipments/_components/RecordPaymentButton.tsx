"use client";

// "Record payment" on a paying step (1 PI deposit, 6 CI, 8 import tax, 12
// logistics): opens the payment dialog with the step's target and files the
// proof on the step, as the proof upload did before.

import React, { useState } from "react";
import { Button } from "@mui/material";
import PaymentsIcon from "@mui/icons-material/PaymentsOutlined";
import PaymentDialog from "./PaymentDialog";
import type { AllocationTarget } from "../_lib/api";

export const PAYING_STEPS: Record<string, { target: AllocationTarget; proofDocType: string }> = {
  PI_PAYMENT: { target: "PI", proofDocType: "DEPOSIT_PROOF" },
  CI_PAYMENT: { target: "CI", proofDocType: "CI_PAYMENT_PROOF" },
  TAX_FUNDS: { target: "IMPORT_TAX", proofDocType: "PAYMENT_PROOF" },
  LOGISTICS_PAYMENT: { target: "VENDOR_INVOICE", proofDocType: "PAYMENT_PROOF" },
};

export default function RecordPaymentButton({ stepCode, stepId, targetId, label, amount, currency, disabled }: { stepCode: string; stepId: string; targetId: string; label: string; amount?: number | null; currency?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const cfg = PAYING_STEPS[stepCode];
  if (!cfg) return null;
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<PaymentsIcon />} disabled={disabled} onClick={() => setOpen(true)} data-tour="record-payment">
        Record payment
      </Button>
      <PaymentDialog
        open={open}
        onClose={() => setOpen(false)}
        context={{ direction: "OUT", target: { targetType: cfg.target, targetId, label, amount, currency }, proof: { stepId, docType: cfg.proofDocType } }}
      />
    </>
  );
}
