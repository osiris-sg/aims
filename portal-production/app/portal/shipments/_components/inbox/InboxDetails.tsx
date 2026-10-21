/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round T — an email opens as its THREAD, like an email client: messages stacked oldest → newest, each
// expandable (the newest open), every message shown in full (EmailView). No summary / explanation text:
// only the key chips (B/L, PI, CI, contract, container…), the link chip ("→ #22-1 · step 4") and the
// actions Confirm / Change order / Not shipment. Shared by the Inbox and the Sales dashboard.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useShipmentsApi, type InboxMessage, type InboxRow } from "../../_lib/api";
import { fromParts, linkedChip, linkedFileLine, orderHref, rowStatus, whenShort } from "../../_lib/inbox-threads";
import { toast } from "../../_lib/toast";
import { actionText } from "./InboxPicker";
import { EmailView } from "./EmailView";
import { PiTablePanel } from "./PiTablePanel";

const KEY_LABEL: Record<string, string> = { blNo: "B/L", piNo: "PI", ciNo: "CI", contractNo: "Contract", containerNo: "Container", telexCode: "Telex", invoiceNo: "Invoice", poNo: "PO", vessel: "Vessel" };

/** The key chips of a message (record numbers the email names). */
export function KeyChips({ keys }: { keys: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(keys ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length));
  if (!entries.length) return null;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap data-tour="email-keys">
      {entries.map(([k, v]) => (
        <Chip key={k} size="small" variant="outlined" label={`${KEY_LABEL[k] ?? k} ${Array.isArray(v) ? v.join(", ") : String(v)}`} />
      ))}
    </Stack>
  );
}

/** "→ #22-1 · step 4" — where the email went or is suggested to go. */
export function LinkChip({ m }: { m: InboxMessage | InboxRow }) {
  const linked = (m as InboxMessage).linked;
  const ref = linked?.ref ?? m.matched ?? null;
  if (!ref) return <Chip size="small" variant="outlined" label="Not linked yet" />;
  const step = (linked?.files ?? []).map((f) => (f.stepNo ? `step ${f.stepNo}` : null)).find(Boolean) ?? null;
  const href = orderHref(m.orderId, m.shipmentId);
  const label = `→ ${ref}${step ? ` · ${step}` : ""}`;
  const chip = <Chip size="small" color={m.inboxState === "PROCESSED" ? "success" : "primary"} variant={m.inboxState === "PROCESSED" ? "filled" : "outlined"} clickable={!!href} label={label} title={(linked ? linkedChip(linked) : null) ?? undefined} data-tour="email-link-chip" />;
  return href ? (
    <Link href={href} style={{ textDecoration: "none" }}>
      {chip}
    </Link>
  ) : (
    chip
  );
}

/** Round U: the "AIMS" panel of a message — what AIMS found and will do: key chips, the file plan, the evidence note, notes. */
export function AimsPanel({ m }: { m: InboxMessage }) {
  const did = (m.done?.length ? m.done : m.planned ?? []).filter((a: any) => a.status !== "skipped");
  const files = m.linked?.files ?? [];
  const lines = files.length ? files.map(linkedFileLine) : did.map(actionText);
  const notes = (m as any).notes as string[] | undefined;
  const hasAnything = Object.values(m.keys ?? {}).some(Boolean) || lines.length || m.evidence || notes?.length || m.check?.length;
  if (!hasAnything) return null;
  return (
    <Box sx={{ mb: 1, p: 1, borderRadius: 1, bgcolor: "action.hover", border: "1px solid", borderColor: "divider" }} data-tour="email-aims-panel">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: lines.length || m.evidence ? 0.5 : 0 }}>
        <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1 }}>
          AIMS
        </Typography>
        <KeyChips keys={m.keys as any} />
      </Stack>
      {lines.map((l, i) => (
        <Typography key={i} variant="caption" component="div" title={l}>
          {m.done?.length ? "Filed: " : "Will file: "}
          {l}
        </Typography>
      ))}
      {!!m.check?.length && (
        <Typography variant="caption" component="div" color="error.main">
          Check: {m.check.join("; ")}
        </Typography>
      )}
      {m.evidence && (
        <Typography variant="caption" component="div" color="text.secondary" sx={{ fontStyle: "italic" }} data-tour="inbox-evidence">
          {m.evidence}
        </Typography>
      )}
      {notes?.map((n, i) => (
        <Typography key={`n${i}`} variant="caption" component="div" color="text.secondary">
          · {n}
        </Typography>
      ))}
    </Box>
  );
}

