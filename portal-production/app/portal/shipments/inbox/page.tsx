"use client";

// Sales → Inbox (round P): the intake emails as THREADS, in two tabs only.
//   Unprocessed (n) — Suggested + Unmatched + Unsure merged; each message
//                     carries the reason it needs a person (Confirm match ·
//                     Pick order · Pick shipment (thread covers #20/#21/#22) ·
//                     Check — subject disagrees · Is it a shipment?).
//   Processed (n)   — accepted, auto-applied or ignored, with who / when and Undo.
// Purged / hidden / would-drop mail is not shown; the sender filter's preview,
// the accept rate and the hidden emails are in Org Settings → Shipping → Email
// filter. Round Q: "No order yet — create one?" groups the threads with no
// order in AIMS (Create order from this thread). A thread row shows its
// link chip and "5 emails · 3 files" and expands to each message; "Linked to"
// is on every row and message (→ the shipment on its order page, the step
// expanded; per attachment "COA.pdf → #28-1 · 3b · Certificate of analysis").

import React, { useState } from "react";
import { Alert, Box, CircularProgress, Menu, MenuItem, Tab, Tabs, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type InboxMessage, type InboxThreadsTab } from "../_lib/api";
import { InboxThreadList, type InboxActions } from "../_components/inbox/InboxThreadList";
import { useInboxActions } from "../_components/inbox/useInboxActions";

export default function InboxPage() {
  const api = useShipmentsApi();
  const [tab, setTab] = useState<InboxThreadsTab>("UNPROCESSED");
  const q = useQuery({ queryKey: ["trade-inbox", "threads", tab], queryFn: () => api.inboxThreads(tab), refetchInterval: 30_000 });
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: InboxMessage } | null>(null);
  const act = useInboxActions(async () => {
    await q.refetch();
  });
  const actions: InboxActions = {
    onCreateOrder: (t) => void act.createOrder(t),
    onConfirm: (m) => void act.run(m, "accept"),
    onChangeOrder: (m) => act.setAssign(m),
    onNotShipment: (m) => act.setConfirm({ row: m, act: "dismiss" }),
    onUndo: (m) => act.setConfirm({ row: m, act: "undo" }),
    onOpen: (m) => act.setOpen(m),
    onMenu: (m, pos) => setMenu({ pos, row: m }),
    pending: act.pending,
  };
  const counts = q.data?.counts;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1200, mx: "auto" }}>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
        Inbox
      </Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} data-tour="inbox-tabs">
        <Tab value="UNPROCESSED" label={`Unprocessed${counts ? ` (${counts.unprocessed})` : ""}`} sx={{ textTransform: "none" }} />
        <Tab value="PROCESSED" label={`Processed${counts ? ` (${counts.processed})` : ""}`} sx={{ textTransform: "none" }} />
      </Tabs>
      {q.isError ? (
        <Alert severity="error">{(q.error as Error)?.message || "Could not load the inbox"}</Alert>
      ) : q.isLoading ? (
        <CircularProgress />
      ) : (
        <InboxThreadList threads={q.data?.threads ?? []} actions={actions} emptyText={tab === "UNPROCESSED" ? "Nothing to confirm — all emails are linked." : "Nothing processed yet."} />
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            act.setOpen(menu!.row);
            setMenu(null);
          }}
        >
          Details
        </MenuItem>
        {menu && !menu.row.canUndo && (
          <MenuItem
            onClick={() => {
              act.setAssign(menu!.row);
              setMenu(null);
            }}
          >
            Change order
          </MenuItem>
        )}
        {menu && !menu.row.canUndo && menu.row.inboxState !== "PROCESSED" && (
          <MenuItem
            onClick={() => {
              const r = menu!.row;
              setMenu(null);
              void act.run(r, "ignore");
            }}
          >
            Ignore (keep, file nothing)
          </MenuItem>
        )}
        {menu && !menu.row.canUndo && (
          <MenuItem
            onClick={() => {
              const r = menu!.row;
              setMenu(null);
              void act.run(r, "retriage");
            }}
          >
            Triage again
          </MenuItem>
        )}
        {menu && !menu.row.canUndo && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              act.setConfirm({ row: menu!.row, act: "dismiss" });
              setMenu(null);
            }}
          >
            Not a shipment — delete
          </MenuItem>
        )}
      </Menu>
      {act.dialogs}
    </Box>
  );
}
