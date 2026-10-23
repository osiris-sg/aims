"use client";

// Round AB — ONE question card in the list (owner: every question as its own card, numbered). Top to bottom: the
// number badge + the question (prominent); the subject in full (round AD, owner: it WRAPS, never clamped or cut with
// "…"); "Vedanta · 22 Oct 14:31"; the stored one-line summary of the email, muted and wrapping (display text only — it never
// drives an action); "Answer" (→ the round AA Choose-shipment dialog: nothing applies until Confirm) and "Show full
// email" (→ the thread pop-up). Styled like the Operations dashboard's cards (outlined, same padding, small grey
// labels, accent button). EN / JA from the API. No em dashes.

import React, { useState } from "react";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import type { InboxAnswer, InboxLang, InboxThread } from "../../_lib/api";
import { cardSummary, cardWhoLine, fullSubject, L } from "../../_lib/inbox-cards";
import { ChooseShipmentDialog } from "./ChooseShipmentDialog";

export interface QuestionCardProps {
  t: InboxThread;
  lang: InboxLang;
  /** 1-based place in the list — the small circular badge. */
  n: number;
  busy?: boolean;
  onAnswer: (t: InboxThread, a: InboxAnswer) => void;
  onCreateOrder: (t: InboxThread) => void;
  onOpenThread: (t: InboxThread) => void;
}

export function QuestionCard({ t, lang, n, busy, onAnswer, onCreateOrder, onOpenThread }: QuestionCardProps) {
  const q = t.question;
  const [choose, setChoose] = useState(false);
  const newest = t.messages[0];
  const labels = L[lang];
  if (!q || !newest) return null;
  const subject = fullSubject(t.subject ?? newest.subject);
  const summary = cardSummary(newest);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }} data-tour="question-card" data-kind={q.kind}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <Box
          sx={{ mt: 0.25, width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, bgcolor: "primary.lighter", color: "primary.main", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
          data-tour="question-number"
          aria-label={`${n}`}
        >
          {n}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, wordBreak: "break-word" }} data-tour="question-title">
            {q.title}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 600, wordBreak: "break-word", overflowWrap: "anywhere" }} lang={/[぀-ヿ一-鿿]/.test(subject) ? "ja" : undefined} data-tour="question-subject">
            {subject}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }} title={newest.from} data-tour="question-from">
            {cardWhoLine(newest, lang)}
          </Typography>
          {summary && (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5, wordBreak: "break-word", overflowWrap: "anywhere" }} data-tour="question-summary">
              {summary}
            </Typography>
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
            <Button size="small" variant="contained" disabled={busy} onClick={() => setChoose(true)} sx={{ textTransform: "none" }} data-tour="question-choose">
              {labels.answer}
            </Button>
            <Button size="small" variant="outlined" color="inherit" onClick={() => onOpenThread(t)} sx={{ textTransform: "none" }} data-tour="question-show-full">
              {labels.showFull}
            </Button>
          </Stack>
        </Box>
      </Stack>
      <ChooseShipmentDialog open={choose} t={t} lang={lang} busy={busy} onClose={() => setChoose(false)} onAnswer={onAnswer} onCreateOrder={onCreateOrder} />
    </Paper>
  );
}
