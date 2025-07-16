import { useMemo } from "react";
import { Chip, Typography, Box } from "@mui/material";
import { format } from "date-fns";
import { AuditLog } from "./useGetAuditLogs";

export default function useAuditTableHeader() {
  const columns = useMemo(
    () => [
      {
        header: "Timestamp",
        accessorKey: "createdAt",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.85rem" }}>
            {format(new Date(row.original.createdAt), "MMM dd, yyyy HH:mm:ss")}
          </Typography>
        ),
        size: 160,
      },
      {
        header: "User",
        accessorKey: "userName",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
              {row.original.userName || "Unknown"}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.75rem" }}>
              {row.original.userEmail || row.original.userId}
            </Typography>
          </Box>
        ),
        size: 200,
      },
      {
        header: "Action",
        accessorKey: "action",
        cell: ({ row }: { row: { original: AuditLog } }) => {
          const getActionColor = (action: string) => {
            switch (action) {
              case "CREATE":
                return "success";
              case "UPDATE":
                return "warning";
              case "DELETE":
                return "error";
              case "LOGIN":
                return "info";
              case "LOGOUT":
                return "default";
              case "READ":
                return "primary";
              default:
                return "default";
            }
          };

          return <Chip label={row.original.action} size="small" color={getActionColor(row.original.action) as any} sx={{ fontSize: "0.75rem", fontWeight: 500 }} />;
        },
        size: 100,
      },
      {
        header: "Resource",
        accessorKey: "resource",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
              {row.original.resource}
            </Typography>
            {row.original.resourceName && (
              <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.75rem" }}>
                {row.original.resourceName}
              </Typography>
            )}
          </Box>
        ),
        size: 150,
      },
      {
        header: "Resource ID",
        accessorKey: "resourceId",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.85rem", fontFamily: "monospace" }}>
            {row.original.resourceId ? row.original.resourceId.substring(0, 8) + "..." : "-"}
          </Typography>
        ),
        size: 120,
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: ({ row }: { row: { original: AuditLog } }) => {
          const getStatusColor = (status: string) => {
            switch (status) {
              case "SUCCESS":
                return "success";
              case "FAILURE":
                return "error";
              case "PENDING":
                return "warning";
              default:
                return "default";
            }
          };

          return <Chip label={row.original.status} size="small" color={getStatusColor(row.original.status) as any} sx={{ fontSize: "0.75rem", fontWeight: 500 }} />;
        },
        size: 100,
      },
      {
        header: "IP Address",
        accessorKey: "ipAddress",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.85rem", fontFamily: "monospace" }}>
            {row.original.ipAddress || "-"}
          </Typography>
        ),
        size: 120,
      },
      {
        header: "Error",
        accessorKey: "errorMessage",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Typography
            variant="body2"
            sx={{
              fontSize: "0.85rem",
              color: row.original.errorMessage ? "error.main" : "text.secondary",
              maxWidth: "200px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={row.original.errorMessage || ""}
          >
            {row.original.errorMessage || "-"}
          </Typography>
        ),
        size: 200,
      },
    ],
    []
  );

  return {
    columns,
  };
}
