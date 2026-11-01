/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// "Change order…" — the order / shipment picker (moved out of the Inbox page in
// round P: the Sales dashboard uses it too). Unchanged behaviour: the top 3
// candidates with why, a search over every shipment, several targets with an
// attachment each, a preview, then Accept or Save as suggestion.

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useShipmentsApi, type InboxRow } from "../../_lib/api";
import { useOrders, useShipments } from "../../_lib/hooks";
import { fmtDateTime } from "../../_lib/format";
import { toast } from "../../_lib/toast";

/** One planned / done action in words. */
type Tr = (key: string, values?: Record<string, string | number>) => string;
export const actionText = (a: InboxRow["planned"][number], t: Tr) =>
  a.kind === "file"
    ? `${t(a.status === "done" ? "fileDone" : a.status === "undone" ? "fileUndone" : a.status === "skipped" ? "fileSkipped" : "file")} ${a.filename ?? ""}${a.docType ? ` ${t("asType", { type: a.docType })}` : ""}${a.ownerKind ? ` ${t("onOwner", { o: t(a.ownerKind === "supplierOrder" ? "ownerSupplierOrder" : a.ownerKind === "order" ? "ownerOrder" : "ownerShipment") })}` : ""}${a.reason ? ` — ${a.reason}` : ""}`
    : a.kind === "field"
      ? `${t(a.status === "done" ? "fieldDone" : "field")} ${a.field} = ${a.value}${a.reason ? ` — ${a.reason}` : ""}`
      : `${t(a.status === "done" ? "tickDone" : "tick")} ${a.label ?? t("sent")}${a.reason ? ` — ${a.reason}` : ""}`;

/**
 * "Change order…": the top 3 candidates first (with why), then search every order / shipment (#n-seq · customer ·
 * B/L · product · qty · ETA). Pick one — or several for an email about more than one shipment, each attachment then
 * assigned to one of them. The preview shows what would be filed and filled; Accept does it.
 */
export function PickerDialog({ row, onClose, onDone }: { row: InboxRow | null; onClose: () => void; onDone: () => void }) {
  const api = useShipmentsApi();
  const t = useTranslations("inbox.picker");
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
        group: t("groupShipments"),
        label: [s.ref || t("shipment"), s.customerName, s.blNumber ? `B/L ${s.blNumber}` : t("blPending"), s.productLine, s.eta ? `ETA ${fmtDateTime(s.eta).slice(0, 10)}` : null].filter(Boolean).join(" · "),
      });
    }
    for (const o of orders.data?.items ?? []) if (!o.shipmentCount) out.push({ key: `o:${o.id}`, orderId: o.id, shipmentId: null, group: t("groupOrders"), label: [o.label, o.customerName, o.productLabel].filter(Boolean).join(" · ") });
    return out;
  }, [orders.data, ships.data, t]);
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
      toast.success(accept ? t("accepted") : t("changed"));
      onDone();
    } catch (e: any) {
      toast.error(e?.message || t("couldNotChange"));
    } finally {
      setBusy(false);
    }
  };
  const cands = (row?.candidates ?? []).filter((c) => optOf(c.orderId, c.shipmentId));
  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus>
      <DialogTitle>{t("title", { subject: row?.subject ?? "" })}</DialogTitle>
      <DialogContent dividers data-tour="inbox-picker">
        <Stack spacing={2}>
          {cands.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t("bestMatches")}
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
            renderInput={(p) => <TextField {...p} label={t("searchLabel")} size="small" />}
          />
          {picked.length > 1 && row && row.attachments.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t("whichShipment")}
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
                {t("preview")}
              </Typography>
              {!plan ? (
                <CircularProgress size={18} />
              ) : !plan.length ? (
                <Typography variant="body2">{t("nothingToFile")}</Typography>
              ) : (
                plan.map((a, k) => (
                  <Typography key={k} variant="body2" color={a.status === "skipped" ? "text.secondary" : undefined}>
                    • {actionText(a, t)}
                    {a.kind === "file" && a.ownerId ? ` → ${options.find((o) => o.shipmentId === a.ownerId || (o.orderId === a.ownerId && !o.shipmentId))?.label.split(" · ")[0] ?? ""}` : ""}
                  </Typography>
                ))
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button disabled={!picked.length || busy} onClick={() => void save(false)}>
          {t("saveSuggestion")}
        </Button>
        <Button variant="contained" disabled={!picked.length || busy} onClick={() => void save(true)}>
          {t("accept")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

