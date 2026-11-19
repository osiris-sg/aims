"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import moment from "moment";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import PendingOutlinedIcon from "@mui/icons-material/PendingOutlined";
import MainCard from "@/components/MainCard";
import StatusPill from "../_components/StatusPill";
import { importedBilledPct, importedDocHref, importedLinkSourceLabel, importedMoney, importedProgress, importedStatusHue, importedSteps, type ImportedOrder } from "@/helpers/importedOrders";
import { request } from "@/helpers/request";
import { requestFailed } from "@/helpers/requestOutcome";

/**
 * An order imported from the old ERP (enableImportedOrders). Its quotation and imported invoices stay read-only.
 * Tracker Quotation -> Invoice, DO and Service report not applicable (the ERP's DO number as text).
 * 2026-11-19: a Part billed order offers "Create invoice" (a normal AIMS draft invoice for what is left, opened in
 * the editor) or "Open draft invoice"; any imported order can be marked complete (with a reason) and reopened.
 */
export default function ImportedOrderDetail({ order, onBack, onChanged }: { order: ImportedOrder; onBack: () => void; onChanged?: () => void }) {
  const q = order.sourceQuotation;
  const qHref = importedDocHref(q, "QUOTATION");
  const router = useRouter();
  const { getToken } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  // Failures show the portal's error toast; nothing here says "done" unless the call succeeded.
  const post = async (action: string, body: any = {}) => {
    setBusy(action);
    try {
      const token = await getToken();
      return await request({ path: `/orders/${order.id}/${action}`, method: "POST" }, body, token ?? undefined);
    } finally {
      setBusy(null);
    }
  };
  // Create invoice (2026-11-19): a dialog first: the number (prefilled, editable) and the lines (editable).
  const [invOpen, setInvOpen] = useState(false);
  const [invNumber, setInvNumber] = useState("");
  const [invLines, setInvLines] = useState<Array<{ description: string; quantity: string; unitPrice: string; priced: boolean }>>([]);
  const openInvoiceDialog = () => {
    setInvNumber(order.suggestedInvoiceNumber ?? "");
    setInvLines((order.remaining?.lines ?? []).map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), priced: l.priced })));
    setInvOpen(true);
  };
  const invNet = invLines.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const createInvoice = async () => {
    const res: any = await post("invoice-remaining", {
      number: invNumber.trim() || null,
      lines: invLines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    });
    if (requestFailed(res)) return;
    setInvOpen(false);
    const href = res?.data?.href ?? res?.href;
    if (href) router.push(href);
    else onChanged?.();
  };
  const markComplete = async () => {
    const res: any = await post("mark-complete", { reason: reason.trim() });
    if (requestFailed(res)) return;
    setCompleteOpen(false);
    setReason("");
    onChanged?.();
  };
  const reopen = async () => {
    const res: any = await post("reopen");
    if (requestFailed(res)) return;
    onChanged?.();
  };
  const draftHref = order.draftInvoice?.templateId ? `/portal/documents/INVOICE/${order.draftInvoice.templateId}/${order.draftInvoice.id}` : null;
  const left = (order.remaining?.lines ?? []).filter((l) => l.priced);
  return (
    <MainCard>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton size="small" onClick={onBack} aria-label="Back to orders">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          Orders
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {order.orderNumber}
        </Typography>
        <StatusPill label={order.statusLabel || order.status} color="default" hue={importedStatusHue(order.status)} />
        <StatusPill label="Imported" color="default" variant="outlined" />
        <Tooltip title="Imported from the old ERP: its quotation and the invoices the ERP linked to it. The imported documents are read-only.">
          <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {order.canInvoice && (
          <Button variant="contained" disableElevation size="small" disabled={!!busy} onClick={openInvoiceDialog} data-tour="imported-order-create-invoice">
            Create invoice
          </Button>
        )}
        {order.draftInvoice && draftHref && (
          <Button variant="contained" disableElevation size="small" onClick={() => router.push(draftHref)}>
            Open draft invoice {order.draftInvoice.name ?? ""}
          </Button>
        )}
        {order.canComplete && (
          <Button variant="outlined" size="small" disabled={!!busy} onClick={() => setCompleteOpen(true)} data-tour="imported-order-mark-complete">
            Mark complete
          </Button>
        )}
        {order.canReopen && (
          <Button variant="outlined" size="small" disabled={!!busy} onClick={() => void reopen()}>
            Reopen
          </Button>
        )}
      </Stack>

      <Stack direction="row" spacing={3} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
        <Field label="Customer" value={order.customer?.name || ""} />
        <Field label="Order date" value={q?.date ? moment(q.date).format("DD/MM/YYYY") : moment(order.createdAt).format("DD/MM/YYYY")} />
        <Field label="Subject" value={order.subject || ""} />
        <Field label="Quotation total" value={importedMoney(order.quoteTotal ?? q?.total ?? null)} />
        <Field label="Billed" value={importedMoney(order.billed ?? order.total)} />
        <Field label="Billed %" value={importedBilledPct(order.billedPct)} />
        {(order.billingSteps?.length ? true : !!importedProgress(order.progress)) && <Field label="Billed qty" value={order.billingSteps?.length ? importedSteps(order.billingSteps) : importedProgress(order.progress)} />}
        {order.remaining && order.status === "PART_BILLED" && <Field label="Left to bill" value={importedMoney(order.remaining.remainingGross)} />}
        {order.completed && (
          <Field
            label={order.completed.auto ? "Complete (assumed closed)" : "Marked complete"}
            value={[order.completed.reason, order.completed.byName, order.completed.at ? moment(order.completed.at).format("DD/MM/YYYY") : ""].filter(Boolean).join(", ")}
          />
        )}
        {!!order.credited && <Field label="Credited" value={importedMoney(order.credited)} />}
        <Field label="Owed" value={importedMoney(order.owed)} />
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 3 }} data-tour="imported-order-tracker">
        {order.tracker.map((s) => (
          <Box key={s.key} sx={{ flex: 1, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1, opacity: s.state === "na" ? 0.7 : 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              {s.state === "done" ? <CheckCircleIcon fontSize="small" color="success" /> : s.state === "todo" ? <PendingOutlinedIcon fontSize="small" color="warning" /> : <RemoveCircleOutlineIcon fontSize="small" sx={{ color: "text.disabled" }} />}
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {s.label}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {s.state === "na" ? (s.note ? `Not applicable, ${s.note}` : "Not applicable") : s.note || "Done"}
            </Typography>
          </Box>
        ))}
      </Stack>

      {order.status === "PART_BILLED" && left.length > 0 && (
        <Box sx={{ mb: 3 }} data-tour="imported-order-left-to-bill">
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Left to bill
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell align="right">Quoted</TableCell>
                  <TableCell align="right">Billed</TableCell>
                  <TableCell align="right">Left</TableCell>
                  <TableCell align="right">Unit price</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {left.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ whiteSpace: "pre-line" }}>{l.description.split("\n")[0]}</TableCell>
                    <TableCell align="right">{l.quotedQty ?? ""}</TableCell>
                    <TableCell align="right">{l.billedQty ?? ""}</TableCell>
                    <TableCell align="right">{l.quantity}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{importedMoney(l.unitPrice)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{importedMoney(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Documents
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Document</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Linked by</TableCell>
              <TableCell>ERP DO</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Owed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {q && (
              <DocRow href={qHref} name={`Quotation ${q.name ?? ""}`} date={q.date} state="" by="" doNo="" amount={q.total} owed={null} />
            )}
            {order.invoices.map((i) => (
              <DocRow key={i.id} href={importedDocHref(i, "INVOICE")} name={`Invoice ${i.name ?? ""}`} date={i.date} state={i.credit && i.state !== "CREDITED" ? `${i.stateLabel ?? ""}, credited ${importedMoney(i.credit)}` : i.stateLabel ?? ""} by={importedLinkSourceLabel(i.linkSource)} doNo={i.erpDoNumber || ""} amount={i.total} owed={i.owed} />
            ))}
            {order.creditNotes.map((c) => (
              <DocRow key={c.id} href={importedDocHref(c, "CREDIT_NOTE")} name={`Credit note ${c.name ?? ""}`} date={null} state="" by="" doNo="" amount={c.total} owed={null} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={invOpen} onClose={() => !busy && setInvOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Create invoice</DialogTitle>
        <DialogContent>
          <TextField label="Invoice number" value={invNumber} onChange={(e) => setInvNumber(e.target.value)} inputProps={{ maxLength: 40 }} sx={{ mt: 1, mb: 2, minWidth: 260 }} />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell align="right" sx={{ width: 90 }}>Qty</TableCell>
                  <TableCell align="right" sx={{ width: 130 }}>Unit price</TableCell>
                  <TableCell align="right" sx={{ width: 120 }}>Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invLines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        multiline
                        maxRows={4}
                        value={l.description}
                        onChange={(e) => setInvLines((xs) => xs.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))}
                        inputProps={{ "aria-label": `Line ${i + 1} description` }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField size="small" type="number" value={l.quantity} onChange={(e) => setInvLines((xs) => xs.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)))} inputProps={{ min: 0, step: "any", "aria-label": `Line ${i + 1} qty` }} />
                    </TableCell>
                    <TableCell align="right">
                      <TextField size="small" type="number" value={l.unitPrice} onChange={(e) => setInvLines((xs) => xs.map((x, k) => (k === i ? { ...x, unitPrice: e.target.value } : x)))} inputProps={{ step: "any", "aria-label": `Line ${i + 1} unit price` }} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{importedMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="body2" sx={{ mt: 1.5, textAlign: "right", fontWeight: 600 }}>
            Total before GST {importedMoney(invNet)}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvOpen(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="contained" disableElevation disabled={!!busy || invNet <= 0} onClick={() => void createInvoice()}>
            Create draft invoice
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={completeOpen} onClose={() => !busy && setCompleteOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Mark complete</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth multiline minRows={2} label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 300 }} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteOpen(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="contained" disableElevation disabled={!reason.trim() || !!busy} onClick={() => void markComplete()}>
            Mark complete
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}

function DocRow({ href, name, date, state, by, doNo, amount, owed }: { href: string | null; name: string; date?: string | null; state: string; by: string; doNo: string; amount?: number | null; owed: number | null }) {
  const router = useRouter();
  return (
    <TableRow hover sx={href ? { cursor: "pointer" } : undefined} onClick={() => href && router.push(href)}>
      <TableCell>{name}</TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>{date ? moment(date).format("DD/MM/YYYY") : ""}</TableCell>
      <TableCell>{state}</TableCell>
      <TableCell>{by}</TableCell>
      <TableCell>{doNo}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {importedMoney(amount)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {owed == null ? "" : importedMoney(owed)}
      </TableCell>
    </TableRow>
  );
}
