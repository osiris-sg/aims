/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// "Link existing invoice": search the org's invoices by number or customer and
// link one to this contract/shipment as INVOICE_1 / INVOICE_2 (tagged with the
// step it was opened from).

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, TextField, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { toast } from "../_lib/toast";
import { useShipmentsApi, type DocSummary } from "../_lib/api";
import { useDocTypeLabels, useTradeMutation } from "../_lib/hooks";
import { DOC_STATUS_LABEL, fmtDate, fmtMoney } from "../_lib/format";
import { useDebounced } from "./useDebounced";

export default function LinkInvoiceDialog({
  open,
  onClose,
  docType,
  stepId,
  owner,
}: {
  open: boolean;
  onClose: () => void;
  docType: string;
  stepId?: string;
  owner: { kind: "contract" | "shipment"; id: string; label: string };
}) {
  const api = useShipmentsApi();
  const label = useDocTypeLabels();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<DocSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const term = useDebounced(q);
  const results = useQuery({
    queryKey: ["trade-invoice-search", term],
    enabled: open,
    queryFn: () => api.searchInvoices(term),
  });
  const link = useTradeMutation((a, d: DocSummary) =>
    a.linkDocument({ documentId: d.id, docType, stepId, ...(owner.kind === "contract" ? { contractIds: [owner.id] } : { shipmentIds: [owner.id] }) }),
  );

  useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked(null);
    setError(null);
  }, [open]);

  const submit = async () => {
    if (!picked) return;
    setError(null);
    try {
      await link.mutateAsync(picked);
      toast.success(`${picked.number ?? "Invoice"} linked as ${label(docType)}`);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not link the invoice");
    }
  };

  return (
    <Dialog open={open} onClose={() => !link.isPending && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Link existing invoice as {label(docType)}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField autoFocus fullWidth size="small" label="Search by invoice number or customer" value={q} onChange={(e) => setQ(e.target.value)} />
        <Box sx={{ mt: 1.5, minHeight: 120 }}>
          {results.isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : results.isError ? (
            <Alert severity="error">{(results.error as Error)?.message || "Search failed"}</Alert>
          ) : !(results.data ?? []).length ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
              No invoices found{term ? ` for “${term}”` : ""}.
            </Typography>
          ) : (
            <List dense disablePadding sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 320, overflowY: "auto" }}>
              {(results.data ?? []).map((d) => (
                <ListItemButton key={d.id} selected={picked?.id === d.id} onClick={() => setPicked(d)} divider>
                  <ListItemText
                    primary={`${d.number ?? "(no number)"} · ${d.customerName ?? "—"}`}
                    secondary={`${DOC_STATUS_LABEL(d.status)} · ${fmtMoney(d.total, d.currency)} · ${fmtDate(d.date)}`}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={link.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={!picked || link.isPending}>
          {link.isPending ? "Linking…" : "Link invoice"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
