/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round W — an email opens as its THREAD TIMELINE. First the RESULT, big and in plain words ("✅ Added to #16-2 —
// SUS · 6005 · 20.4 t · B/L 198GX06003" + one clickable line per filed document; "🔗 Linked to #15-1 — no
// documents filed."; "⏳ Waiting for you" + the question card), then Undo / Change order, the "why" behind a small
// "Why?" link, then the timeline: numbered 1 → n, oldest first, each with date + sender + first line, the newest
// marked "Latest" — click one to read it (From/To/Cc collapsed to one line). Per-email override: "This one is
// different" opens the picker for that email only.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link as MuiLink, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useShipmentsApi, type InboxAnswer, type InboxAnswerResult, type InboxLang, type InboxMessage, type InboxRow, type InboxThread } from "../../_lib/api";
import { L, resultBox, threadResult, timeline, type ResultBox } from "../../_lib/inbox-cards";
import { fromParts, orderHref, whenShort } from "../../_lib/inbox-threads";
import { toast } from "../../_lib/toast";
import { EmailView } from "./EmailView";
import { PiTablePanel } from "./PiTablePanel";
import { QuestionCard } from "./QuestionCard";

const KEY_LABEL: Record<string, string> = { blNo: "B/L", piNo: "PI", ciNo: "CI", contractNo: "Contract", containerNo: "Container", telexCode: "Telex", invoiceNo: "Invoice", poNo: "PO", vessel: "Vessel", voyage: "Voyage", orderRef: "Ref" };

/** The key chips of a message (record numbers the email names) — behind "Why?". */
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

/** The result box: the outcome first, big. */
export function ResultBoxView({ r, lines, lang }: { r: ResultBox; lines?: Array<{ text: string; href: string | null }>; lang: InboxLang }) {
  const color = r.tone === "done" ? "success.main" : r.tone === "link" ? "primary.main" : r.tone === "wait" ? "warning.main" : "text.secondary";
  const all = lines?.length ? lines : r.lines;
  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, border: "1px solid", borderColor: color, bgcolor: "action.hover" }} data-tour="result-box" data-tone={r.tone}>
      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.3, color }}>
        {lines?.length ? (lang === "ja" ? `${lines.length} 件の送り先` : `${lines.length} destinations`) : r.headline}
      </Typography>
      {all.map((l, i) => (
        <Typography key={i} variant="body2" component="div" sx={{ mt: 0.5 }}>
          •{" "}
          {l.href ? (
            <MuiLink component={Link} href={l.href} underline="hover">
              {l.text}
            </MuiLink>
          ) : (
            l.text
          )}
        </Typography>
      ))}
    </Box>
  );
}

/** "Why?" — the evidence, the notes, the raw key chips, the self-check. */
function WhyPanel({ m }: { m: InboxMessage }) {
  const lines = [...(m.sourceLines ?? []), ...(m.evidence ? [m.evidence] : []), ...((m as any).notes ?? []), ...(m.check?.length ? [`Check: ${m.check.join("; ")}`] : []), ...(m.selfCheck ? [`Re-checked ${whenShort(m.selfCheck.at)}: ${m.selfCheck.verdict.toLowerCase().replace(/_/g, " ")} — ${m.selfCheck.text}`] : [])];
  return (
    <Box sx={{ pl: 1, borderLeft: "3px solid", borderColor: "divider" }} data-tour="why-panel">
      <KeyChips keys={m.keys as any} />
      {lines.map((l, i) => (
        <Typography key={i} variant="caption" component="div" color="text.secondary">
          · {l}
        </Typography>
      ))}
      {m.by && (
        <Typography variant="caption" component="div" color="text.secondary">
          · {m.by.outcome === "AUTO" ? `Auto · ${m.by.autoLabel ?? ""}` : `${m.by.outcome.toLowerCase()} by ${m.by.name ?? "—"}${m.by.via === "whatsapp" ? " (WhatsApp)" : ""}`}
          {m.by.at ? ` · ${whenShort(m.by.at)}` : ""}
        </Typography>
      )}
    </Box>
  );
}

