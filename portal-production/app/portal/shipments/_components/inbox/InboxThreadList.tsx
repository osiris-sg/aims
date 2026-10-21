"use client";

// Round P: the inbox as threads. One row per thread (the thread's link chip,
// "5 emails · 3 files", the newest message's subject / sender / date); it
// expands to each message with its reason chip (why it needs a person), its
// "Linked to" chip (→ the shipment on its order page, step expanded), the
// per-attachment "COA.pdf → #28-1 · 3b · Certificate of analysis" lines and,
// once processed, who confirmed it and when. Presentational — the Inbox page
// and the Sales dashboard pass the data and the actions (the preview route
// renders it from fixtures).

import React, { useState } from "react";
import Link from "next/link";
import { Box, Button, Chip, Collapse, IconButton, Paper, Stack, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CallMadeIcon from "@mui/icons-material/CallMade";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import type { InboxMessage, InboxReason, InboxThread } from "../../_lib/api";
import { byLine, fromParts, linkedChip, linkedFileLine, orderHref, threadCounts, whatHappens, whenShort } from "../../_lib/inbox-threads";

export interface InboxActions {
  /** Round Q: "Create order from this thread" (No order yet). */
  onCreateOrder?: (t: InboxThread) => void;
  onConfirm: (m: InboxMessage) => void;
  onChangeOrder: (m: InboxMessage) => void;
  onNotShipment: (m: InboxMessage) => void;
  onUndo: (m: InboxMessage) => void;
  onOpen: (m: InboxMessage) => void;
  onMenu?: (m: InboxMessage, pos: { left: number; top: number }) => void;
  pending?: boolean;
}

const REASON_COLOR: Record<InboxReason["code"], "primary" | "warning" | "default" | "error"> = { CONFIRM: "primary", PICK_ORDER: "warning", PICK_SHIPMENT: "warning", CHECK: "error", IS_SHIPMENT: "default", NO_ORDER: "default" };

export function ReasonChip({ reason, title }: { reason: InboxReason | null | undefined; title?: string | null }) {
  if (!reason) return null;
  return <Chip size="small" color={REASON_COLOR[reason.code]} variant={reason.code === "CONFIRM" ? "filled" : "outlined"} label={reason.label} title={title ?? undefined} data-tour="inbox-reason" />;
}

/** The "Linked to" chip — a link to the shipment on its order page (the step expanded when known). */
/** Round R follow-up: a customer-level sheet (cost / price list) — filed under the customer, no order to open. */
export function GeneralChip({ customerKey }: { customerKey: string | null }) {
  return <Chip size="small" color="secondary" variant="outlined" label={`General${customerKey ? ` · ${customerKey}` : ""}`} title="A customer-level sheet (cost / price list), not tied to one order" data-tour="inbox-general" />;
}

export function LinkedChip({ m, label }: { m: InboxMessage; label?: string | null }) {
  const l = m.linked;
  const text = label ?? linkedChip(l);
  if (!l || !text) return null;
  const href = orderHref(l.orderId, l.shipmentId, l.files[0]?.stepId ?? null);
  const chip = <Chip size="small" color="primary" variant="outlined" clickable={!!href} label={text} title={l.label ?? undefined} data-tour="inbox-linked" />;
  return href ? (
    <Link href={href} onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none" }}>
      {chip}
    </Link>
  ) : (
    chip
  );
}

/** One message: who / subject / date, the reason or the by-line, the linked chip and what happens. */
export function MessageRow({ m, actions, showSubject = true, dense }: { m: InboxMessage; actions: InboxActions; showSubject?: boolean; dense?: boolean }) {
  const from = fromParts(m.from);
  const processed = m.inboxState === "PROCESSED";
  const by = byLine(m.by);
  return (
    <Box
      onClick={() => actions.onOpen(m)}
      sx={{ px: dense ? 1 : 1.5, py: dense ? 0.75 : 1, cursor: "pointer", borderTop: "1px solid", borderColor: "divider", "&:hover": { bgcolor: "action.hover" } }}
      data-tour="inbox-message"
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box sx={{ pt: 0.25, color: "text.secondary" }}>{m.direction === "OUT" ? <CallMadeIcon fontSize="small" titleAccess="Sent" /> : <CallReceivedIcon fontSize="small" titleAccess="Received" />}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={m.from}>
              {from.name}
            </Typography>
            {m.counterparty && <Chip size="small" variant="outlined" label={m.counterparty} sx={{ height: 20 }} />}
            <Typography variant="caption" color="text.secondary">
              {whenShort(m.date)}
            </Typography>
            {m.attachments.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                <AttachFileIcon sx={{ fontSize: 14 }} /> {m.attachments.length}
              </Typography>
            )}
            {!processed && <ReasonChip reason={m.reason} title={m.matchReason} />}
            {processed && by && (
              <Typography variant="caption" color={m.by?.outcome === "AUTO" ? "success.main" : "text.secondary"} data-tour="inbox-by">
                {by}
              </Typography>
            )}
          </Stack>
          {showSubject && (
            <Typography variant="body2" noWrap title={m.subject ?? ""}>
              {m.subject || "(no subject)"}
            </Typography>
          )}
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
            {m.linked ? <LinkedChip m={m} /> : m.general ? <GeneralChip customerKey={m.general.customerKey} /> : null}
            {m.linked?.label && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 420 }}>
                → {m.linked.label}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 520 }} title={whatHappens(m)}>
              {whatHappens(m)}
            </Typography>
          </Stack>
          {m.evidence && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25, fontStyle: "italic" }} title={m.evidence} data-tour="inbox-evidence">
              {m.evidence}
            </Typography>
          )}
          {m.linked && m.linked.files.length > 0 && (
            <Box sx={{ mt: 0.25 }}>
              {m.linked.files.map((f, i) => (
                <Typography key={i} variant="caption" color="text.secondary" component="div" noWrap title={linkedFileLine(f)}>
                  {linkedFileLine(f)}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center" onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0 }}>
          {m.canUndo && (
            <Button size="small" onClick={() => actions.onUndo(m)} data-tour="inbox-undo">
              Undo
            </Button>
          )}
          {m.inboxState === "SUGGESTED" && (
            <Button size="small" variant="contained" disabled={actions.pending} onClick={() => actions.onConfirm(m)} data-tour="inbox-confirm">
              Confirm
            </Button>
          )}
          {!m.canUndo && !processed && (
            <Button size="small" onClick={() => actions.onChangeOrder(m)} data-tour="inbox-change-order">
              Change order…
            </Button>
          )}
          {!m.canUndo && !processed && (
            <Button size="small" color="error" onClick={() => actions.onNotShipment(m)}>
              Not shipment
            </Button>
          )}
          {actions.onMenu && (
            <IconButton size="small" aria-label="Email actions" onClick={(e) => actions.onMenu!(m, { left: e.clientX, top: e.clientY })}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

/** A thread row: link chip, counts, the newest message; expands to every message. */
export function ThreadRow({ t, actions, defaultOpen = false }: { t: InboxThread; actions: InboxActions; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen || t.messages.length === 1);
  const newest = t.messages[0];
  const from = fromParts(newest?.from);
  const linkText = t.link ? (t.link.combined.length ? t.link.combined.map((c) => c.ref).filter(Boolean).join(" / ") : t.link.label ?? t.link.ref) : null;
  const href = t.link?.orderId ? orderHref(t.link.orderId, t.link.shipmentId) : null;
  return (
    <Paper variant="outlined" sx={{ mb: 1, overflow: "hidden" }} data-tour="inbox-thread">
      <Box onClick={() => setOpen((o) => !o)} sx={{ px: 1.5, py: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton size="small" aria-label={open ? "Collapse" : "Expand"} sx={{ mr: -0.5 }}>
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              {linkText ? (
                href ? (
                  <Link href={href} onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none" }}>
                    <Chip size="small" color={t.link?.from === "processed" ? "success" : "primary"} variant="outlined" clickable label={linkText} title={t.link?.combined.length ? "This thread covers several shipments" : undefined} />
                  </Link>
                ) : (
                  <Chip size="small" color="primary" variant="outlined" label={linkText} />
                )
              ) : t.general ? (
                <GeneralChip customerKey={t.general.customerKey} />
              ) : (
                <Chip size="small" variant="outlined" label="Not linked yet" />
              )}
              <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }} noWrap title={t.subject ?? ""}>
                {t.subject || "(no subject)"}
              </Typography>
            </Stack>
            {!open && newest && (
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {from.name}
                {newest.counterparty ? ` · ${newest.counterparty}` : ""}
                {` · ${whenShort(t.latest)}`}
                {` · ${threadCounts(t.emails, t.files)}`}
                {processedLine(newest)}
              </Typography>
            )}
          </Box>
          {!open && newest?.reason && <ReasonChip reason={newest.reason} title={newest.matchReason} />}
          {t.section === "NO_ORDER" && actions.onCreateOrder && (
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => {
                e.stopPropagation();
                actions.onCreateOrder!(t);
              }}
              data-tour="inbox-create-order"
              sx={{ whiteSpace: "nowrap" }}
            >
              Create order from this thread
            </Button>
          )}
        </Stack>
      </Box>
      <Collapse in={open} unmountOnExit>
        {t.messages.map((m) => (
          <MessageRow key={m.id} m={m} actions={actions} showSubject={t.messages.length > 1 && (m.subject ?? "") !== (t.subject ?? "")} />
        ))}
        {t.otherCount > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, py: 0.5, display: "block", borderTop: "1px solid", borderColor: "divider" }}>
            {t.otherCount} more message{t.otherCount === 1 ? "" : "s"} of this thread in the other tab
          </Typography>
        )}
      </Collapse>
    </Paper>
  );
}

/** "· Confirmed by Sayaka · 21 Oct 10:12" on a processed thread's folded line. */
const processedLine = (m: InboxMessage) => (m.inboxState === "PROCESSED" && m.by ? ` · ${byLine(m.by)}` : "");

/** Threads, with the "No order yet — create one?" threads grouped under their own heading (round Q). */
export function InboxThreadList({ threads, actions, emptyText }: { threads: InboxThread[]; actions: InboxActions; emptyText: string }) {
  if (!threads.length) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      </Paper>
    );
  }
  const noOrder = threads.filter((t) => t.section === "NO_ORDER");
  const rest = threads.filter((t) => t.section !== "NO_ORDER");
  return (
    <Box>
      {rest.map((t) => (
        <ThreadRow key={t.id} t={t} actions={actions} />
      ))}
      {noOrder.length > 0 && (
        <Box sx={{ mt: rest.length ? 2 : 0 }} data-tour="inbox-no-order">
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
            No order yet — create one? ({noOrder.length} thread{noOrder.length === 1 ? "" : "s"})
          </Typography>
          {noOrder.map((t) => (
            <ThreadRow key={t.id} t={t} actions={actions} />
          ))}
        </Box>
      )}
    </Box>
  );
}
