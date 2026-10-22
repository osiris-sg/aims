"use client";

// Round AA — the QUESTION CARD, minimal and confirm-first (owner: "clicking an option applied instantly and the
// card showed far too much"). The card shows ONLY the plain question, one line "From Vedanta · 22 Oct 14:31 ·
// subject…", and two buttons: "Choose shipment" (→ the ChooseShipmentDialog: tick one or several, Confirm) and
// "Show full email" (→ the thread pop-up, the email first). A NEW_DEAL / IS_SHIPMENT card says "Answer" instead
// and opens the same dialog. No single click on the card applies anything. EN / JA from the API.

import React, { useState } from "react";
import { Button, Paper, Stack, Typography } from "@mui/material";
import type { InboxAnswer, InboxLang, InboxThread } from "../../_lib/api";
import { cardFromLine, L } from "../../_lib/inbox-cards";
import { ChooseShipmentDialog } from "./ChooseShipmentDialog";

export interface QuestionCardProps {
  t: InboxThread;
  lang: InboxLang;
  busy?: boolean;
  onAnswer: (t: InboxThread, a: InboxAnswer) => void;
  onCreateOrder: (t: InboxThread) => void;
  onOpenThread: (t: InboxThread) => void;
  /** "Question 1 of 4" in queue mode. */
  position?: string | null;
}

export function QuestionCard({ t, lang, busy, onAnswer, onCreateOrder, onOpenThread, position }: QuestionCardProps) {
  const q = t.question;
  const [choose, setChoose] = useState(false);
  const newest = t.messages[0];
  const labels = L[lang];
  if (!q || !newest) return null;
  const answerOnly = q.kind === "NEW_DEAL" || q.kind === "IS_SHIPMENT";
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 2 }} data-tour="question-card" data-kind={q.kind}>
      <Stack spacing={1.25}>
        {position && (
          <Typography variant="caption" color="text.secondary">
            {position}
          </Typography>
        )}
        <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.3 }} data-tour="question-title">
          {q.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap title={`${newest.from} · ${newest.subject ?? ""}`} data-tour="question-from">
          {cardFromLine(newest, lang)}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="contained" disabled={busy} onClick={() => setChoose(true)} sx={{ textTransform: "none" }} data-tour="question-choose">
            {answerOnly ? labels.answer : labels.chooseShipment}
          </Button>
          <Button variant="outlined" color="inherit" onClick={() => onOpenThread(t)} sx={{ textTransform: "none" }} data-tour="question-show-full">
            {labels.showFull}
          </Button>
        </Stack>
      </Stack>
      <ChooseShipmentDialog open={choose} t={t} lang={lang} busy={busy} onClose={() => setChoose(false)} onAnswer={onAnswer} onCreateOrder={onCreateOrder} />
    </Paper>
  );
}
