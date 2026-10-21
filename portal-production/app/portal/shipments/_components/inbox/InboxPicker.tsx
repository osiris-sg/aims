/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// "Change order…" — the order / shipment picker (moved out of the Inbox page in
// round P: the Sales dashboard uses it too). Unchanged behaviour: the top 3
// candidates with why, a search over every shipment, several targets with an
// attachment each, a preview, then Accept or Save as suggestion.

import React, { useEffect, useMemo, useState } from "react";
import { Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useShipmentsApi, type InboxRow } from "../../_lib/api";
import { useOrders, useShipments } from "../../_lib/hooks";
import { fmtDateTime } from "../../_lib/format";
import { toast } from "../../_lib/toast";

/** One planned / done action in words. */
export const actionText = (a: InboxRow["planned"][number]) =>
  a.kind === "file"
    ? `${a.status === "done" ? "Filed" : a.status === "undone" ? "Removed" : a.status === "skipped" ? "Skip" : "File"} ${a.filename ?? ""}${a.docType ? ` as ${a.docType}` : ""}${a.ownerKind ? ` on the ${a.ownerKind === "supplierOrder" ? "supplier order (old)" : a.ownerKind}` : ""}${a.reason ? ` — ${a.reason}` : ""}`
    : a.kind === "field"
      ? `${a.status === "done" ? "Filled" : "Fill"} ${a.field} = ${a.value}${a.reason ? ` — ${a.reason}` : ""}`
      : `${a.status === "done" ? "Ticked" : "Tick"} ${a.label ?? "sent"}${a.reason ? ` — ${a.reason}` : ""}`;

/**
 * "Change order…": the top 3 candidates first (with why), then search every order / shipment (#n-seq · customer ·
 * B/L · product · qty · ETA). Pick one — or several for an email about more than one shipment, each attachment then
 * assigned to one of them. The preview shows what would be filed and filled; Accept does it.
 */
export function PickerDialog({ row, onClose, onDone }: { row: InboxRow | null; onClose: () => void; onDone: () => void }) {
  const api = useShipmentsApi();
  const orders = useOrders({ pageSize: 100 }, !!row);
  const ships = useShipments({ pageSize: 100 }, !!row);
  type Opt = { key: string; orderId: string; shipmentId: string | null; label: string; group: string };
  const options: Opt[] = useMemo(() => {
    const out: Opt[] = [];
    for (const s of ships.data?.items ?? []) {
      if (s.status === "CANCELLED" || !s.orderId) continue;
      out.push({
        key: `s:${s.id}`,
        orderId: s.orderId,
        shipmentId: s.id,
        group: "Shipments",
        label: [s.ref || "Shipment", s.customerName, s.blNumber ? `B/L ${s.blNumber}` : "B/L pending", s.productLine, s.eta ? `ETA ${fmtDateTime(s.eta).slice(0, 10)}` : null].filter(Boolean).join(" · "),
      });
    }
    for (const o of orders.data?.items ?? []) if (!o.shipmentCount) out.push({ key: `o:${o.id}`, orderId: o.id, shipmentId: null, group: "Orders without a shipment", label: [o.label, o.customerName, o.productLabel].filter(Boolean).join(" · ") });
    return out;
  }, [orders.data, ships.data]);
  const optOf = (orderId: string, shipmentId: string | null) => options.find((o) => o.orderId === orderId && o.shipmentId === shipmentId) ?? options.find((o) => o.orderId === orderId);
  const [picked, setPicked] = useState<Opt[]>([]);
  const [assignOf, setAssignOf] = useState<Record<number, string>>({});
  const [plan, setPlan] = useState<InboxRow["planned"] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!row) return;
    setPicked([]);
    setAssignOf({});
    setPlan(null);
  }, [row]);
  // Each attachment goes to one picked shipment (default: the first).
  const body = picked.map((p) => ({
    orderId: p.orderId,
    shipmentId: p.shipmentId,
    ...(picked.length > 1 && row ? { attachmentIndexes: row.attachments.map((a) => a.index).filter((i) => (assignOf[i] ?? picked[0].key) === p.key) } : {}),
  }));
  const sig = JSON.stringify(body);
  useEffect(() => {
    if (!row || !picked.length) return setPlan(null);
    let live = true;
    api
      .inboxPreview(row.id, body)
      .then((r) => live && setPlan(r.planned))
      .catch(() => live && setPlan(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, sig]);
  const save = async (accept: boolean) => {
    setBusy(true);
    try {
      await api.inboxAssign(row!.id, { targets: body, accept });
      toast.success(accept ? "Done — documents filed" : "Order changed — review and accept");
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "Could not change the order");
    } finally {
      setBusy(false);
    }
  };
  const cands = (row?.candidates ?? []).filter((c) => optOf(c.orderId, c.shipmentId));
  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus>
      <DialogTitle>Change order — “{row?.subject ?? ""}”</DialogTitle>
      <DialogContent dividers data-tour="inbox-picker">
        <Stack spacing={2}>
          {cands.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Best matches
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {cands.map((c) => {
                  const o = optOf(c.orderId, c.shipmentId)!;
                  const on = picked.some((p) => p.key === o.key);
                  return (
                    <Chip
                      key={o.key}
                      color={on ? "primary" : "default"}
                      variant={on ? "filled" : "outlined"}
                      label={`${c.ref}${c.reasons.length ? ` — ${c.reasons.join(", ")}` : ""}`}
                      onClick={() => setPicked((ps) => (on ? ps.filter((p) => p.key !== o.key) : [...ps, o]))}
                    />
                  );
                })}
              </Stack>
            </Box>
          )}
          <Autocomplete
            multiple
            options={options}
            value={picked}
            onChange={(_, v) => setPicked(v)}
            groupBy={(o) => o.group}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.key === b.key}
            filterSelectedOptions
            renderInput={(p) => <TextField {...p} label="Order / shipment (search #, customer, B/L, product)" size="small" />}
          />
          {picked.length > 1 && row && row.attachments.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Which shipment each attachment goes to
              </Typography>
              {row.attachments.map((a) => (
                <Stack key={a.index} direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="body2" sx={{ flex: 1, wordBreak: "break-all" }}>
                    {a.name}
                  </Typography>
                  <TextField select size="small" value={assignOf[a.index] ?? picked[0].key} onChange={(e) => setAssignOf((m) => ({ ...m, [a.index]: e.target.value }))} sx={{ minWidth: 200 }}>
                    {picked.map((p) => (
                      <MenuItem key={p.key} value={p.key}>
                        {p.label.split(" · ")[0]}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              ))}
            </Box>
          )}
          {picked.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Preview
              </Typography>
              {!plan ? (
                <CircularProgress size={18} />
              ) : !plan.length ? (
                <Typography variant="body2">Nothing to file or fill for this choice.</Typography>
              ) : (
                plan.map((a, k) => (
                  <Typography key={k} variant="body2" color={a.status === "skipped" ? "text.secondary" : undefined}>
                    • {actionText(a)}
                    {a.kind === "file" && a.ownerId ? ` → ${options.find((o) => o.shipmentId === a.ownerId || (o.orderId === a.ownerId && !o.shipmentId))?.label.split(" · ")[0] ?? ""}` : ""}
                  </Typography>
                ))
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={!picked.length || busy} onClick={() => void save(false)}>
          Save as suggestion
        </Button>
        <Button variant="contained" disabled={!picked.length || busy} onClick={() => void save(true)}>
          Accept
        </Button>
      </DialogActions>
    </Dialog>
  );
}

