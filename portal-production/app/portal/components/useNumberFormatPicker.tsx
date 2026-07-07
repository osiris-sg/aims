"use client";

import React, { useCallback, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  RadioGroup,
  FormControlLabel,
  Radio,
  Box,
  Button,
  Typography,
} from "@mui/material";
import { formatPattern, DOC_CODE } from "@/app/portal/settings/accounting-setup/components/DocumentNumberFormatsManager";

interface NumberFormat {
  id: string;
  documentType: string;
  label: string;
  pattern: string;
  nextSerial: number;
  isActive: boolean;
}

// Map any template/variant code (TI2, QO1…) to the canonical numbering type.
function canonicalType(documentType: string): string {
  const t = (documentType || "").toUpperCase();
  if (["TI", "TI2", "PI", "CI", "INVOICE"].includes(t)) return "INVOICE";
  if (["QO", "QO1", "QO2", "QT", "QUOTATION"].includes(t)) return "QUOTATION";
  if (["DO", "RDO", "DELIVERY_ORDER"].includes(t)) return "DELIVERY_ORDER";
  if (["SO", "SALES_ORDER"].includes(t)) return "SALES_ORDER";
  if (["CN", "CREDIT_NOTE"].includes(t)) return "CREDIT_NOTE";
  if (["DN", "DEBIT_NOTE"].includes(t)) return "DEBIT_NOTE";
  if (["PF", "PROFORMA"].includes(t)) return "PROFORMA";
  if (["PO", "PURCHASE_ORDER"].includes(t)) return "PURCHASE_ORDER";
  if (["PR", "PURCHASE_RETURN"].includes(t)) return "PURCHASE_RETURN";
  if (["SA", "STOCK_ADJUSTMENT"].includes(t)) return "STOCK_ADJUSTMENT";
  return t;
}

/**
 * Number-format resolver for document creation — same self-gating shape as
 * useTemplatePicker:
 *   - 0 formats → resolves undefined (proceed with legacy numbering).
 *   - 1 format  → resolves that id immediately, no dialog.
 *   - >1        → opens the picker and resolves the chosen id, or null if cancelled.
 *
 * Usage:
 *   const { resolveNumberFormat, dialog } = useNumberFormatPicker();
 *   const nf = await resolveNumberFormat(documentType);
 *   if (nf === null) return;               // user cancelled → abort
 *   const numberFormatId = nf || undefined; // string | undefined
 */
export function useNumberFormatPicker() {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [formats, setFormats] = useState<NumberFormat[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const resolverRef = useRef<((id: string | null) => void) | null>(null);

  const closeWith = useCallback((id: string | null) => {
    setOpen(false);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(id);
  }, []);

  const resolveNumberFormat = useCallback(
    async (documentType: string): Promise<string | null | undefined> => {
      const token = (await getToken()) ?? "";
      const type = canonicalType(documentType);

      let active: NumberFormat[] = [];
      try {
        const res = await request(
          { path: `/document-numbering?documentType=${encodeURIComponent(type)}`, method: "GET" },
          {},
          token
        );
        const list = res?.success !== false ? res?.data || res || [] : [];
        active = (Array.isArray(list) ? list : []).filter((f: NumberFormat) => f.isActive);
      } catch {
        active = [];
      }

      if (active.length === 0) return undefined; // legacy numbering
      if (active.length === 1) return active[0].id;

      setFormats(active);
      setSelectedId(active[0].id);
      setOpen(true);
      return new Promise<string | null>((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [getToken]
  );

  const now = new Date();
  const dialog = (
    <Dialog open={open} onClose={() => closeWith(null)} maxWidth="sm" fullWidth>
      <DialogTitle>Choose number format</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          More than one numbering format is set for this document. Pick which one to use.
        </Typography>
        <RadioGroup value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {formats.map((f) => (
            <FormControlLabel
              key={f.id}
              value={f.id}
              control={<Radio />}
              label={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Typography variant="body1">{f.label}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                    {formatPattern(f.pattern, f.nextSerial, now, DOC_CODE[f.documentType])}
                  </Typography>
                </Box>
              }
            />
          ))}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeWith(null)}>Cancel</Button>
        <Button variant="contained" onClick={() => closeWith(selectedId || null)} disabled={!selectedId}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );

  return { resolveNumberFormat, dialog };
}
