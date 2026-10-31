/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// "My tasks today" (round O): the reminders due now and in the next 3 days
// (tax funding, arrival notices, free time, due dates, stuck steps) with their
// ✓ done / ✕ dismiss actions. Lived on Shipments › Home; with no Home page
// (enableShipmentsHome off) the same list shows in the bell and behind the
// Orders list's "Tasks (n)" button (a side panel). One query, one list.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Box, Button, Chip, CircularProgress, Divider, Drawer, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import ChecklistIcon from "@mui/icons-material/ChecklistRtl";
import { useShipmentsApi, type TradeAlert } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { fmtDmy } from "../_lib/format";
import { toast } from "../_lib/toast";
import { isOverdue, taskCounts, tradeTodayYmd } from "../_lib/tasks";

/** Home's query key prefix: invalidating it refreshes the tasks everywhere. */
export const HOME_KEY = [...SHIPMENT_KEYS.orders, "dashboard"] as const;
export const TASKS_KEY = [...HOME_KEY, "tasks"] as const;

/** The caller's org's tasks (403 for users without shipments:read: no data, no retry). */
export function useMyTasks(enabled = true) {
  const api = useShipmentsApi();
  return useQuery({ queryKey: TASKS_KEY, queryFn: () => api.myTasks(), enabled, retry: false, refetchInterval: 60_000, refetchOnWindowFocus: true });
}

export function useRefreshTasks() {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  return async () => {
    try {
      const r = await api.refreshAlerts();
      await qc.invalidateQueries({ queryKey: HOME_KEY });
      toast.success(`Reminders re-planned (${r.created} new, ${r.updated} changed)`);
    } catch (e: any) {
      toast.error(e?.message || "Could not refresh");
    }
  };
}

export function TradeTasksList({
  alerts,
  loading,
  onChanged,
  onActed,
  dense,
  onNavigate,
}: {
  alerts?: TradeAlert[];
  loading: boolean;
  /** After a ✓ / ✕: re-fetch. */
  onChanged: () => void;
  /** After a ✓ / ✕ succeeded on this alert (the bell marks its notification read). */
  onActed?: (a: TradeAlert) => void;
  dense?: boolean;
  /** Before following a task's link (the bell closes its menu). */
  onNavigate?: () => void;
}) {
  const api = useShipmentsApi();
  const router = useRouter();
  const today = tradeTodayYmd();
  const act = async (a: TradeAlert, fn: () => Promise<unknown>) => {
    try {
      await fn();
      onActed?.(a);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Could not update");
    }
  };
  if (loading) return <CircularProgress size={22} />;
  if (!alerts?.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing due — reminders appear here (tax funding, arrival notices, free time, due dates, stuck steps, steps past their due date).
      </Typography>
    );
  }
  return (
    <Stack spacing={dense ? 0.5 : 0.75} data-tour="my-tasks">
      {alerts.map((a) => {
        const overdue = isOverdue(a, today);
        return (
          <Stack key={a.id} direction="row" spacing={1} alignItems="center">
            <Chip size="small" color={overdue ? "error" : a.status === "DUE" ? "warning" : "default"} label={fmtDmy(a.dueAt)} sx={{ minWidth: 92 }} />
            <Box
              sx={{ flex: 1, minWidth: 0, cursor: a.linkUrl ? "pointer" : undefined }}
              onClick={() => {
                if (!a.linkUrl) return;
                onNavigate?.();
                router.push(a.linkUrl);
              }}
            >
              <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                {a.title}
              </Typography>
              {a.detail && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }}>
                  {a.detail}
                </Typography>
              )}
            </Box>
            {a.kind === "STEP_DUE" ? (
              // Round AY: a step's due date — it closes when the step is done; the date is changed on the order's Overall process.
              <Tooltip title="Closes when the step is done. Change its due date on the order's Overall process.">
                <Chip size="small" variant="outlined" label="Step" data-tour="task-step-due" />
              </Tooltip>
            ) : (
              <>
                <Tooltip title="Done">
                  <IconButton size="small" aria-label="Done" onClick={() => act(a, () => api.alertDone(a.id))}>
                    <CheckIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Dismiss (comes back if its date moves)">
                  <IconButton size="small" aria-label="Dismiss" onClick={() => act(a, () => api.alertDismiss(a.id))}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Stack>
        );
      })}
    </Stack>
  );
}

/** "Tasks (n)" on the Orders list header: opens the list in a side panel; the overdue count in red. */
export function TasksButton() {
  const tasks = useMyTasks();
  const qc = useQueryClient();
  const refresh = useRefreshTasks();
  const [open, setOpen] = useState(false);
  const counts = taskCounts(tasks.data, tradeTodayYmd());
  return (
    <>
      <Badge badgeContent={counts.overdue} color="error" overlap="rectangular" invisible={!counts.overdue}>
        <Button variant="outlined" startIcon={<ChecklistIcon />} onClick={() => setOpen(true)} data-tour="orders-tasks" sx={{ whiteSpace: "nowrap" }}>
          Tasks ({counts.total})
        </Button>
      </Badge>
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: { xs: "100vw", sm: 440 }, p: 2 } } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            My tasks today
          </Typography>
          <IconButton size="small" aria-label="Close" onClick={() => setOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          {counts.total} task{counts.total === 1 ? "" : "s"} due now or in the next 3 days
          {counts.overdue ? (
            <>
              {" · "}
              <Box component="span" sx={{ color: "error.main", fontWeight: 700 }}>
                {counts.overdue} overdue
              </Box>
            </>
          ) : null}
        </Typography>
        <TradeTasksList alerts={tasks.data} loading={tasks.isLoading} onChanged={() => qc.invalidateQueries({ queryKey: HOME_KEY })} onNavigate={() => setOpen(false)} />
        <Divider sx={{ my: 2 }} />
        <Button startIcon={<RefreshIcon />} onClick={refresh} size="small" sx={{ alignSelf: "flex-start" }}>
          Refresh reminders
        </Button>
      </Drawer>
    </>
  );
}
