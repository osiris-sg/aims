"use client";

import React, { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { DEFAULT_CLAUSES, DEFAULT_PAYMENT_TERMS } from "../_lib/defaults";

interface Props {
  open: boolean;
  paymentTerms: string[];
  clauses: string[];
  readOnly: boolean;
  onClose: () => void;
  onSave: (paymentTerms: string[], clauses: string[]) => void;
}

const toLines = (arr: string[]) => arr.join("\n");
const fromLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export default function TermsDialog({ open, paymentTerms, clauses, readOnly, onClose, onSave }: Props) {
  const [pay, setPay] = useState("");
  const [cl, setCl] = useState("");
  useEffect(() => {
    if (open) {
      setPay(toLines(paymentTerms));
      setCl(toLines(clauses));
    }
  }, [open, paymentTerms, clauses]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle>Payment terms & General Terms and Conditions</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <div>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Payment terms (one per line, printed A–E style)
            </Typography>
            <TextField multiline minRows={5} fullWidth value={pay} onChange={(e) => setPay(e.target.value)} disabled={readOnly} InputProps={{ sx: { fontSize: 13 } }} />
          </div>
          <div>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Clauses (one per line, numbered automatically)
            </Typography>
            <TextField multiline minRows={10} maxRows={22} fullWidth value={cl} onChange={(e) => setCl(e.target.value)} disabled={readOnly} InputProps={{ sx: { fontSize: 13 } }} />
          </div>
        </Stack>
      </DialogContent>
      <DialogActions>
        {!readOnly && (
          <Button
            onClick={() => {
              setPay(toLines(DEFAULT_PAYMENT_TERMS));
              setCl(toLines(DEFAULT_CLAUSES));
            }}
            sx={{ mr: "auto", textTransform: "none" }}
          >
            Reset to standard
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
        {!readOnly && (
          <Button variant="contained" onClick={() => onSave(fromLines(pay), fromLines(cl))}>
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
