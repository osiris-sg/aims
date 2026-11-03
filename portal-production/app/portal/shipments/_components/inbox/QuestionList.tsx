"use client";

// Round AB — the question LIST (owner: every question as its own card, numbered 1, 2, 3; not one at a time). Five
// cards, then "Show N more". After an answer a banner says what happened ("Linked to #18-2 · 2 files filed") with
// Undo; the answered card leaves the list on the next refresh. No counts, no "Question 3 of 4", no "N questions
// left". Replaces round W's QuestionQueue.
// Round BB — cards handed to the admins come first for an admin and last for everyone else; similar cards the API
// groups (`batches`, ≥2 cards) sit together under the batch's title, each with a checkbox (ticked when AIMS's guess
// is an existing shipment) and one "Yes to the ticked ones (n)" that answers them one by one (one banner, one Undo
// for all). A batch card whose guess is a new shipment keeps its own Yes (the form), no checkbox. "Show N more"
// counts the single cards only; batches always show.

import React, { useState } from "react";
import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import type { InboxAnswer, InboxAnswerResult, InboxBatch, InboxLang, InboxThread, InboxViewer } from "../../_lib/api";
import { batchTickable, choiceAction, questionSegments } from "../../_lib/inbox-cards";
import { useInboxLabels } from "./useInboxLabels";
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
  /** Round BB: the API's groups of similar cards, and who is looking. */
  batches?: InboxBatch[] | null;
  viewer?: InboxViewer | null;
}

export function QuestionList({ threads, lang, busy, onAnswer, onUndo, onCreateOrder, onOpenThread, footer, batches, viewer }: QuestionListProps) {
  const labels = useInboxLabels();
  const admin = !!viewer?.admin;
  const waiting = threads.filter((t) => !!t.question);
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<{ results: InboxAnswerResult[]; text: string; undone: boolean } | null>(null);
  // Round BB: the batch checkboxes the person changed (the rest follow batchTickable), and a batch being answered.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState<string | null>(null);
  const answer = async (t: InboxThread, a: InboxAnswer) => {
    const r = await onAnswer(t, a);
    if (r) setLast({ results: [r], text: r.text, undone: false });
  };
  const tickable = (t: InboxThread) => batchTickable(t.question, admin);
  const ticked = (t: InboxThread) => tickable(t) && (ticks[t.id] ?? true);
  /** "Yes to the ticked ones": each ticked card's record answer, one call each, one banner for all. */
  const answerBatch = async (key: string, cards: InboxThread[]) => {
    setRunning(key);
    const results: InboxAnswerResult[] = [];
    try {
      for (const t of cards.filter(ticked)) {
        const a = t.question?.guess ? choiceAction(t.question.guess) : null;
        if (a?.do !== "answer") continue;
        const r = await onAnswer(t, a.answer);
        if (r) results.push(r);
      }
    } finally {
      setRunning(null);
    }
    if (results.length) setLast({ results, text: results.length === 1 ? results[0].text : labels.batchDone(results.length), undone: false });
  };

  const segments = questionSegments(waiting, batches, admin);
  const singles = segments.filter((s) => s.kind === "one").length;
  let n = 0;
  let shownSingles = 0;
  const card = (t: InboxThread, extra?: { compact?: boolean; pick?: boolean }) => (
    <QuestionCard
      key={t.id}
      t={t}
      lang={lang}
      n={++n}
      busy={busy || !!running}
      viewer={viewer}
      compact={extra?.compact}
      pick={extra?.pick && tickable(t) ? { checked: ticked(t), onChange: (v) => setTicks((p) => ({ ...p, [t.id]: v })) } : null}
      onAnswer={answer}
      onCreateOrder={onCreateOrder}
      onOpenThread={onOpenThread}
    />
  );
  const blocks: React.ReactNode[] = [];
  for (const s of segments) {
    if (s.kind === "one") {
      if (!open && shownSingles >= LIST_FIRST) continue;
      shownSingles++;
      blocks.push(card(s.t));
      continue;
    }
    const count = s.threads.filter(ticked).length;
    const anyTickable = s.threads.some(tickable);
    blocks.push(
      <Paper key={`batch:${s.key}`} variant="outlined" sx={{ p: { xs: 1, md: 1.5 }, bgcolor: "action.hover" }} data-tour="question-batch">
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 0, wordBreak: "break-word" }} data-tour="question-batch-title">
            {s.title}
          </Typography>
          {anyTickable && (
            <Button size="small" variant="contained" disabled={busy || !!running || count === 0} onClick={() => void answerBatch(s.key, s.threads)} sx={{ textTransform: "none" }} data-tour="question-batch-yes">
              {labels.batchYes(count)}
            </Button>
          )}
        </Stack>
        <Stack spacing={0.75}>{s.threads.map((t) => card(t, { compact: true, pick: true }))}</Stack>
      </Paper>,
    );
  }
  const hidden = singles - shownSingles;
  return (
    <Stack spacing={1.5} data-tour="question-queue">
      {last && (
        <Alert
          severity={last.undone ? "info" : last.results.some((r) => r.kind === "record") ? "success" : "info"}
          action={
            !last.undone ? (
              <Button
                size="small"
                color="inherit"
                onClick={async () => {
                  for (const r of last.results) await onUndo(r);
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
          {last.undone ? labels.undone : last.text}
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
          {blocks}
        </Stack>
      )}
      {(hidden > 0 || (open && singles > LIST_FIRST)) && (
        <Button size="small" variant="text" onClick={() => setOpen((v) => !v)} sx={{ textTransform: "none", alignSelf: "flex-start" }} data-tour="question-more">
          {hidden > 0 ? labels.showMore(hidden) : labels.showLess}
        </Button>
      )}
      {footer}
    </Stack>
  );
}
