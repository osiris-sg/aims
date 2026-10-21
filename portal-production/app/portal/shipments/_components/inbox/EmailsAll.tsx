"use client";

// Round W — "See all emails": the full two-tab view (a Dashboard sub-view, no longer a nav item).
//   Unprocessed (n) — the question queue: one card at a time, answered with one tap, "3 left".
//   Processed (n)   — one card per thread: the latest email + what was done ("✅ Added to #16-2 — …"), Undo,
//                     "3 earlier emails" → the timeline.
// Hidden / purged mail is not shown (Org Settings → Shipping → Email filter → Hidden brings a hidden one back).

import React, { useState } from "react";
import { Alert, Box, CircularProgress, Tab, Tabs } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type InboxThreadsTab } from "../../_lib/api";
import { L } from "../../_lib/inbox-cards";
import { InboxThreadList } from "./InboxThreadList";
import { useInboxActions } from "./useInboxActions";

export default function EmailsAll() {
  const api = useShipmentsApi();
  const [tab, setTab] = useState<InboxThreadsTab>("UNPROCESSED");
  const act = useInboxActions(async () => {
    await q.refetch();
  });
  const q = useQuery({ queryKey: ["trade-inbox", "threads", tab, act.lang], queryFn: () => api.inboxThreads(tab, act.lang), refetchInterval: 30_000 });
  const counts = q.data?.counts;
  const labels = L[act.lang];
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1000, mx: "auto" }} data-tour="emails-all">
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} data-tour="inbox-tabs">
        <Tab value="UNPROCESSED" label={`${act.lang === "ja" ? "未処理" : "Unprocessed"}${counts ? ` (${counts.unprocessed})` : ""}`} sx={{ textTransform: "none" }} />
        <Tab value="PROCESSED" label={`${act.lang === "ja" ? "処理済み" : "Processed"}${counts ? ` (${counts.processed})` : ""}`} sx={{ textTransform: "none" }} />
      </Tabs>
      {q.isError ? <Alert severity="error">{(q.error as Error)?.message || "Could not load the emails"}</Alert> : q.isLoading ? <CircularProgress /> : <InboxThreadList tab={tab} threads={q.data?.threads ?? []} actions={act.actions} emptyText={tab === "UNPROCESSED" ? labels.nothing : act.lang === "ja" ? "処理済みのメールはまだありません。" : "Nothing processed yet."} />}
      {act.dialogs}
    </Box>
  );
}
