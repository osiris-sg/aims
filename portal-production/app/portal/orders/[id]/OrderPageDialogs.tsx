"use client";

// The order page's own dialogs (round 24, 2026-11-19, one page for AIMS and imported orders): Link existing
// document (both kinds; an AIMS order links service reports only), Create invoice with editable number and lines
// (imported orders), Mark complete (imported orders) and Cancel order (AIMS orders). Failures show the portal's
// error toast; nothing closes or says "done" unless the call succeeded.

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import moment from "moment";
import { toast } from "react-toastify";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { request } from "@/helpers/request";
import { requestFailed } from "@/helpers/requestOutcome";
import { IMPORTED_LINK_TYPES, importedMoney, linkOptionState, type ImportedLinkType, type LinkOption } from "@/helpers/importedOrders";

/** Link existing document: type + number search (the order's customer only), one order per document. */
export function LinkDocumentDialog({
  open,
  onClose,
  orderId,
  orderNumber,
  types,
  initialType,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
  /** The types this order takes; the others show greyed with a tooltip. */
  types: ImportedLinkType[];
  initialType: ImportedLinkType;
  onLinked: () => void;
}) {
  const { getToken } = useAuth();
  const [type, setType] = useState<ImportedLinkType>(initialType);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const find = async (t: ImportedLinkType, q: string) => {
    setResults(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/orders/${orderId}/link-options?type=${t}&q=${encodeURIComponent(q.trim())}`, method: "GET" }, {}, token ?? undefined);
      setResults(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
    } catch {
      setResults([]);
    }
  };
  useEffect(() => {
    if (!open) return;
    setType(initialType);
    setQuery("");
    void find(initialType, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialType]);
  const link = async (o: LinkOption) => {
    setBusy(true);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/orders/${orderId}/link-document`, method: "POST" }, { type: o.type, id: o.id }, token ?? undefined);
      if (requestFailed(res)) return;
      toast.success(`${o.name ?? "Document"} linked to ${orderNumber}`);
      onClose();
      onLinked();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Link existing document</DialogTitle>
      <DialogContent>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={type}
          onChange={(_e, v) => {
            if (!v) return;
            setType(v);
            void find(v, query);
          }}
          sx={{ mt: 1, mb: 1.5, flexWrap: "wrap" }}
        >
          {IMPORTED_LINK_TYPES.map((t) =>
            types.includes(t.key) ? (
              <ToggleButton key={t.key} value={t.key} sx={{ textTransform: "none" }}>
                {t.label}
              </ToggleButton>
            ) : (
              <Tooltip key={t.key} title="Imported orders only for now">
                <span>
                  <ToggleButton value={t.key} disabled sx={{ textTransform: "none" }}>
                    {t.label}
                  </ToggleButton>
                </span>
              </Tooltip>
            ),
          )}
        </ToggleButtonGroup>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField
            size="small"
            fullWidth
            label={type === "SERVICE_REPORT" ? "Report number" : "Number"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void find(type, query);
            }}
            inputProps={{ maxLength: 40 }}
          />
          <Button onClick={() => void find(type, query)}>Find</Button>
        </Stack>
        {results === null ? (
          <CircularProgress size={20} />
        ) : results.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No documents found
          </Typography>
        ) : (
          <List dense>
            {results.map((o) => {
              const st = linkOptionState(o);
              const secondary = [o.date ? moment(o.date).format("DD/MM/YYYY") : "", o.imported ? "Imported" : "", o.total != null ? importedMoney(o.total) : "", o.status && type === "SERVICE_REPORT" ? o.status : "", st.note].filter(Boolean).join(" · ");
              return (
                <ListItemButton key={o.id} disabled={st.disabled || busy} onClick={() => void link(o)}>
                  <ListItemText primary={o.name ?? "Document"} secondary={secondary} />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export type InvoiceLineDraft = { description: string; quantity: string; unitPrice: string; priced: boolean };

/** Imported orders' Create invoice: the number (prefilled, editable) and the lines (editable, add / remove). */
export function ImportedInvoiceDialog({
  open,
  busy,
  number,
  lines,
  onNumber,
  onLines,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  number: string;
  lines: InvoiceLineDraft[];
  onNumber: (v: string) => void;
  onLines: (fn: (xs: InvoiceLineDraft[]) => InvoiceLineDraft[]) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const net = lines.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const setLine = (i: number, patch: Partial<InvoiceLineDraft>) => onLines((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="md">
      <DialogTitle>Create invoice</DialogTitle>
      <DialogContent>
        <TextField label="Invoice number" value={number} onChange={(e) => onNumber(e.target.value)} inputProps={{ maxLength: 40 }} sx={{ mt: 1, mb: 2, minWidth: 260 }} />
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell align="right" sx={{ width: 90 }}>
                  Qty
                </TableCell>
                <TableCell align="right" sx={{ width: 130 }}>
                  Unit price
                </TableCell>
                <TableCell align="right" sx={{ width: 120 }}>
                  Amount
                </TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <TextField size="small" fullWidth multiline maxRows={4} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} inputProps={{ "aria-label": `Line ${i + 1} description` }} />
                  </TableCell>
                  <TableCell align="right">
                    <TextField size="small" type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputProps={{ min: 0, step: "any", "aria-label": `Line ${i + 1} qty` }} />
                  </TableCell>
                  <TableCell align="right">
                    <TextField size="small" type="number" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} inputProps={{ step: "any", "aria-label": `Line ${i + 1} unit price` }} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {importedMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}
                  </TableCell>
                  <TableCell padding="checkbox">
                    <IconButton size="small" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 1} onClick={() => onLines((xs) => xs.filter((_x, k) => k !== i))}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Stack direction="row" alignItems="center" sx={{ mt: 1.5 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={() => onLines((xs) => [...xs, { description: "", quantity: "1", unitPrice: "0", priced: true }])}>
            Add line
          </Button>
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Total before GST {importedMoney(net)}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" disableElevation disabled={busy || net <= 0} onClick={onCreate}>
          Create draft invoice
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Imported orders: Mark complete (a reason is required). */
export function MarkCompleteDialog({ open, busy, reason, onReason, onClose, onConfirm }: { open: boolean; busy: boolean; reason: string; onReason: (v: string) => void; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>Mark complete</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth multiline minRows={2} label="Reason" value={reason} onChange={(e) => onReason(e.target.value)} inputProps={{ maxLength: 300 }} sx={{ mt: 1 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" disableElevation disabled={!reason.trim() || busy} onClick={onConfirm}>
          Mark complete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** AIMS orders: Cancel order (only where the list allows it), asked first; same words as the Orders list. */
export function CancelOrderDialog({ open, busy, orderNumber, hasInvoices, onClose, onConfirm }: { open: boolean; busy: boolean; orderNumber: string; hasInvoices: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>{`Cancel order ${orderNumber}?`}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {hasInvoices
            ? "Its jobs are cancelled, its DOs are marked Cancelled and its draft invoices Voided. The numbers are kept. This can't be undone."
            : "Its jobs are cancelled and their DOs are marked Cancelled. The numbers are kept. This can't be undone."}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Keep it
        </Button>
        <Button color="error" variant="contained" disableElevation onClick={onConfirm} disabled={busy}>
          Cancel order
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Unlink from order / Delete on a Documents row: asked first, naming the document. */
export function ConfirmRowDialog({ open, busy, title, text, confirmLabel, onClose, onConfirm }: { open: boolean; busy: boolean; title: string; text: string; confirmLabel: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{text}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Keep it
        </Button>
        <Button color="error" variant="contained" disableElevation onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
