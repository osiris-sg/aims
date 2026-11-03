"use client";

import React from "react";
import { Box } from "@mui/material";
import { useUiLang } from "@/i18n/UiLangProvider";
import type { InboxBatch, InboxThread, InboxViewer } from "@/app/portal/shipments/_lib/api";
import { InboxThreadList, type InboxActions } from "@/app/portal/shipments/_components/inbox/InboxThreadList";
import { HiddenEmailsList } from "@/app/portal/shipments/_components/inbox/HiddenEmailsList";

/** The question list on the fixture threads; every answer is only logged (and comes back as a banner). */
export default function QuestionsPreview({ threads, batches, viewer, view }: { threads: InboxThread[]; batches: InboxBatch[]; viewer: InboxViewer; view: "questions" | "hidden" }) {
  const { lang } = useUiLang();
  const actions: InboxActions = {
    lang,
    onAnswer: async (t, a) => {
      console.log("[preview answer]", t.id, JSON.stringify(a));
      return { kind: a.kind, ids: t.answerIds ?? [], refs: [], files: 0, text: `[preview] ${a.kind}` };
    },
    onAnswerUndo: async () => undefined,
    onCreateOrder: (t) => console.log("[preview create order]", t.id),
    onOpen: (m) => console.log("[preview open]", m.id),
    onUndo: () => undefined,
    pending: false,
  };
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1000, mx: "auto", minHeight: "100vh", bgcolor: "background.default" }} data-tour="preview-questions">
      {view === "hidden" ? <HiddenEmailsList /> : <InboxThreadList tab="UNPROCESSED" threads={threads} batches={batches} viewer={viewer} actions={actions} emptyText="" />}
    </Box>
  );
}
