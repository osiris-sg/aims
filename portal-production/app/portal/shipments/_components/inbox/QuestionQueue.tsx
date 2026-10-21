"use client";

// Round W — QUEUE MODE: one question card at a time. After an answer, a banner says what happened ("Linked to
// #18-2 · 2 files filed") with Undo, and the next question loads by itself ("3 left"). The other waiting threads
// are listed under the card (one line each: the question + the subject) — click one to jump to it.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, List, ListItemButton, ListItemText, Paper, Stack, Typography } from "@mui/material";
import type { InboxAnswer, InboxAnswerResult, InboxLang, InboxThread } from "../../_lib/api";
import { L, leftCount } from "../../_lib/inbox-cards";
import { fromParts } from "../../_lib/inbox-threads";
import { QuestionCard } from "./QuestionCard";

export interface QuestionQueueProps {
  threads: InboxThread[];
  lang: InboxLang;
  busy?: boolean;
  /** Returns what the API said (the banner text + what to undo). */
  onAnswer: (t: InboxThread, a: InboxAnswer) => Promise<InboxAnswerResult | null>;
  onUndo: (r: InboxAnswerResult) => Promise<void>;
  onCreateOrder: (t: InboxThread) => void;
  onOpenThread: (t: InboxThread) => void;
  /** Dashboard: at most this many listed under the card. */
  listLimit?: number;
  footer?: React.ReactNode;
}

export function QuestionQueue({ threads, lang, busy, onAnswer, onUndo, onCreateOrder, onOpenThread, listLimit, footer }: QuestionQueueProps) {
  const labels = L[lang];
  const waiting = threads.filter((t) => !!t.question);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [last, setLast] = useState<{ result: InboxAnswerResult; left: number; undone: boolean } | null>(null);
  const current = waiting.find((t) => t.id === currentId) ?? waiting[0] ?? null;
  useEffect(() => {
    if (current && current.id !== currentId) setCurrentId(current.id);
  }, [current, currentId]);
  const answer = async (t: InboxThread, a: InboxAnswer) => {
    const r = await onAnswer(t, a);
    if (!r) return;
    setLast({ result: r, left: leftCount(waiting, t.id), undone: false });
    const i = waiting.findIndex((x) => x.id === t.id);
    const next = waiting[i + 1] ?? waiting[i - 1] ?? null;
    setCurrentId(next?.id ?? null);
  };
  const rest = waiting.filter((t) => t.id !== current?.id);
  const listed = listLimit ? rest.slice(0, listLimit) : rest;
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
          {!last.undone && (
            <Typography component="span" variant="body2" sx={{ ml: 1, opacity: 0.75 }}>
              · {last.left ? labels.left(last.left) : labels.allDone}
            </Typography>
          )}
        </Alert>
      )}
      {current ? (
        <QuestionCard t={current} lang={lang} busy={busy} onAnswer={answer} onCreateOrder={onCreateOrder} onOpenThread={onOpenThread} position={waiting.length > 1 ? `${waiting.findIndex((t) => t.id === current.id) + 1} / ${waiting.length}` : null} />
      ) : (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {labels.allDone}
          </Typography>
        </Paper>
      )}
      {listed.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            {labels.left(rest.length)}
          </Typography>
          <List dense disablePadding data-tour="question-list">
            {listed.map((t) => {
              const newest = t.messages[0];
              return (
                <ListItemButton key={t.id} onClick={() => setCurrentId(t.id)} sx={{ borderTop: "1px solid", borderColor: "divider", px: 1 }}>
                  <ListItemText primaryTypographyProps={{ noWrap: true, fontWeight: 600 }} secondaryTypographyProps={{ noWrap: true }} primary={t.question?.title} secondary={`${fromParts(newest?.from).name}${newest?.company ? ` · ${newest.company}` : ""} · ${t.subject || "(no subject)"}`} />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      )}
      {footer}
    </Stack>
  );
}
