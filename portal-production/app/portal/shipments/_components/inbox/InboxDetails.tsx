/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round W — an email opens as its THREAD TIMELINE. First the RESULT, big and in plain words ("✅ Added to #16-2 —
// SUS · 6005 · 20.4 t · B/L 198GX06003" + one clickable line per filed document; "🔗 Linked to #15-1 — no
// documents filed."; "⏳ Waiting for you"), then Undo / Change order.
// Round AA — the EMAIL comes first: the newest email is shown expanded right under the result box (the styled email
// + attachments), then the timeline of the EARLIER emails: numbered 1 → n-1, oldest first, each with date + sender +
// first line — click one to read it. A waiting thread's "Answer" opens the step-by-step flow (ChooseShipmentDialog).
// Round AF (owner) — no "Why?" link and no key chips on screen (the evidence stays in the DB / Activity Log); ONE
// scroll bar (the email frames grow to their content, nothing nested scrolls); "All files in this thread (n)" at the
// top — every attachment of every stored email, newest first, with date + sender, preview + download; each earlier
// email shows ITS attachments by name and opens with preview + download; one grey line when the replies quote earlier
// emails AIMS never received. Clicking a filed document opens the order page on that shipment, step and file.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link as MuiLink, Stack, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useShipmentsApi, type InboxAnswer, type InboxAnswerResult, type InboxLang, type InboxMessage, type InboxRow, type InboxThread, type InboxThreadFile } from "../../_lib/api";
import { cardFromLine, L, resultBox, threadResult, timeline, type ResultBox } from "../../_lib/inbox-cards";
import { fromParts, orderHref, whenShort } from "../../_lib/inbox-threads";
import { fmtSize } from "../../_lib/email-html";
import { toast } from "../../_lib/toast";
import { EmailView } from "./EmailView";
import { PiTablePanel } from "./PiTablePanel";
import { ChooseShipmentDialog } from "./ChooseShipmentDialog";

/** Inline signature / logo images never count as attachments in these lists (mirrors the backend's isInlineImage). */
export const isInlineImageName = (name: string) => /^(image\d*|Outlook-[A-Za-z0-9]+|~?WRD\d*|oledata)\.(png|jpe?g|gif|bmp|emz)$/i.test((name ?? "").trim());

/** The result box: the outcome first, big. */
export function ResultBoxView({ r, lines, lang }: { r: ResultBox; lines?: Array<{ text: string; href: string | null }>; lang: InboxLang }) {
  const color = r.tone === "done" ? "success.main" : r.tone === "link" ? "primary.main" : r.tone === "wait" ? "warning.main" : "text.secondary";
  const all = lines?.length ? lines : r.lines;
  return (
    <Box sx={{ p: 1.5, borderRadius: 1.5, border: "1px solid", borderColor: color, bgcolor: "action.hover" }} data-tour="result-box" data-tone={r.tone}>
      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.3, color, wordBreak: "break-word" }}>
        {lines?.length ? (lang === "ja" ? `${lines.length} 件の送り先` : `${lines.length} destinations`) : r.headline}
      </Typography>
      {all.map((l, i) => (
        <Typography key={i} variant="body2" component="div" sx={{ mt: 0.5, wordBreak: "break-word" }}>
          •{" "}
          {l.href ? (
            <MuiLink component={Link} href={l.href} underline="hover" data-tour="result-file-link">
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

/** One file of the thread: name · date · sender, with Preview (PDF / image, inline) and Download — the URL is fetched on demand. */
function ThreadFileRow({ f, lang }: { f: InboxThreadFile; lang: InboxLang }) {
  const api = useShipmentsApi();
  const labels = L[lang];
  const [url, setUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const isPdf = /pdf/i.test(f.contentType ?? "") || /\.pdf$/i.test(f.name);
  const isImage = /^image\//i.test(f.contentType ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
  const fetchUrl = async (): Promise<string | null> => {
    if (url) return url;
    setBusy(true);
    try {
      const r = await api.inboxAttachmentUrl(f.emailId, f.index);
      setUrl(r.url);
      return r.url;
    } catch (e: any) {
      toast.error(e?.message || "Could not get the file");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const who = (f.company ?? "").trim() || fromParts(f.from).name;
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1, py: 0.5 }} data-tour="thread-file">
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
            📎 {f.name}
            {f.size ? <span style={{ opacity: 0.6, fontWeight: 400 }}> · {fmtSize(f.size)}</span> : null}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {whenShort(f.date)} · {who}
          </Typography>
        </Box>
        {(isPdf || isImage) && (
          <Tooltip title={labels.preview}>
            <IconButton
              size="small"
              disabled={busy}
              aria-label={labels.preview}
              onClick={async () => {
                if (preview) return setPreview(false);
                if (await fetchUrl()) setPreview(true);
              }}
            >
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={labels.download}>
          <IconButton
            size="small"
            disabled={busy}
            aria-label={labels.download}
            onClick={async () => {
              const u = await fetchUrl();
              if (u) window.open(u, "_blank", "noopener,noreferrer");
            }}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Collapse in={preview && !!url} unmountOnExit>
        <Box sx={{ mt: 1, borderRadius: 1, overflow: "hidden", bgcolor: "background.default" }}>
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url!} alt={f.name} style={{ maxWidth: "100%", display: "block" }} />
          ) : (
            <iframe title={f.name} src={url!} sandbox="" style={{ width: "100%", height: 900, border: 0 }} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/** "All files in this thread (n)": every attachment of every stored email, newest first; the gap line when the replies quote emails AIMS never received. */
function ThreadFiles({ files, quotedMissing, lang }: { files: InboxThreadFile[]; quotedMissing: number; lang: InboxLang }) {
  const labels = L[lang];
  const [open, setOpen] = useState(true);
  if (!files.length && !quotedMissing) return null;
  return (
    <Box data-tour="thread-files">
      {files.length > 0 && (
        <>
          <Button size="small" onClick={() => setOpen((o) => !o)} sx={{ textTransform: "none", px: 0.5, fontWeight: 700 }} data-tour="thread-files-toggle">
            {labels.threadFiles(files.length)} {open ? "▾" : "▸"}
          </Button>
          <Collapse in={open}>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {files.map((f) => (
                <ThreadFileRow key={`${f.emailId}:${f.index}`} f={f} lang={lang} />
              ))}
            </Stack>
          </Collapse>
        </>
      )}
      {quotedMissing > 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }} data-tour="thread-gap">
          {labels.notForwarded}
        </Typography>
      )}
    </Box>
  );
}

function TimelineRow({ n, m, latest, open, onToggle, lang, onDifferent }: { n: number; m: InboxMessage; latest: boolean; open: boolean; onToggle: () => void; lang: InboxLang; onDifferent?: (m: InboxMessage) => void }) {
  const from = fromParts(m.from);
  const r = resultBox(m, lang);
  const atts = m.attachments.filter((a) => !isInlineImageName(a.name));
  return (
    <Box sx={{ border: "1px solid", borderColor: latest ? "primary.main" : "divider", borderRadius: 1 }} data-tour="timeline-row">
      <Stack direction="row" spacing={1} alignItems="flex-start" onClick={onToggle} sx={{ px: 1.5, py: 1, cursor: "pointer", bgcolor: open ? "action.hover" : undefined }}>
        <Typography variant="caption" sx={{ fontWeight: 800, width: 20, flexShrink: 0, pt: 0.25 }}>
          {n}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">
              {whenShort(m.date)}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: "break-word" }} title={m.from}>
              {from.name}
            </Typography>
            {latest && <Chip size="small" color="primary" label={L[lang].latest} sx={{ height: 20 }} />}
            {!latest && r.tone !== "wait" && m.linked?.ref && <Chip size="small" variant="outlined" label={m.linked.ref} sx={{ height: 20 }} />}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
            {m.preview || m.subject || ""}
          </Typography>
          {atts.length > 0 && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }} data-tour="timeline-attachments">
              📎 {atts.map((a) => a.name).join(" · ")}
            </Typography>
          )}
        </Box>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ fontWeight: 700, color: r.tone === "done" ? "success.main" : r.tone === "link" ? "primary.main" : r.tone === "wait" ? "warning.main" : "text.secondary" }}>
              {r.headline}
            </Typography>
            {onDifferent && m.inboxState !== "PROCESSED" && (
              <Button size="small" onClick={() => onDifferent(m)} sx={{ textTransform: "none", px: 0.5 }} data-tour="timeline-different">
                {L[lang].thisOneDifferent}
              </Button>
            )}
          </Stack>
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
  const [last, setLast] = useState<InboxAnswerResult | null>(null);
  const [choose, setChoose] = useState(false);
  const messages = q.data?.messages ?? [];
  // The newest message is always shown expanded (above the timeline); the one the person clicked opens too.
  useEffect(() => {
    if (!q.data || !id) return;
    setExpanded({ [id]: true });
    setLast(null);
    setChoose(false);
  }, [q.data, id]);
  useEffect(() => {
    if (q.isError) toast.error((q.error as Error)?.message || "Could not load the thread");
  }, [q.isError, q.error]);
  const labels = L[lang];
  const newest = timeline(messages).find((x) => x.latest)?.m ?? (open as InboxMessage | null);
  const r = messages.length ? threadResult(messages, whenShort, lang) : newest ? resultBox(newest as InboxMessage, lang) : null;
  const multi = messages.length ? threadResult(messages, whenShort, lang).multi : [];
  const waiting = !!thread?.question && thread.messages.some((m) => m.inboxState !== "PROCESSED");
  const firstFiled = newest?.linked?.files.find((f) => f.status === "done") ?? null;
  const href = newest?.linked?.ref ? orderHref(newest.linked.orderId, newest.linked.shipmentId, firstFiled?.stepId ?? null, firstFiled?.name ?? null) : null;
  const rows = timeline(messages);
  const latest = rows.find((x) => x.latest) ?? null;
  const earlier = rows.filter((x) => !x.latest);
  const headEmail = (latest?.m ?? newest) as InboxMessage | null;
  return (
    <Dialog open={!!open} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus data-tour="email-dialog">
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, minWidth: 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>
          {open?.subject || "(no subject)"}
        </Typography>
        {headEmail && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }} title={headEmail.from} data-tour="email-dialog-from">
            {cardFromLine(headEmail, lang)}
            {messages.length > 1 ? ` · ${labels.emails(messages.length)}` : ""}
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
            ) : waiting && thread && r ? (
              <>
                <ResultBoxView r={{ tone: "wait", headline: labels.waiting, lines: thread.question?.title ? [{ text: thread.question.title, href: null }] : [] }} lang={lang} />
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Button size="small" variant="contained" disabled={pending} onClick={() => setChoose(true)} sx={{ textTransform: "none" }} data-tour="question-choose">
                    {labels.answer}
                  </Button>
                </Stack>
                <ChooseShipmentDialog open={choose} t={thread} lang={lang} busy={pending} onClose={() => setChoose(false)} onAnswer={(t, a) => void onAnswer(t, a).then((res) => setLast(res))} onCreateOrder={onCreateOrder} />
              </>
            ) : r ? (
              <>
                <ResultBoxView r={r} lines={multi} lang={lang} />
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {href && (
                    <Button component={Link} href={href} size="small" variant="outlined" sx={{ textTransform: "none" }} data-tour="result-order-chip">
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
                </Stack>
              </>
            ) : null}
            {q.data && <ThreadFiles files={q.data.files ?? []} quotedMissing={q.data.quotedMissing ?? 0} lang={lang} />}
            {latest && (
              <Box sx={{ border: "1px solid", borderColor: "primary.main", borderRadius: 1, p: 1.5 }} data-tour="thread-latest-email">
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                  <Chip size="small" color="primary" label={labels.latest} sx={{ height: 20 }} />
                  <Typography variant="caption" color="text.secondary">
                    {whenShort(latest.m.date)}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0, wordBreak: "break-word" }} title={latest.m.from}>
                    {fromParts(latest.m.from).name}
                    {latest.m.company ? ` (${latest.m.company})` : ""}
                  </Typography>
                </Stack>
                <EmailView id={latest.m.id} compactHeaders company={latest.m.company ?? null} lang={lang} />
              </Box>
            )}
            {earlier.length > 0 && (
              <Stack spacing={0.75} data-tour="thread-timeline">
                <Typography variant="overline" color="text.secondary">
                  {labels.earlier(earlier.length)}
                </Typography>
                {earlier.map(({ n, m, latest: isLatest }) => (
                  <TimelineRow key={m.id} n={n} m={m} latest={isLatest} lang={lang} open={!!expanded[m.id]} onToggle={() => setExpanded((e) => ({ ...e, [m.id]: !e[m.id] }))} onDifferent={(mm) => onChangeOrder(mm)} />
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
