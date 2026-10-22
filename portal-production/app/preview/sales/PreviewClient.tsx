"use client";

// Fixture-rendered Sales dashboard / Inbox (round P screenshots). No API, no
// sign-in: the actions only log. Served only with PREVIEW_FIXTURES=1.

import React, { useState } from "react";
import { Box, Tab, Tabs, Typography } from "@mui/material";
import TradeTheme from "@/app/portal/shipments/_components/TradeTheme";
import { EmailDashboardView } from "@/app/portal/shipments/_components/EmailDashboard";
import { InboxThreadList, type InboxActions } from "@/app/portal/shipments/_components/inbox/InboxThreadList";
import { DASHBOARD, DASHBOARD_MANY, PREVIEW_TODAY, PROCESSED, SHIPMENTS, TASKS, UNPROCESSED, UNPROCESSED_MANY } from "./fixtures";

const noop: InboxActions = { lang: "en", onAnswer: async () => null, onAnswerUndo: async () => undefined, onCreateOrder: () => undefined, onUndo: () => undefined, onOpen: () => undefined, pending: false };

/** `many`: round AB's 7-question set (a short subject + a long Japanese one → "Show 2 more"). */
export default function PreviewClient({ view, many = false }: { view: "dashboard" | "inbox"; many?: boolean }) {
  const [tab, setTab] = useState<"UNPROCESSED" | "PROCESSED">("UNPROCESSED");
  const unprocessed = many ? UNPROCESSED_MANY : UNPROCESSED;
  return (
    <TradeTheme>
      {view === "dashboard" ? (
        <EmailDashboardView data={{ inbox: many ? DASHBOARD_MANY : DASHBOARD, tasks: TASKS, shipments: SHIPMENTS, today: PREVIEW_TODAY, loading: false }} actions={noop} onTasksChanged={() => undefined} />
      ) : (
        <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
          <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
            Inbox
          </Typography>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} data-tour="inbox-tabs">
            <Tab value="UNPROCESSED" label="Unprocessed" sx={{ textTransform: "none" }} />
            <Tab value="PROCESSED" label={`Processed (${PROCESSED.reduce((n, t) => n + t.messages.length, 0)})`} sx={{ textTransform: "none" }} />
          </Tabs>
          <InboxThreadList tab={tab} threads={tab === "UNPROCESSED" ? unprocessed : PROCESSED} actions={noop} emptyText="Nothing to confirm: all emails are linked." />
        </Box>
      )}
    </TradeTheme>
  );
}
