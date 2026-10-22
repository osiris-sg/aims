"use client";

// Round P — Sales › Dashboard, email-first (owner feedback: the person using
// this mostly needs to know "which emails do I need to confirm, and what did
// the system already file"). One line at the top ("To do: 4 questions (14
// emails) · 2 tasks overdue · 3 arriving this week"), then: 1. Emails to confirm
// (unprocessed threads, newest first, max 10 + "See all in Inbox"), 2. Filed
// automatically (last 3 days, with Undo), 3. Tasks (the bell's reminders,
// overdue first), 4. Arriving this week (ETA in the next 7 days). The view is
// presentational (the preview route renders it from fixtures); the default
// export wires the queries and actions.

import React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useShipmentsApi, type InboxDashboard, type InboxMessage, type ShipmentListItem, type TradeAlert } from "../_lib/api";
import { useShipments } from "../_lib/hooks";
import { fmtDmy, shortCustomer } from "../_lib/format";
import { FREE_DAYS_HELP, freeDays } from "../_lib/free-days";
import { isOverdue, taskCounts, tradeTodayYmd } from "../_lib/tasks";
import { arrivingThisWeek, byLine, orderHref, toDoLine } from "../_lib/inbox-threads";
import { L, resultBox } from "../_lib/inbox-cards";
import { HOME_KEY, TradeTasksList, useMyTasks, useRefreshTasks } from "./TradeTasks";
import { InboxThreadList, type InboxActions } from "./inbox/InboxThreadList";
import { useInboxActions } from "./inbox/useInboxActions";

export interface EmailDashboardData {
  inbox: InboxDashboard | undefined;
  tasks: TradeAlert[] | undefined;
  shipments: ShipmentListItem[] | undefined;
  today: string;
  loading: boolean;
}

function Section({ title, count, children, tour, action }: { title: string; count?: number | string; children: React.ReactNode; tour: string; action?: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour={tour}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          {title}
          {count !== undefined && count !== "" ? ` (${count})` : ""}
        </Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

/** Round W: what was filed by itself — the result in plain words ("✅ Added to #16-2 — …", one line per document), with Undo. */
function FiledRow({ m, lang, onUndo, onOpen }: { m: InboxMessage & { threadSubject?: string | null }; lang: "en" | "ja"; onUndo: (m: InboxMessage) => void; onOpen: (m: InboxMessage) => void }) {
  const r = resultBox(m, lang);
  const href = orderHref(m.linked?.orderId, m.linked?.shipmentId, m.linked?.files[0]?.stepId ?? null);
  return (
    <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ py: 0.75, borderTop: "1px solid", borderColor: "divider", cursor: "pointer" }} onClick={() => onOpen(m)} data-tour="dashboard-filed-row">
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, color: r.tone === "done" ? "success.main" : "primary.main" }} noWrap title={r.headline}>
          {href ? (
            <Link href={href} onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none", color: "inherit" }}>
              {r.headline}
            </Link>
          ) : (
            r.headline
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div" title={m.subject ?? ""}>
          {m.subject || "(no subject)"} · {byLine(m.by)}
        </Typography>
        {r.lines.map((l, i) => (
          <Typography key={i} variant="caption" color="text.secondary" component="div" noWrap>
            • {l.text}
          </Typography>
        ))}
      </Box>
      {m.canUndo && (
        <Button
          size="small"
          sx={{ textTransform: "none" }}
          onClick={(e) => {
            e.stopPropagation();
            onUndo(m);
          }}
        >
          {L[lang].undo}
        </Button>
      )}
    </Stack>
  );
}

