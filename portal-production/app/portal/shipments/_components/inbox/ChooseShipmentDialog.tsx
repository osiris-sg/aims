"use client";

// Round AF (owner) — "Answer" is a STEP-BY-STEP flow: one question per screen, a Back button, nothing applied until
// the last Confirm.
//   Step 1  the card's own question, two big buttons Yes / No
//           new-deal card: Yes → the Create-order form (prefilled from the thread) · No → step 2
//           "which shipment" / "is it a shipment" cards: "Is this email about a shipment?" Yes → step 3 · No → step 2
//   Step 2  "What is it then?" — It's about an existing shipment → step 3 · Not about a shipment → Confirm · Ask me later → snoozed a day, done
//   Step 3  "Which shipment?" — search + the list (Likely first, then every open shipment), checkboxes, Next
//   Confirm plain words ("Link this email (9 emails in the thread) to #19-1 and #19-2?") with Back / Confirm
// Keyboard: Enter = the step's primary action, Esc = close. Same component on the Dashboard cards and in See all emails.

import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Stack, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import type { InboxAnswer, InboxLang, InboxThread, ShipmentListItem } from "../../_lib/api";
import { useShipments } from "../../_lib/hooks";
import { fmtDay, shortCustomer } from "../../_lib/format";
import { answerFor, L, likelyOptions, optionKey } from "../../_lib/inbox-cards";

type Step = "q1" | "what" | "which" | "confirm";
type Outcome = { kind: "shipments"; targets: Array<{ orderId: string; shipmentId: string | null }>; refs: string[] } | { kind: "not_shipment" };

/** "#18-2 · SUS · 6005 · 20.4 t · ETA 29 Oct" — one line of the All-shipments list. */
export function shipmentLine(s: ShipmentListItem): string {
  const net = s.netWeightMt !== null && s.netWeightMt !== undefined && s.netWeightMt !== "" && Number.isFinite(Number(s.netWeightMt)) ? `${Number(s.netWeightMt).toLocaleString("en-US", { maximumFractionDigits: 1 })} t` : null;
  const grade = s.order?.grade ?? s.contractLine?.grade ?? s.productLine ?? null;
  return [s.ref || (s.blNumber ? `B/L ${s.blNumber}` : "Shipment"), shortCustomer(s.customerName ?? s.customer?.name), grade, net, s.eta ? `ETA ${fmtDay(s.eta).slice(0, 6)}` : null].filter(Boolean).join(" · ");
}

/** The search text of a shipment row: ref, customer, grade, B/L, vessel. */
const haystack = (s: ShipmentListItem) => [s.ref, s.customerName, s.customer?.name, s.order?.grade, s.contractLine?.grade, s.productLine, s.blNumber, s.vessel].filter(Boolean).join(" ").toLowerCase();

/** The "yes" / "no" of step 1 for this card. */
export function stepOneQuestion(kind: InboxThread["question"] extends infer Q ? (Q extends { kind: infer K } ? K : never) : never, title: string, lang: InboxLang): string {
  return kind === "NEW_DEAL" ? title : L[lang].isShipmentQ;
}

