"use client";

// Round W — the email list. ONE card per thread = the latest relevant email only.
//   Unprocessed: the question list (QuestionList, round AB) — every question as its own numbered card, 5 then "Show N more".
//   Processed:   a thread card per thread — the latest email (sender, date, first lines, attachments), the result in
//                plain words ("✅ Added to #16-2 — …" / "🔗 Linked to #15-1"), "3 earlier emails" → the timeline.
// Actions live on the THREAD card (they cover the thread's unprocessed emails); per-email overrides inside the timeline.

import React from "react";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import type { InboxAnswer, InboxAnswerResult, InboxLang, InboxMessage, InboxThread } from "../../_lib/api";
import { L, threadResult } from "../../_lib/inbox-cards";
import { fromParts, whenShort } from "../../_lib/inbox-threads";
import { QuestionList } from "./QuestionList";

export interface InboxActions {
  lang: InboxLang;
  onAnswer: (t: InboxThread, a: InboxAnswer) => Promise<InboxAnswerResult | null>;
  onAnswerUndo: (r: InboxAnswerResult) => Promise<void>;
  onCreateOrder: (t: InboxThread) => void;
  /** Opens the thread timeline (the dialog) on this message. */
  onOpen: (m: InboxMessage, t?: InboxThread) => void;
  onUndo: (m: InboxMessage) => void;
  pending?: boolean;
}

/** A processed thread: the latest email + the result box + "n earlier emails". */
export function ThreadCard({ t, actions }: { t: InboxThread; actions: InboxActions }) {
  const lang = actions.lang;
  const labels = L[lang];
  const newest = t.messages[0];
  if (!newest) return null;
  const from = fromParts(newest.from);
  const r = threadResult(t.messages, whenShort, lang);
  const multi = r.multi;
  const earlier = t.earlier ?? Math.max(0, t.emails - 1);
  const color = r.tone === "done" ? "success.main" : r.tone === "link" ? "primary.main" : r.tone === "wait" ? "warning.main" : "text.secondary";
  return (
    <Paper variant="outlined" sx={{ mb: 1, p: 1.5, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }} onClick={() => actions.onOpen(newest, t)} data-tour="thread-card">
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, color, wordBreak: "break-word" }} data-tour="thread-result">
            {multi.length ? (lang === "ja" ? `${multi.length} 件の送り先` : `${multi.length} destinations`) : r.headline}
          </Typography>
          {multi.map((l, i) => (
            <Typography key={i} variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }}>
              {l.text}
            </Typography>
          ))}
          <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.25, wordBreak: "break-word", overflowWrap: "anywhere" }}>
            {t.subject || "(no subject)"}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" title={newest.from} sx={{ wordBreak: "break-word" }}>
              {from.name}
            </Typography>
            {newest.company && <Chip size="small" variant="outlined" label={newest.company} sx={{ height: 18 }} />}
            <Typography variant="caption" color="text.secondary">
              {whenShort(newest.date)}
            </Typography>
            {newest.attachments.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                <AttachFileIcon sx={{ fontSize: 14 }} /> {newest.attachments.length}
              </Typography>
            )}
            {newest.by && newest.by.outcome !== "AUTO" && (
              <Typography variant="caption" color="text.secondary">
                · {newest.by.name ?? ""}
                {newest.by.via === "whatsapp" ? " (WhatsApp)" : ""}
              </Typography>
            )}
          </Stack>
          {newest.preview && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }}>
              {newest.preview}
            </Typography>
          )}
        </Box>
        <Stack spacing={0.5} alignItems="flex-end" onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0 }}>
          {earlier > 0 && (
            <Button size="small" onClick={() => actions.onOpen(newest, t)} sx={{ textTransform: "none", whiteSpace: "nowrap" }} data-tour="thread-earlier">
              {labels.earlier(earlier)}
            </Button>
          )}
          {newest.canUndo && (
            <Button size="small" onClick={() => actions.onUndo(newest)} sx={{ textTransform: "none" }} data-tour="inbox-undo">
              {labels.undo}
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

/** The list: the question list (Unprocessed) or thread cards (Processed). */
export function InboxThreadList({ threads, actions, tab, emptyText, footer }: { threads: InboxThread[]; actions: InboxActions; tab: "UNPROCESSED" | "PROCESSED"; emptyText: string; footer?: React.ReactNode }) {
  if (tab === "UNPROCESSED") {
    return <QuestionList threads={threads} lang={actions.lang} busy={actions.pending} onAnswer={actions.onAnswer} onUndo={actions.onAnswerUndo} onCreateOrder={actions.onCreateOrder} onOpenThread={(t) => actions.onOpen(t.messages[0], t)} footer={footer} />;
  }
  if (!threads.length) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      </Paper>
    );
  }
  return (
    <Box>
      {threads.map((t) => (
        <ThreadCard key={t.id} t={t} actions={actions} />
      ))}
    </Box>
  );
}
