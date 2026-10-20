/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// A paying / receiving step's money (round H — the Payments module is
// retired): amount, date, account and the proof file, kept on the step itself.
// ADH pays on 1 (PI deposit), 6 (CI), 8 (import tax) and 12 (transport &
// storage); the customer pays on 2 (Invoice #1) and 11 (Invoice #2 / single).
// The proof is one of the step's own files of the proof type (upload it on the
// step first). Home's cash in / out and the reconciliation sum these.

import React, { useEffect, useState } from "react";
import { Box, Button, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import PaymentsIcon from "@mui/icons-material/PaymentsOutlined";
import { toast } from "../_lib/toast";
import { useTradeMutation } from "../_lib/hooks";
import { ACCOUNT_LABEL, paymentOf, STEP_PAYMENT, type PaymentAccount, type RecordFileLink, type TradeStep } from "../_lib/api";
import { fmtDmy, fmtMoney } from "../_lib/format";
import { anyDateError, guardDate } from "../_lib/dates";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function StepPaymentForm({
  step,
  fileLinks,
  expected,
  currency,
  canEdit,
}: {
  step: TradeStep;
  /** The record's files (the proof is picked from the step's proof-type files). */
  fileLinks: RecordFileLink[];
  /** Prefill: the deposit / CI amount / estimate. */
  expected?: number | null;
  currency?: string | null;
  canEdit: boolean;
}) {
  const spec = STEP_PAYMENT[step.code];
  const saved = paymentOf(step);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today());
  const [account, setAccount] = useState<PaymentAccount>("WISE");
  const [cur, setCur] = useState("USD");
  const [proofFileId, setProofFileId] = useState("");
  const save = useTradeMutation((a, payment: Parameters<typeof a.setStepPayment>[1]) => a.setStepPayment(step.id, payment));

  const defaultCurrency = currency || spec?.currency || "USD";
  useEffect(() => {
    if (!editing) return;
    setAmount(saved ? String(saved.amount) : expected != null ? String(expected) : "");
    setPaidAt(saved?.paidAt ?? today());
    setAccount(saved?.account ?? (defaultCurrency === "JPY" ? "SMBC_JPY" : "WISE"));
    setCur(saved?.currency ?? defaultCurrency);
    setProofFileId(saved?.proofFileId ?? "");
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!spec) return null;
  const proofs = fileLinks.filter((l) => l.file.docType === spec.proofDocType && (l.stepId === step.id || !l.stepId));
  const proofName = saved?.proofFileId ? (fileLinks.find((l) => l.file.id === saved.proofFileId)?.file.fileName ?? "proof file") : null;

  if (!editing) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap data-tour="step-payment">
        <PaymentsIcon fontSize="small" color={saved ? "success" : "disabled"} />
        {saved ? (
          <Typography variant="body2">
            {spec.label}: <b>{fmtMoney(saved.amount, saved.currency)}</b> on {fmtDmy(saved.paidAt)} · {ACCOUNT_LABEL[saved.account] ?? saved.account}
            {proofName ? ` · ${proofName}` : " · no proof attached"}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {spec.direction === "IN" ? "No receipt recorded" : "No payment recorded"}
          </Typography>
        )}
        {canEdit && (
          <Button size="small" variant={saved ? "text" : "outlined"} onClick={() => setEditing(true)}>
            {saved ? "Edit" : spec.direction === "IN" ? "Record receipt" : "Record payment"}
          </Button>
        )}
        {canEdit && saved && (
          <Button
            size="small"
            color="error"
            onClick={async () => {
              try {
                await save.mutateAsync(null);
                toast.success("Payment cleared");
              } catch (e: any) {
                toast.error(e?.message || "Could not clear the payment");
              }
            }}
          >
            Clear
          </Button>
        )}
      </Stack>
    );
  }

  const bad = !(Number(amount) > 0) || !paidAt || anyDateError(paidAt);
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-tour="step-payment">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {spec.label}
      </Typography>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "1.2fr 0.6fr 1fr 1.2fr 1.6fr" } }}>
        <TextField size="small" label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ min: 0, step: "0.01" }} />
        <TextField size="small" select label="Currency" value={cur} onChange={(e) => setCur(e.target.value)}>
          {["USD", "JPY", "SGD"].map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </TextField>
        <TextField size="small" label="Date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} {...guardDate({ type: "date", InputLabelProps: { shrink: true } }, paidAt)} />
        <TextField size="small" select label="Account" value={account} onChange={(e) => setAccount(e.target.value as PaymentAccount)}>
          {(Object.keys(ACCOUNT_LABEL) as PaymentAccount[]).map((k) => (
            <MenuItem key={k} value={k}>
              {ACCOUNT_LABEL[k]}
            </MenuItem>
          ))}
        </TextField>
        <TextField size="small" select label="Proof" value={proofFileId} onChange={(e) => setProofFileId(e.target.value)} helperText={proofs.length ? undefined : "Upload the proof on this step first"}>
          <MenuItem value="">
            <em>None</em>
          </MenuItem>
          {proofs.map((l) => (
            <MenuItem key={l.file.id} value={l.file.id}>
              {l.file.fileName}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
        <Button onClick={() => setEditing(false)}>Cancel</Button>
        <Button
          variant="contained"
          disabled={bad || save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({ amount: Number(amount), currency: cur, paidAt, account, proofFileId: proofFileId || null });
              toast.success(`${spec.label} saved`);
              setEditing(false);
            } catch (e: any) {
              toast.error(e?.message || "Could not save the payment");
            }
          }}
        >
          Save
        </Button>
      </Stack>
    </Paper>
  );
}
