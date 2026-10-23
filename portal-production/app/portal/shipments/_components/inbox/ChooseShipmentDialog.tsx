"use client";

// Round AA — "Choose shipment": the confirm-first answer dialog of a question card. A search box, then a compact
// list with checkboxes (several can be ticked): AIMS's LIKELY ones first (the card's options, one line each, with
// "Select all"), a divider, then every other OPEN shipment ("#ref · customer · grade · net t · ETA dd Mon"). Under
// the list, the text options — "Not about a shipment", "New deal → Create order" (NEW_DEAL cards), "Ask later" —
// mutually exclusive with the ticks. NOTHING is applied until Confirm (the payload: `answerFor` in inbox-cards.ts).
// Closed with the X, Esc or a click outside. Phone: the list scrolls under the search box, the buttons wrap.

import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Radio, Stack, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import type { InboxAnswer, InboxLang, InboxThread, ShipmentListItem } from "../../_lib/api";
import { useShipments } from "../../_lib/hooks";
import { fmtDay, shortCustomer } from "../../_lib/format";
import { answerFor, L, likelyOptions, optionKey } from "../../_lib/inbox-cards";

type Special = "not_shipment" | "create" | "later";

/** "#18-2 · SUS · 6005 · 20.4 t · ETA 29 Oct" — one line of the All-shipments list. */
export function shipmentLine(s: ShipmentListItem): string {
  const net = s.netWeightMt !== null && s.netWeightMt !== undefined && s.netWeightMt !== "" && Number.isFinite(Number(s.netWeightMt)) ? `${Number(s.netWeightMt).toLocaleString("en-US", { maximumFractionDigits: 1 })} t` : null;
  const grade = s.order?.grade ?? s.contractLine?.grade ?? s.productLine ?? null;
  return [s.ref || (s.blNumber ? `B/L ${s.blNumber}` : "Shipment"), shortCustomer(s.customerName ?? s.customer?.name), grade, net, s.eta ? `ETA ${fmtDay(s.eta).slice(0, 6)}` : null].filter(Boolean).join(" · ");
}

/** The search text of a shipment row: ref, customer, grade, B/L, vessel. */
const haystack = (s: ShipmentListItem) => [s.ref, s.customerName, s.customer?.name, s.order?.grade, s.contractLine?.grade, s.productLine, s.blNumber, s.vessel].filter(Boolean).join(" ").toLowerCase();

