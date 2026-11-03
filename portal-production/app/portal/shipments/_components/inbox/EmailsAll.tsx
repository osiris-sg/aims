"use client";

// Round W — "See all emails": the full two-tab view (a Dashboard sub-view, no longer a nav item).
//   Unprocessed — the question list (round AB): every question as its own numbered card, 5 then "Show N more";
//                     no counts in the tab.
//   Processed (n)   — one card per thread: the latest email + what was done ("✅ Added to #16-2 — …"), Undo,
//                     "3 earlier emails" → the timeline.
//   Not about a shipment (round BB) — the hidden mail (calendar replies, newsletters, what the sender filter
//                     dropped) with "Actually it is" to bring one back; loads when opened.
// The Unprocessed query always runs (its question count sits in the tab label); Processed loads when opened.

import React, { useState } from "react";
import { Alert, Box, CircularProgress, Tab, Tabs } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type InboxThreadsTab } from "../../_lib/api";
import { useTranslations } from "next-intl";
import { useInboxLabels } from "./useInboxLabels";
import { InboxThreadList } from "./InboxThreadList";
import { HiddenEmailsList } from "./HiddenEmailsList";
import { useInboxActions } from "./useInboxActions";

export default function EmailsAll() {
  const api = useShipmentsApi();
  const [tab, setTab] = useState<InboxThreadsTab | "HIDDEN">("UNPROCESSED");
  const act = useInboxActions(async () => {
    await Promise.all([qu.refetch(), tab === "PROCESSED" ? qp.refetch() : null]);
  });
  const qu = useQuery({ queryKey: ["trade-inbox", "threads", "UNPROCESSED", act.lang], queryFn: () => api.inboxThreads("UNPROCESSED", act.lang), refetchInterval: 30_000 });
  const qp = useQuery({ queryKey: ["trade-inbox", "threads", "PROCESSED", act.lang], queryFn: () => api.inboxThreads("PROCESSED", act.lang), refetchInterval: 30_000, enabled: tab === "PROCESSED" });
  const q = tab === "UNPROCESSED" ? qu : qp;
  const counts = qu.data?.counts ?? qp.data?.counts;
  const labels = useInboxLabels();
  const t = useTranslations("inbox.emailsAll");
  const unprocessedLabel = t("unprocessed");
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1000, mx: "auto" }} data-tour="emails-all">
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} data-tour="inbox-tabs">
        <Tab value="UNPROCESSED" label={unprocessedLabel} sx={{ textTransform: "none" }} />
        <Tab value="PROCESSED" label={`${t("processed")}${counts ? ` (${counts.processed})` : ""}`} sx={{ textTransform: "none" }} />
        <Tab value="HIDDEN" label={t("notShipment")} sx={{ textTransform: "none" }} data-tour="inbox-tab-not-shipment" />
      </Tabs>
      {tab === "HIDDEN" ? (
        <HiddenEmailsList onChanged={() => qu.refetch()} />
      ) : q.isError ? (
        <Alert severity="error">{(q.error as Error)?.message || t("couldNotLoad")}</Alert>
      ) : q.isLoading ? (
        <CircularProgress />
      ) : (
        <InboxThreadList tab={tab} threads={q.data?.threads ?? []} batches={q.data?.batches} viewer={q.data?.viewer ?? qu.data?.viewer} actions={act.actions} emptyText={tab === "UNPROCESSED" ? labels.nothing : t("nothingProcessed")} />
      )}
      {act.dialogs}
    </Box>
  );
}