function TimelineRow({ n, m, latest, open, onToggle, lang, onDifferent }: { n: number; m: InboxMessage; latest: boolean; open: boolean; onToggle: () => void; lang: InboxLang; onDifferent?: (m: InboxMessage) => void }) {
  const from = fromParts(m.from);
  const r = resultBox(m, lang);
  const [why, setWhy] = useState(false);
  return (
    <Box sx={{ border: "1px solid", borderColor: latest ? "primary.main" : "divider", borderRadius: 1, overflow: "hidden" }} data-tour="timeline-row">
      <Stack direction="row" spacing={1} alignItems="center" onClick={onToggle} sx={{ px: 1.5, py: 1, cursor: "pointer", bgcolor: open ? "action.hover" : undefined }}>
        <Typography variant="caption" sx={{ fontWeight: 800, width: 20, flexShrink: 0 }}>
          {n}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {whenShort(m.date)}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, flexShrink: 0 }} noWrap title={m.from}>
          {from.name}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {m.preview || m.subject || ""}
        </Typography>
        {m.attachments.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            📎 {m.attachments.length}
          </Typography>
        )}
        {latest && <Chip size="small" color="primary" label={L[lang].latest} sx={{ height: 20 }} />}
        {!latest && r.tone !== "wait" && m.linked?.ref && <Chip size="small" variant="outlined" label={m.linked.ref} sx={{ height: 20 }} />}
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ fontWeight: 700, color: r.tone === "done" ? "success.main" : r.tone === "link" ? "primary.main" : r.tone === "wait" ? "warning.main" : "text.secondary" }}>
              {r.headline}
            </Typography>
            <Button size="small" onClick={() => setWhy((w) => !w)} sx={{ textTransform: "none", px: 0.5 }} data-tour="why-link">
              {L[lang].why}
            </Button>
            {onDifferent && m.inboxState !== "PROCESSED" && (
              <Button size="small" onClick={() => onDifferent(m)} sx={{ textTransform: "none", px: 0.5 }} data-tour="timeline-different">
                {L[lang].thisOneDifferent}
              </Button>
            )}
          </Stack>
          <Collapse in={why} unmountOnExit>
            <Box sx={{ mb: 1 }}>
              <WhyPanel m={m} />
            </Box>
          </Collapse>
          <EmailView id={m.id} compactHeaders company={m.company ?? null} lang={lang} />
        </Box>
      </Collapse>
    </Box>
  );
}