export function EmailDashboardView({ data, actions, onTasksChanged, onRefreshTasks }: { data: EmailDashboardData; actions: InboxActions; onTasksChanged: () => void; onRefreshTasks?: () => void }) {
  const { inbox, tasks, shipments, today } = data;
  const counts = taskCounts(tasks, today);
  const arriving = arrivingThisWeek(shipments ?? [], today);
  const emails = inbox?.toConfirm.emails ?? 0;
  const questions = inbox?.toConfirm.total ?? 0;
  const line = toDoLine({ questions, emails, overdue: counts.overdue, arriving: arriving.length });
  const sortedTasks = [...(tasks ?? [])].sort((a, b) => Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || a.dueAt.localeCompare(b.dueAt));
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1200, mx: "auto" }} data-tour="sales-dashboard">
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 0.5 }}>
        Dashboard
      </Typography>
      <Typography variant="body1" sx={{ mb: 2, fontWeight: 600, color: questions || counts.overdue ? "warning.main" : "text.secondary" }} data-tour="dashboard-todo">
        {data.loading ? "Loading…" : line}
      </Typography>
      <Stack spacing={2}>
        <Section
          title={actions.lang === "ja" ? "確認が必要なメール" : "Emails waiting for you"}
          count={inbox ? L[actions.lang].questionsDot(questions, emails) : ""}
          tour="dashboard-emails"
          action={
            <Button component={Link} href="/portal/shipments/dashboard?view=emails" size="small" sx={{ textTransform: "none" }} data-tour="dashboard-see-all-emails">
              {L[actions.lang].seeAll}
            </Button>
          }
        >
          {data.loading && !inbox ? (
            <CircularProgress size={22} />
          ) : (
            <InboxThreadList
              tab="UNPROCESSED"
              threads={inbox?.toConfirm.threads ?? []}
              actions={actions}
              emptyText={L[actions.lang].nothing}
              listLimit={5}
              footer={
                inbox && inbox.toConfirm.total > inbox.toConfirm.threads.length ? (
                  <Typography variant="caption" color="text.secondary">
                    <Link href="/portal/shipments/dashboard?view=emails">{L[actions.lang].seeAll}</Link> ({inbox.toConfirm.total})
                  </Typography>
                ) : undefined
              }
            />
          )}
        </Section>
        <Section title="Filed automatically" count={inbox ? `last 3 days: ${inbox.filedAuto.length}` : ""} tour="dashboard-filed">
          {!inbox?.filedAuto.length ? (
            <Typography variant="body2" color="text.secondary">
              Nothing was filed by itself in the last 3 days.
            </Typography>
          ) : (
            inbox.filedAuto.map((m) => <FiledRow key={m.id} m={m} lang={actions.lang} onUndo={actions.onUndo} onOpen={(mm) => actions.onOpen(mm)} />)
          )}
        </Section>
        <Section
          title="Tasks"
          count={tasks ? `${counts.total}${counts.overdue ? ` · ${counts.overdue} overdue` : ""}` : ""}
          tour="dashboard-tasks"
          action={
            onRefreshTasks ? (
              <Button size="small" onClick={onRefreshTasks}>
                Refresh reminders
              </Button>
            ) : undefined
          }
        >
          <TradeTasksList alerts={sortedTasks} loading={data.loading && !tasks} onChanged={onTasksChanged} />
        </Section>
        <Section title="Arriving this week" count={shipments ? arriving.length : ""} tour="dashboard-arriving">
          {!arriving.length ? (
            <Typography variant="body2" color="text.secondary">
              No shipment has an ETA in the next 7 days.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Shipment</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell>Vessel</TableCell>
                  <TableCell>ETA</TableCell>
                  <TableCell align="right" title={FREE_DAYS_HELP}>
                    Free days left
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {arriving.map((s) => {
                  const fd = freeDays(s);
                  return (
                    <TableRow key={s.id} hover sx={{ cursor: "pointer" }} onClick={() => (window.location.href = orderHref(s.orderId, s.id) ?? "#")}>
                      <TableCell sx={{ fontWeight: 700 }}>{s.ref ?? s.blNumber ?? "—"}</TableCell>
                      <TableCell title={s.customerName ?? undefined}>{shortCustomer(s.customerName) ?? "—"}</TableCell>
                      <TableCell>{[s.vessel, s.voyageNo].filter(Boolean).join(" / ") || "—"}</TableCell>
                      <TableCell>{s.eta ? fmtDmy(s.eta) : "—"}</TableCell>
                      <TableCell align="right" title={fd.title} sx={{ color: fd.tone === "over" || fd.tone === "warn" ? "error.main" : fd.tone === "pending" ? "text.secondary" : undefined, whiteSpace: "nowrap" }}>
                        {fd.text}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Section>
      </Stack>
    </Box>
  );
}

/** The live dashboard: queries + the inbox actions. */
export default function EmailDashboard() {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const act = useInboxActions(() => inbox.refetch());
  const inbox = useQuery({ queryKey: ["trade-inbox", "dashboard", act.lang], queryFn: () => api.inboxDashboard(act.lang), refetchInterval: 30_000 });
  const tasks = useMyTasks();
  const ships = useShipments({ tab: "in_transit", pageSize: 100 });
  const refreshTasks = useRefreshTasks();
  const actions: InboxActions = act.actions;
  if (inbox.isError) return <Alert severity="error">{(inbox.error as Error)?.message || "Could not load the dashboard"}</Alert>;
  return (
    <>
      <EmailDashboardView
        data={{ inbox: inbox.data, tasks: tasks.data, shipments: ships.data?.items, today: tradeTodayYmd(), loading: inbox.isLoading || tasks.isLoading || ships.isLoading }}
        actions={actions}
        onTasksChanged={() => qc.invalidateQueries({ queryKey: HOME_KEY })}
        onRefreshTasks={refreshTasks}
      />
      {act.dialogs}
    </>
  );
}