export function ChooseShipmentDialog({ open, t, lang, busy, onClose, onAnswer, onCreateOrder }: { open: boolean; t: InboxThread; lang: InboxLang; busy?: boolean; onClose: () => void; onAnswer: (t: InboxThread, a: InboxAnswer) => void; onCreateOrder: (t: InboxThread) => void }) {
  const q = t.question;
  const labels = L[lang];
  const ships = useShipments({ status: "OPEN", pageSize: 200 }, open);
  const [search, setSearch] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [special, setSpecial] = useState<Special | null>(null);
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setTicked(new Set());
    setSpecial(null);
  }, [open, t.id]);

  const likely = useMemo(() => likelyOptions(q), [q]);
  const likelyKeys = useMemo(() => new Set(likely.map(optionKey)), [likely]);
  const others = useMemo(() => (ships.data?.items ?? []).filter((s) => s.status !== "CANCELLED" && !!s.orderId && !likelyKeys.has(optionKey({ orderId: s.orderId!, shipmentId: s.id }))), [ships.data, likelyKeys]);
  const needle = search.trim().toLowerCase();
  const likelyShown = needle ? likely.filter((o) => `${o.ref} ${o.summary} ${o.why}`.toLowerCase().includes(needle)) : likely;
  const othersShown = needle ? others.filter((s) => haystack(s).includes(needle)) : others;

  const toggle = (key: string) => {
    setSpecial(null);
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const pickSpecial = (s: Special) => {
    setTicked(new Set());
    setSpecial((cur) => (cur === s ? null : s));
  };
  const allLikelyTicked = likely.length > 0 && likely.every((o) => ticked.has(optionKey(o)));
  const selectAllLikely = () => {
    setSpecial(null);
    setTicked((prev) => {
      const next = new Set(prev);
      if (allLikelyTicked) likely.forEach((o) => next.delete(optionKey(o)));
      else likely.forEach((o) => next.add(optionKey(o)));
      return next;
    });
  };

  const targets = useMemo(() => {
    const out: Array<{ orderId: string; shipmentId: string | null }> = [];
    for (const o of likely) if (ticked.has(optionKey(o))) out.push({ orderId: o.orderId, shipmentId: o.shipmentId });
    for (const s of others) if (ticked.has(optionKey({ orderId: s.orderId!, shipmentId: s.id }))) out.push({ orderId: s.orderId!, shipmentId: s.id });
    return out;
  }, [likely, others, ticked]);
  const canConfirm = !busy && (special !== null || targets.length > 0);

  const confirm = () => {
    if (!q) return;
    if (special === "create") {
      onClose();
      onCreateOrder(t);
      return;
    }
    const a = answerFor(special === "not_shipment" ? { kind: "not_shipment" } : special === "later" ? { kind: "later" } : { kind: "shipments", targets }, q.kind);
    if (!a) return;
    onClose();
    onAnswer(t, a);
  };

  if (!q) return null;
  // Owner (round AA): the create-order option only when it looks like a new deal.
  const showCreate = q.kind === "NEW_DEAL";
  const row = (key: string, primary: string, secondary?: string | null, tour?: string) => (
    <ListItemButton key={key} dense onClick={() => toggle(key)} selected={ticked.has(key)} sx={{ py: 0.25, px: 1 }} data-tour={tour}>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Checkbox edge="start" size="small" checked={ticked.has(key)} tabIndex={-1} disableRipple />
      </ListItemIcon>
      <ListItemText primary={primary} secondary={secondary || undefined} primaryTypographyProps={{ variant: "body2", fontWeight: 600, sx: { wordBreak: "break-word" } }} secondaryTypographyProps={{ variant: "caption", sx: { wordBreak: "break-word" } }} />
    </ListItemButton>
  );
  const textOption = (s: Special, label: string, tour: string) => (
    <FormControlLabel
      key={s}
      control={<Radio size="small" checked={special === s} onClick={() => pickSpecial(s)} />}
      label={<Typography variant="body2">{label}</Typography>}
      sx={{ mr: 0, ml: 0 }}
      data-tour={tour}
    />
  );
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus data-tour="choose-shipment-dialog">
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700 }}>
          {q.kind === "NEW_DEAL" || q.kind === "IS_SHIPMENT" ? labels.answer : labels.chooseShipment}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {q.title}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }} data-tour="choose-shipment-close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <Box sx={{ px: 3, pb: 1.5 }}>
        <TextField
          size="small"
          fullWidth
          autoFocus
          placeholder={labels.searchShipments}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          inputProps={{ "data-tour": "choose-shipment-search" }}
        />
      </Box>
      <DialogContent dividers sx={{ p: 0 }}>
        {likelyShown.length > 0 && (
          <Box sx={{ px: 2, pt: 1 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="overline" color="text.secondary">
                {labels.likely}
              </Typography>
              <Button size="small" onClick={selectAllLikely} sx={{ textTransform: "none" }} data-tour="choose-shipment-select-all">
                {labels.selectAll}
              </Button>
            </Stack>
            <List dense disablePadding data-tour="choose-shipment-likely">
              {likelyShown.map((o) => row(optionKey(o), o.summary || o.ref, o.summary && o.summary.includes(o.ref) ? null : o.ref, "choose-shipment-option"))}
            </List>
          </Box>
        )}
        {likelyShown.length > 0 && <Divider sx={{ my: 1 }} />}
        <Box sx={{ px: 2, pb: 1 }}>
          <Typography variant="overline" color="text.secondary">
            {labels.allShipments}
          </Typography>
          {ships.isLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              {labels.loadingShipments}
            </Typography>
          ) : othersShown.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              {labels.noShipments}
            </Typography>
          ) : (
            <List dense disablePadding data-tour="choose-shipment-all">
              {othersShown.map((s) => row(optionKey({ orderId: s.orderId!, shipmentId: s.id }), shipmentLine(s), null, "choose-shipment-row"))}
            </List>
          )}
        </Box>
        <Divider />
        <Stack sx={{ px: 2, py: 1 }} data-tour="choose-shipment-text-options">
          {textOption("not_shipment", labels.notShipment, "choose-shipment-not-shipment")}
          {showCreate && textOption("create", labels.createOrder, "choose-shipment-create-order")}
          {textOption("later", labels.askLater, "choose-shipment-later")}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          {targets.length ? labels.picked(targets.length) : ""}
        </Typography>
        <Button onClick={onClose} color="inherit" sx={{ textTransform: "none" }} data-tour="choose-shipment-cancel">
          {labels.cancel}
        </Button>
        <Button variant="contained" disabled={!canConfirm} onClick={confirm} sx={{ textTransform: "none" }} data-tour="choose-shipment-confirm">
          {labels.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