function MessageBlock({ m, open, onToggle, selected }: { m: InboxMessage; open: boolean; onToggle: () => void; selected: boolean }) {
  const from = fromParts(m.from);
  const status = rowStatus(m);
  return (
    <Box sx={{ border: "1px solid", borderColor: selected ? "primary.main" : "divider", borderRadius: 1, overflow: "hidden" }} data-tour="email-thread-message">
      <Stack direction="row" spacing={1} alignItems="center" onClick={onToggle} sx={{ px: 1.5, py: 1, cursor: "pointer", bgcolor: open ? "action.hover" : undefined }}>
        <IconButton size="small" aria-label={open ? "Collapse" : "Expand"}>{open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</IconButton>
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }} noWrap title={m.from}>
          {from.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {whenShort(m.date)}
        </Typography>
        {m.attachments.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            📎 {m.attachments.length}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {status && <Chip size="small" variant="outlined" color={status.tone === "auto" ? "success" : status.tone === "wait" ? "warning" : "default"} label={status.label} sx={{ height: 20 }} data-tour="email-thread-status" />}
        <LinkChip m={m} />
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <AimsPanel m={m} />
          <EmailView id={m.id} />
        </Box>
      </Collapse>
    </Box>
  );
}

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
  const api = useShipmentsApi();
  const id = open?.id ?? null;
  const thread = useQuery({ queryKey: ["trade-inbox", "thread", id], queryFn: () => api.inboxThread(id!), enabled: !!id, staleTime: 60_000 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The newest message opens; the one the person clicked opens too.
  useEffect(() => {
    if (!thread.data || !id) return;
    const newest = thread.data.messages[thread.data.messages.length - 1]?.id;
    setExpanded({ ...(newest ? { [newest]: true } : {}), [id]: true });
  }, [thread.data, id]);
  useEffect(() => {
    if (thread.isError) toast.error((thread.error as Error)?.message || "Could not load the thread");
  }, [thread.isError, thread.error]);
  const messages = thread.data?.messages ?? [];
  return (
    <Dialog open={!!open} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus data-tour="email-dialog">
      <DialogTitle sx={{ pr: 6 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h6" sx={{ fontWeight: 700, minWidth: 0 }} noWrap title={open?.subject ?? ""}>
            {open?.subject || "(no subject)"}
          </Typography>
          {open && <LinkChip m={open} />}
          {messages.length > 1 && <Chip size="small" variant="outlined" label={`${messages.length} emails in this thread`} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {open?.error && <Alert severity="warning" sx={{ mb: 1 }}>AI triage: {open.error}</Alert>}
        {thread.isLoading ? (
          <CircularProgress />
        ) : messages.length ? (
          <Stack spacing={1}>
            {messages.map((m) => (
              <MessageBlock key={m.id} m={m} open={!!expanded[m.id]} selected={m.id === id} onToggle={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))} />
            ))}
          </Stack>
        ) : open ? (
          <EmailView id={open.id} />
        ) : null}
        {open && (open.supplierOrderSuggestions ?? []).length > 0 && (
          <Box sx={{ mt: 2 }}>
            <PiTablePanel row={open} onApplied={onRowChanged} />
          </Box>
        )}
      </DialogContent>
      <DialogActions data-tour="inbox-dialog-actions">
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
            Change order
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