export function ChooseShipmentDialog({ open, t, lang, busy, onClose, onAnswer, onCreateOrder }: { open: boolean; t: InboxThread; lang: InboxLang; busy?: boolean; onClose: () => void; onAnswer: (t: InboxThread, a: InboxAnswer) => void; onCreateOrder: (t: InboxThread) => void }) {
  const q = t.question;
  const labels = L[lang];
  const [step, setStep] = useState<Step>("q1");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [search, setSearch] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const ships = useShipments({ status: "OPEN", pageSize: 200 }, open && step === "which");
  useEffect(() => {
    if (!open) return;
    setStep("q1");
    setOutcome(null);
    setSearch("");
    setTicked(new Set());
  }, [open, t.id]);

  const likely = useMemo(() => likelyOptions(q), [q]);
  const likelyKeys = useMemo(() => new Set(likely.map(optionKey)), [likely]);
  const others = useMemo(() => (ships.data?.items ?? []).filter((s) => s.status !== "CANCELLED" && !!s.orderId && !likelyKeys.has(optionKey({ orderId: s.orderId!, shipmentId: s.id }))), [ships.data, likelyKeys]);
  const needle = search.trim().toLowerCase();
  const likelyShown = needle ? likely.filter((o) => `${o.ref} ${o.summary} ${o.why}`.toLowerCase().includes(needle)) : likely;
  const othersShown = needle ? others.filter((s) => haystack(s).includes(needle)) : others;
  const toggle = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const picked = useMemo(() => {
    const out: Array<{ orderId: string; shipmentId: string | null; ref: string }> = [];
    for (const o of likely) if (ticked.has(optionKey(o))) out.push({ orderId: o.orderId, shipmentId: o.shipmentId, ref: o.ref });
    for (const s of others) if (ticked.has(optionKey({ orderId: s.orderId!, shipmentId: s.id }))) out.push({ orderId: s.orderId!, shipmentId: s.id, ref: s.ref || shipmentLine(s) });
    return out;
  }, [likely, others, ticked]);
  const emails = t.answerIds?.length || t.emails || 1;

  if (!q) return null;
  const isDeal = q.kind === "NEW_DEAL";

  // ── the steps' actions ──
  const yes = () => {
    if (isDeal) {
      onClose();
      onCreateOrder(t);
      return;
    }
    setStep("which");
  };
  const no = () => setStep("what");
  const notShipment = () => {
    setOutcome({ kind: "not_shipment" });
    setStep("confirm");
  };
  const later = () => {
    onClose();
    onAnswer(t, { kind: "later" });
  };
  const next = () => {
    if (!picked.length) return;
    setOutcome({ kind: "shipments", targets: picked.map((p) => ({ orderId: p.orderId, shipmentId: p.shipmentId })), refs: picked.map((p) => p.ref) });
    setStep("confirm");
  };
  const confirm = () => {
    if (!outcome) return;
    const a = answerFor(outcome.kind === "not_shipment" ? { kind: "not_shipment" } : { kind: "shipments", targets: outcome.targets }, q.kind);
    if (!a) return;
    onClose();
    onAnswer(t, a);
  };
  const back = () => setStep(step === "confirm" ? (outcome?.kind === "shipments" ? "which" : "what") : step === "which" ? (isDeal ? "what" : "q1") : "q1");
  const primary = step === "q1" ? yes : step === "which" ? next : step === "confirm" ? confirm : null;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || !primary || busy) return;
    if (step === "which" && !picked.length) return;
    e.preventDefault();
    primary();
  };

  const big = (label: string, onClick: () => void, tour: string, variant: "contained" | "outlined" = "outlined") => (
    <Button key={tour} size="large" variant={variant} disabled={busy} onClick={onClick} sx={{ textTransform: "none", py: 1.5, fontSize: 16, justifyContent: "flex-start" }} data-tour={tour}>
      {label}
    </Button>
  );
  const row = (key: string, primaryText: string, secondary?: string | null, tour?: string) => (
    <ListItemButton key={key} dense onClick={() => toggle(key)} selected={ticked.has(key)} sx={{ py: 0.25, px: 1 }} data-tour={tour}>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Checkbox edge="start" size="small" checked={ticked.has(key)} tabIndex={-1} disableRipple />
      </ListItemIcon>
      <ListItemText primary={primaryText} secondary={secondary || undefined} primaryTypographyProps={{ variant: "body2", fontWeight: 600, sx: { wordBreak: "break-word" } }} secondaryTypographyProps={{ variant: "caption", sx: { wordBreak: "break-word" } }} />
    </ListItemButton>
  );
  const title = step === "q1" ? (isDeal ? q.title : labels.isShipmentQ) : step === "what" ? labels.whatThen : step === "which" ? labels.whichShipment : outcome?.kind === "shipments" ? labels.confirmLink(emails, outcome.refs.join(lang === "ja" ? "、" : " and ")) : isDeal ? labels.confirmNotDeal(emails) : labels.confirmNot(emails);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus onKeyDown={onKeyDown} data-tour="answer-flow" data-step={step}>
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, wordBreak: "break-word" }} data-tour="answer-step-title">
          {title}
        </Typography>
        {step === "q1" && !isDeal && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: "break-word" }}>
            {t.subject || ""}
          </Typography>
        )}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }} data-tour="answer-flow-close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      {step === "q1" && (
        <DialogContent dividers>
          <Stack spacing={1.25} data-tour="answer-step-q1">
            {big(labels.yes, yes, "answer-yes", "contained")}
            {big(labels.no, no, "answer-no")}
          </Stack>
        </DialogContent>
      )}
      {step === "what" && (
        <DialogContent dividers>
          <Stack spacing={1.25} data-tour="answer-step-what">
            {big(labels.existingShipment, () => setStep("which"), "answer-existing")}
            {big(isDeal ? labels.notDeal : labels.notShipment, notShipment, "answer-not-shipment")}
            {big(labels.askMeLater, later, "answer-later")}
          </Stack>
        </DialogContent>
      )}
      {step === "which" && (
        <>
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
                <Typography variant="overline" color="text.secondary">
                  {labels.likely}
                </Typography>
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
          </DialogContent>
        </>
      )}
      {step === "confirm" && (
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" data-tour="answer-step-confirm">
            {outcome?.kind === "shipments" ? (lang === "ja" ? "確定すると、このスレッドの未処理メールがその出荷に紐付き、書類は該当ステップに登録されます。元に戻せます。" : "On Confirm the thread's unprocessed emails are linked there and their documents filed on the matching steps. You can undo it.") : lang === "ja" ? "確定するとメールは非表示になります（設定 → メールフィルター → 非表示 から戻せます）。" : "On Confirm the emails are hidden (Settings → Email filter → Hidden brings them back)."}
          </Typography>
        </DialogContent>
      )}
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2 }}>
        {step !== "q1" && (
          <Button onClick={back} color="inherit" startIcon={<ArrowBackIcon />} sx={{ textTransform: "none", mr: "auto" }} data-tour="answer-back">
            {labels.back}
          </Button>
        )}
        {step === "which" && (
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
            {picked.length ? labels.picked(picked.length) : ""}
          </Typography>
        )}
        <Button onClick={onClose} color="inherit" sx={{ textTransform: "none" }} data-tour="choose-shipment-cancel">
          {labels.cancel}
        </Button>
        {step === "which" && (
          <Button variant="contained" disabled={!picked.length || busy} onClick={next} sx={{ textTransform: "none" }} data-tour="answer-next">
            {labels.next}
          </Button>
        )}
        {step === "confirm" && (
          <Button variant="contained" disabled={busy} onClick={confirm} sx={{ textTransform: "none" }} data-tour="choose-shipment-confirm">
            {labels.confirm}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
