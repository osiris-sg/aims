"use client";

// Round AB — the question LIST (owner: every question as its own card, numbered 1, 2, 3; not one at a time). Five
// cards, then "Show N more". After an answer a banner says what happened ("Linked to #18-2 · 2 files filed") with
// Undo; the answered card leaves the list on the next refresh. No counts, no "Question 3 of 4", no "N questions
// left". Replaces round W's QuestionQueue.

import React, { useState } from "react";
import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import type { InboxAnswer, InboxAnswerResult, InboxLang, InboxThread } from "../../_lib/api";
import { L } from "../../_lib/inbox-cards";
import { QuestionCard } from "./QuestionCard";

export const LIST_FIRST = 5;

export interface QuestionListProps {
  threads: InboxThread[];
  lang: InboxLang;
  busy?: boolean;
  /** Returns what the API said (the banner text + what to undo). */
  onAnswer: (t: InboxThread, a: InboxAnswer) => Promise<InboxAnswerResult | null>;
  onUndo: (r: InboxAnswerResult) => Promise<void>;
  onCreateOrder: (t: InboxThread) => void;
  onOpenThread: (t: InboxThread) => void;
  footer?: React.ReactNode;
}

export function QuestionList({ threads, lang, busy, onAnswer, onUndo, onCreateOrder, onOpenThread, footer }: QuestionListProps) {
  const labels = L[lang];
  const waiting = threads.filter((t) => !!t.question);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<{ result: InboxAnswerResult; undone: boolean } | null>(null);
  const answer = async (t: InboxThread, a: InboxAnswer) => {
    const r = await onAnswer(t, a);
    if (r) setLast({ result: r, undone: false });
  };
  const shown = open ? waiting : waiting.slice(0, LIST_FIRST);
  const hidden = waiting.length - shown.length;
  return (
    <Stack spacing={1.5} data-tour="question-queue">
      {last && (
        <Alert
          severity={last.undone ? "info" : last.result.kind === "record" ? "success" : "info"}
          action={
            !last.undone ? (
              <Button
                size="small"
                color="inherit"
                onClick={async () => {
                  await onUndo(last.result);
                  setLast({ ...last, undone: true });
                }}
                data-tour="question-undo"
              >
                {labels.undo}
              </Button>
            ) : undefined
          }
          data-tour="question-result"
        >
          {last.undone ? (lang === "ja" ? "元に戻しました" : "Undone") : last.result.text}
        </Alert>
      )}
      {waiting.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {labels.allDone}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.25} data-tour="question-list">
          {shown.map((t, i) => (
            <QuestionCard key={t.id} t={t} lang={lang} n={i + 1} busy={busy} onAnswer={answer} onCreateOrder={onCreateOrder} onOpenThread={onOpenThread} />
          ))}
        </Stack>
      )}
      {(hidden > 0 || (open && waiting.length > LIST_FIRST)) && (
        <Button size="small" variant="text" onClick={() => setOpen((v) => !v)} sx={{ textTransform: "none", alignSelf: "flex-start" }} data-tour="question-more">
          {hidden > 0 ? labels.showMore(hidden) : labels.showLess}
        </Button>
      )}
      {footer}
    </Stack>
  );
}