export function InboxDetailsDialog({
  open,
  thread,
  lang,
  onClose,
  onAnswer,
  onAnswerUndo,
  onCreateOrder,
  onChangeOrder,
  onUndo,
  pending,
  onRowChanged,
}: {
  open: InboxRow | null;
  /** The thread card it was opened from (its question + answer ids), when known. */
  thread?: InboxThread | null;
  lang: InboxLang;
  onClose: () => void;
  onAnswer: (t: InboxThread, a: InboxAnswer) => Promise<InboxAnswerResult | null>;
  onAnswerUndo: (r: InboxAnswerResult) => Promise<void>;
  onCreateOrder: (t: InboxThread) => void;
  onChangeOrder: (r: InboxRow) => void;
  onUndo: (r: InboxRow) => void;
  pending: boolean;
  onRowChanged: (r: InboxRow) => void;
}) {
  const api = useShipmentsApi();
  const id = open?.id ?? null;
  const q = useQuery({ queryKey: ["trade-inbox", "thread", id], queryFn: () => api.inboxThread(id!), enabled: !!id, staleTime: 60_000 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [why, setWhy] = useState(false);
  const [last, setLast] = useState<InboxAnswerResult | null>(null);
  const messages = q.data?.messages ?? [];
  // The newest message opens; the one the person clicked opens too.
  useEffect(() => {
    if (!q.data || !id) return;
    const newest = timeline(q.data.messages).find((x) => x.latest)?.m.id;
    setExpanded({ ...(newest ? { [newest]: true } : {}), [id]: true });
    setLast(null);
  }, [q.data, id]);
  useEffect(() => {
    if (q.isError) toast.error((q.error as Error)?.message || "Could not load the thread");
  }, [q.isError, q.error]);
  const labels = L[lang];
  const newest = timeline(messages).find((x) => x.latest)?.m ?? (open as InboxMessage | null);
  const r = messages.length ? threadResult(messages, whenShort, lang) : newest ? resultBox(newest as InboxMessage, lang) : null;
  const multi = messages.length ? threadResult(messages, whenShort, lang).multi : [];
  const waiting = thread?.question && thread.messages.some((m) => m.inboxState !== "PROCESSED");
  const href = newest?.linked?.ref ? orderHref(newest.linked.orderId, newest.linked.shipmentId) : null;
  return (
    <Dialog open={!!open} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus data-tour="email-dialog">
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, minWidth: 0 }} noWrap title={open?.subject ?? ""}>
          {open?.subject || "(no subject)"}
        </Typography>
        {messages.length > 1 && (
          <Typography variant="caption" color="text.secondary">
            {labels.emails(messages.length)}
          </Typography>
        )}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }} data-tour="email-dialog-close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {open?.error && <Alert severity="warning" sx={{ mb: 1 }}>AI triage: {open.error}</Alert>}
        {q.isLoading ? (
          <CircularProgress />
        ) : (
          <Stack spacing={1.5}>
            {last ? (
              <Alert severity={last.kind === "record" ? "success" : "info"} action={<Button size="small" color="inherit" onClick={() => void onAnswerUndo(last).then(() => setLast(null))}>{labels.undo}</Button>}>
                {last.text}
              </Alert>
            ) : waiting && thread ? (
              <QuestionCard t={thread} lang={lang} busy={pending} onAnswer={async (t, a) => setLast(await onAnswer(t, a))} onCreateOrder={onCreateOrder} onOpenThread={() => undefined} />
            ) : r ? (
              <>
                <ResultBoxView r={r} lines={multi} lang={lang} />
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {href && (
                    <Button component={Link} href={href} size="small" variant="outlined" sx={{ textTransform: "none" }}>
                      {newest?.linked?.ref}
                    </Button>
                  )}
                  {open?.canUndo && (
                    <Button size="small" variant="outlined" onClick={() => onUndo(open)} sx={{ textTransform: "none" }} data-tour="inbox-undo">
                      {labels.undo}
                    </Button>
                  )}
                  {open && !open.canUndo && open.inboxState !== "PROCESSED" && (
                    <Button size="small" variant="outlined" onClick={() => onChangeOrder(open)} sx={{ textTransform: "none" }} data-tour="inbox-change-order">
                      {labels.changeOrder}
                    </Button>
                  )}
                  <Button size="small" onClick={() => setWhy((w) => !w)} sx={{ textTransform: "none" }} data-tour="why-link">
                    {labels.why}
                  </Button>
                </Stack>
                <Collapse in={why} unmountOnExit>{newest && <WhyPanel m={newest as InboxMessage} />}</Collapse>
              </>
            ) : null}
            {messages.length > 0 && (
              <Stack spacing={0.75} data-tour="thread-timeline">
                {timeline(messages).map(({ n, m, latest }) => (
                  <TimelineRow key={m.id} n={n} m={m} latest={latest} lang={lang} open={!!expanded[m.id]} onToggle={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))} onDifferent={messages.length > 1 ? (mm) => onChangeOrder(mm) : undefined} />
                ))}
              </Stack>
            )}
            {!messages.length && open && <EmailView id={open.id} compactHeaders company={open.company ?? null} lang={lang} />}
            {open && (open.supplierOrderSuggestions ?? []).length > 0 && (
              <Box>
                <PiTablePanel row={open} onApplied={onRowChanged} />
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions data-tour="inbox-dialog-actions">
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          {lang === "ja" ? "閉じる" : "Close"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
