"use client";

// Fixture-rendered Sales dashboard / Inbox (round P screenshots). No API, no
// sign-in: the actions only log. Served only with PREVIEW_FIXTURES=1.

import React, { useState } from "react";
import { Box, Tab, Tabs, Typography } from "@mui/material";
import TradeTheme from "@/app/portal/shipments/_components/TradeTheme";
import { EmailDashboardView } from "@/app/portal/shipments/_components/EmailDashboard";
import { InboxThreadList, type InboxActions } from "@/app/portal/shipments/_components/inbox/InboxThreadList";
import { DASHBOARD, PREVIEW_TODAY, PROCESSED, SHIPMENTS, TASKS, UNPROCESSED } from "./fixtures";

const noop: InboxActions = { onConfirm: () => undefined, onChangeOrder: () => undefined, onNotShipment: () => undefined, onUndo: () => undefined, onOpen: () => undefined, pending: false };

export default function PreviewClient({ view }: { view: "dashboard" | "inbox" }) {
  const [tab, setTab] = useState<"UNPROCESSED" | "PROCESSED">("UNPROCESSED");
  return (
    <TradeTheme>
      {view === "dashboard" ? (
        <EmailDashboardView data={{ inbox: DASHBOARD, tasks: TASKS, shipments: SHIPMENTS, today: PREVIEW_TODAY, loading: false }} actions={noop} onTasksChanged={() => undefined} />
      ) : (
        <Box sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            Inbox
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Emails sent to the intake address, as threads. Unprocessed needs you; Processed is what was filed.
          </Typography>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} data-tour="inbox-tabs">
            <Tab value="UNPROCESSED" label={`Unprocessed (${UNPROCESSED.reduce((n, t) => n + t.messages.length, 0)})`} sx={{ textTransform: "none" }} />
            <Tab value="PROCESSED" label={`Processed (${PROCESSED.reduce((n, t) => n + t.messages.length, 0)})`} sx={{ textTransform: "none" }} />
          </Tabs>
          <InboxThreadList threads={tab === "UNPROCESSED" ? UNPROCESSED : PROCESSED} actions={noop} emptyText="Nothing to confirm — all emails are linked." />
        </Box>
      )}
    </TradeTheme>
  );
}
