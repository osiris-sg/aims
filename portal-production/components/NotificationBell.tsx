"use client";

import React, { useState } from "react";
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  ListItemButton,
  Menu,
  Stack,
  Typography,
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { useRouter } from "next/navigation";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type NotificationItem,
} from "@/app/portal/hooks/api/useNotifications";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useQueryClient } from "@tanstack/react-query";
import { HOME_KEY, TradeTasksList, useMyTasks } from "@/app/portal/shipments/_components/TradeTasks";
import { bellBadge, taskCounts, tradeTodayYmd } from "@/app/portal/shipments/_lib/tasks";

// Compact relative time, no em-dashes in any user-facing string.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Portal header notification bell. Badge shows the caller's unread count in the
 * active org; the dropdown lists recent notifications. Clicking one marks it read
 * and opens the linked document. Field-tech never receive rows (audience is
 * scoped server-side to documents:read holders), so their bell is simply empty.
 *
 * Trade orgs (Shipments module on — round O, no Home page): the dropdown opens
 * with "Tasks" — the reminders due now and in the next 3 days with their ✓ done
 * / ✕ dismiss actions (the list that lived on Shipments › Home). A reminder's
 * own bell row (kind TRADE_ALERT) is folded into its task row while the task is
 * open, so nothing shows twice; ✓ / ✕ also marks that row read. The badge counts
 * unread rows plus the tasks due today or overdue.
 */
export default function NotificationBell({ sx, iconColor }: { sx?: SxProps<Theme>; iconColor?: string }) {
  const router = useRouter();
  const { items, unread } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const qc = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const { isNotificationsEnabled } = useOrganizationFeatures();
  const { isModuleEnabled } = useConfiguration();
  const trade = isModuleEnabled("SHIPMENTS");
  // 403 for users without shipments:read: no tasks section.
  const tasks = useMyTasks(trade && isNotificationsEnabled);
  const taskList = trade ? tasks.data : undefined;
  const taskIds = new Set((taskList ?? []).map((t) => t.id));
  const foldedIntoTask = (n: NotificationItem) => n.entityType === "trade-alert" && !!n.entityId && taskIds.has(n.entityId);
  const shown = items.filter((n) => !foldedIntoTask(n));
  const today = tradeTodayYmd();
  const counts = taskCounts(taskList, today);
  const badge = bellBadge(unread, taskList, today, items.filter((n) => foldedIntoTask(n) && !n.readAt).length);

  const onClickItem = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    setAnchorEl(null);
    if (n.linkUrl) router.push(n.linkUrl);
  };
  // ✓ / ✕ on a task: its bell row (if any) is read, both lists refresh.
  const onTaskActed = (a: { id: string }) => {
    const row = items.find((n) => n.entityType === "trade-alert" && n.entityId === a.id && !n.readAt);
    if (row) markRead.mutate(row.id);
  };

  if (!isNotificationsEnabled) return null;

  return (
    <>
      <IconButton
        aria-label="notifications"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={sx}
      >
        <Badge badgeContent={badge} color="error" max={99}>
          <NotificationsNoneIcon sx={{ color: iconColor }} />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: trade ? 420 : 360, maxWidth: "90vw", maxHeight: 520 } } }}
      >
        {trade && taskList && (
          <Box data-tour="bell-tasks">
            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
                Tasks ({counts.total})
              </Typography>
              {counts.overdue > 0 && (
                <Typography variant="caption" sx={{ color: "error.main", fontWeight: 700 }}>
                  {counts.overdue} overdue
                </Typography>
              )}
            </Stack>
            <Box sx={{ px: 2, pb: 1.5 }}>
              <TradeTasksList
                alerts={taskList}
                loading={tasks.isLoading}
                dense
                onActed={onTaskActed}
                onChanged={() => qc.invalidateQueries({ queryKey: HOME_KEY })}
                onNavigate={() => setAnchorEl(null)}
              />
            </Box>
            <Divider />
          </Box>
        )}
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Notifications
          </Typography>
          <Button
            size="small"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
            sx={{ textTransform: "none" }}
          >
            {markAll.isPending ? <CircularProgress size={16} /> : "Mark all read"}
          </Button>
        </Stack>
        <Divider />

        {shown.length === 0 ? (
          <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              You are all caught up.
            </Typography>
          </Box>
        ) : (
          shown.map((n) => (
            <ListItemButton
              key={n.id}
              onClick={() => onClickItem(n)}
              sx={{ alignItems: "flex-start", gap: 1, py: 1 }}
            >
              <Box
                sx={{
                  mt: "6px",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  bgcolor: n.readAt ? "transparent" : "primary.main",
                }}
              />
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="body2" fontWeight={n.readAt ? 400 : 700} noWrap>
                  {n.title}
                </Typography>
                {n.body && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {n.body}
                  </Typography>
                )}
                <Typography variant="caption" color="text.disabled">
                  {timeAgo(n.createdAt)}
                </Typography>
              </Box>
            </ListItemButton>
          ))
        )}
      </Menu>
    </>
  );
}
