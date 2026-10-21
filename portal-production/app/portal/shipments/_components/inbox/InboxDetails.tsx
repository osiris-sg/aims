/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// An email's details window (keys found, attachments, planned / done actions,
// the Vedanta PI table) — shared by the Inbox and the Sales dashboard (round P).

import React, { useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type InboxRow } from "../../_lib/api";
import { fmtDateTime } from "../../_lib/format";
import { toast } from "../../_lib/toast";
import { actionText } from "./InboxPicker";

export function InboxDetailsDialog({
  open,
  onClose,
  onAccept,
  onChangeOrder,
  onNotShipment,
  pending,
  onRowChanged,
}: {
  open: InboxRow | null;
  onClose: () => void;
  onAccept: (r: InboxRow) => void;
  onChangeOrder: (r: InboxRow) => void;
  onNotShipment: (r: InboxRow) => void;
  pending: boolean;
  onRowChanged: (r: InboxRow) => void;
}) {
  return (
    <Dialog open={!!open} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus>
      <DialogTitle>{open?.subject || "(no subject)"}</DialogTitle>
      <DialogContent dividers>
        {open && (
          <Stack spacing={1.5}>
            <Typography variant="body2">
              {open.direction === "OUT" ? "Sent" : "Received"} · {open.counterparty} · {open.from} · {fmtDateTime(open.date)}
            </Typography>
            {open.error && <Alert severity="warning">AI triage: {open.error}</Alert>}
            <Box>
              <Typography variant="overline" color="text.secondary">
                Keys found
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {Object.entries(open.keys ?? {})
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <Chip key={k} size="small" variant="outlined" label={`${k}: ${v}`} />
                  ))}
                {!Object.values(open.keys ?? {}).some(Boolean) && <Typography variant="body2">None</Typography>}
              </Stack>
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary">
                Attachments
              </Typography>
              {open.attachments.map((a) => (
                <Typography key={a.index} variant="body2">
                  {a.name} {a.docType ? <Chip size="small" label={a.docType} sx={{ ml: 1 }} /> : null}
                </Typography>
              ))}
              {!open.attachments.length && <Typography variant="body2">None</Typography>}
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary">
                {open.done.length ? "Done" : "Planned"} {open.matched ? `on ${open.matched}` : ""}
              </Typography>
              {(open.done.length ? open.done : open.planned).map((a, i) => (
                <Typography key={i} variant="body2" color={a.status === "skipped" ? "text.secondary" : undefined}>
                  • {actionText(a)}
                </Typography>
              ))}
              {!(open.done.length ? open.done : open.planned).length && <Typography variant="body2">Nothing to do for this email.</Typography>}
            </Box>
            {!!open.check?.length && (
              <Alert severity="warning">
                Check this match: the subject says {open.check.join("; ")}. Re-assign it to the right order / shipment if needed.
              </Alert>
            )}
            {(open.supplierOrderSuggestions ?? []).length > 0 && <PiTablePanel row={open} onApplied={onRowChanged} />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions data-tour="inbox-dialog-actions">
        {/* Round N: the row's actions in the dialog too. Each closes the dialog first, then acts. */}
        {open && !open.canUndo && (
          <Button
            color="error"
            onClick={() => {
              const r = open;
              onClose();
              onNotShipment(r);
            }}
            sx={{ mr: "auto" }}
          >
            Not a shipment
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
        {open && !open.canUndo && open.inboxState !== "PROCESSED" && (
          <Button
            onClick={() => {
              const r = open;
              onClose();
              onChangeOrder(r);
            }}
          >
            Change order…
          </Button>
        )}
        {open?.inboxState === "SUGGESTED" && (
          <Button
            variant="contained"
            disabled={pending}
            onClick={() => {
              const r = open;
              onClose();
              onAccept(r);
            }}
          >
            Confirm
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Vedanta's PI table: the month's order each row fills (PI no., PI amount — blanks only), then "Apply". */
export function PiTablePanel({ row, onApplied }: { row: InboxRow; onApplied: (r: InboxRow) => void }) {
  const api = useShipmentsApi();
  const plan = useQuery({ queryKey: ["trade-orders", "pi-table", row.id, (row.supplierOrderResults ?? []).length], queryFn: () => api.inboxPiTable(row.id) });
  const [busy, setBusy] = useState(false);
  const fieldText = (f: Record<string, string | number>) =>
    Object.entries(f)
      .map(([k, v]) => (k === "piNo" ? `PI no. ${v}` : k === "piAmount" ? `PI amount ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : `${k} ${v}`))
      .join(", ");
  return (
    <Box data-tour="inbox-pi-table">
      <Typography variant="overline" color="text.secondary">
        Vedanta&apos;s PI table → the month&apos;s orders
      </Typography>
      {plan.isLoading ? (
        <CircularProgress size={18} />
      ) : (
        (plan.data?.rows ?? []).map((p, i) => (
          <Typography key={i} variant="body2">
            • {p.row.grade ?? "—"} · {p.row.contractNo} · {p.row.qtyMt ?? "—"} MT · PI {p.row.piNo ?? "—"} →{" "}
            {p.orderLabel ? (
              <b>
                {p.orderLabel}
                {Object.keys(p.fields).length ? `: fill ${fieldText(p.fields)}` : " (already filled)"}
              </b>
            ) : (
              <span style={{ opacity: 0.7 }}>{p.reason}</span>
            )}
          </Typography>
        ))
      )}
      {(row.supplierOrderResults ?? []).map((r, i) => (
        <Typography key={`r${i}`} variant="caption" color="text.secondary" component="div">
          {r.contractNo} {r.piNo ? `PI ${r.piNo}` : ""}
          {r.orderLabel ? ` → ${r.orderLabel}` : ""}: {r.action}
          {r.reason ? ` (${r.reason})` : ""}
        </Typography>
      ))}
      <Button
        size="small"
        variant="outlined"
        sx={{ mt: 1 }}
        disabled={busy || !(plan.data?.rows ?? []).some((p) => p.orderId && Object.keys(p.fields).length)}
        onClick={async () => {
          setBusy(true);
          try {
            const out = await api.inboxApplyPiTable(row.id);
            onApplied(out.row);
            toast.success(`PI table: ${out.results.map((r) => `${r.orderLabel ?? r.contractNo} ${r.action}`).join(", ")}`);
            await plan.refetch();
          } catch (e: any) {
            toast.error(e?.message || "Could not apply");
          } finally {
            setBusy(false);
          }
        }}
      >
        Fill the PI fields on these orders
      </Button>
    </Box>
  );
}

