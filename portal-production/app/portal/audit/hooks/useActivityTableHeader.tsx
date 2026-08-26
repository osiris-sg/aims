import { useMemo } from "react";
import { Chip, Typography, Box, Tooltip } from "@mui/material";
import { format } from "date-fns";
import { ActionLogRow } from "./useGetActionLogs";

// MUI palette-based colors only — theme-aware in both light and dark mode.
const ACTOR_COLOR: Record<string, "primary" | "secondary" | "info" | "default"> = {
  USER: "primary",
  API_KEY: "secondary",
  GUEST: "info",
  SYSTEM: "default",
};

const ACTION_COLOR = (action: string): "success" | "warning" | "error" | "info" | "primary" | "default" => {
  if (action === "CREATE" || action === "CREATE_REVISION" || action === "DUPLICATE") return "success";
  if (action === "UPDATE" || action === "ASSIGN" || action === "LINK" || action === "MATCH") return "warning";
  if (action === "DELETE" || action === "VOID" || action === "REJECT" || action === "CANCEL" || action === "REVOKE") return "error";
  if (action === "VIEW") return "default";
  if (action === "CONFIRM" || action === "APPROVE" || action === "POST_GL" || action === "SIGN") return "info";
  return "primary"; // SEND, SYNC, EXPORT, RUN, domain verbs
};

export default function useActivityTableHeader() {
  const columns = useMemo(
    () => [
      {
        header: "Time",
        accessorKey: "createdAt",
        cell: ({ row }: { row: { original: ActionLogRow } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
            {format(new Date(row.original.createdAt), "MMM dd, HH:mm:ss")}
          </Typography>
        ),
        size: 130,
      },
      {
        header: "Actor",
        accessorKey: "actorName",
        cell: ({ row }: { row: { original: ActionLogRow } }) => {
          const r = row.original;
          return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip label={r.actorType === "API_KEY" ? "API" : r.actorType} size="small" variant="outlined" color={ACTOR_COLOR[r.actorType] || "default"} sx={{ fontSize: "0.7rem" }} />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
                  {r.actorName || (r.actorType === "SYSTEM" ? "System creation" : r.actorId)}
                </Typography>
                {r.actorEmail && (
                  <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.72rem" }}>
                    {r.actorEmail}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        },
        size: 230,
      },
      {
        header: "Action",
        accessorKey: "action",
        cell: ({ row }: { row: { original: ActionLogRow } }) => (
          <Chip label={row.original.action} size="small" color={ACTION_COLOR(row.original.action)} sx={{ fontSize: "0.72rem", fontWeight: 500 }} />
        ),
        size: 110,
      },
      {
        header: "Resource",
        accessorKey: "resource",
        cell: ({ row }: { row: { original: ActionLogRow } }) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
              {row.original.resource}
            </Typography>
            {row.original.resourceId && (
              <Tooltip title={row.original.resourceId}>
                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.72rem", fontVariantNumeric: "tabular-nums" }}>
                  {row.original.resourceId.substring(0, 8)}…
                </Typography>
              </Tooltip>
            )}
          </Box>
        ),
        size: 150,
      },
      {
        header: "Request",
        accessorKey: "path",
        cell: ({ row }: { row: { original: ActionLogRow } }) => {
          const r = row.original;
          const detail = r.details ? JSON.stringify(r.details) : "";
          return (
            <Tooltip title={detail.length > 2 ? detail : ""}>
              <Typography variant="body2" sx={{ fontSize: "0.78rem", fontFamily: "monospace", maxWidth: 260, whiteSpace: "normal", wordBreak: "break-word" }}>
                {r.method ? `${r.method} ${r.path}` : r.details?.note || "—"}
              </Typography>
            </Tooltip>
          );
        },
        size: 260,
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: { row: { original: ActionLogRow } }) => {
          const r = row.original;
          return (
            <Tooltip title={r.details?.error || ""}>
              <Chip
                label={r.statusCode ? `${r.status} ${r.statusCode}` : r.status}
                size="small"
                color={r.status === "SUCCESS" ? "success" : "error"}
                variant={r.status === "SUCCESS" ? "outlined" : "filled"}
                sx={{ fontSize: "0.7rem", fontWeight: 500 }}
              />
            </Tooltip>
          );
        },
        size: 120,
      },
      {
        header: "Duration",
        accessorKey: "durationMs",
        cell: ({ row }: { row: { original: ActionLogRow } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.8rem", fontVariantNumeric: "tabular-nums", color: (row.original.durationMs || 0) > 2000 ? "warning.main" : "text.secondary" }}>
            {row.original.durationMs != null ? `${row.original.durationMs} ms` : "—"}
          </Typography>
        ),
        size: 90,
      },
      {
        header: "IP",
        accessorKey: "ipAddress",
        cell: ({ row }: { row: { original: ActionLogRow } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
            {row.original.ipAddress || "—"}
          </Typography>
        ),
        size: 120,
      },
    ],
    []
  );

  return { columns };
}
