import { useMemo } from "react";
import { Chip, Typography, Box } from "@mui/material";
import { format } from "date-fns";
import { AuditLog } from "./useGetAuditLogs";
import { useTranslations } from "next-intl";
import { useUiLang } from "@/i18n/UiLangProvider";

export default function useAuditTableHeader() {
  const t = useTranslations("audit.legacy");
  const { lang } = useUiLang();
  const columns = useMemo(
    () => [
      {
        header: t("timestamp"),
        accessorKey: "createdAt",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.85rem" }}>
            {format(new Date(row.original.createdAt), lang === "ja" ? "yyyy/MM/dd HH:mm:ss" : "MMM dd, yyyy HH:mm:ss")}
          </Typography>
        ),
        size: 160,
      },
      {
        header: t("user"),
        accessorKey: "userName",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
              {row.original.userName || t("unknown")}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.75rem" }}>
              {row.original.userEmail || row.original.userId}
            </Typography>
          </Box>
        ),
        size: 200,
      },
      {
        header: t("action"),
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
        header: t("resource"),
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
        header: t("resourceId"),
        accessorKey: "resourceId",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.85rem", fontVariantNumeric: "tabular-nums" }}>
            {row.original.resourceId ? row.original.resourceId.substring(0, 8) + "..." : "-"}
          </Typography>
        ),
        size: 120,
      },
      {
        header: t("status"),
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
        header: t("ipAddress"),
        accessorKey: "ipAddress",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Typography variant="body2" sx={{ fontSize: "0.85rem", fontVariantNumeric: "tabular-nums" }}>
            {row.original.ipAddress || "-"}
          </Typography>
        ),
        size: 120,
      },
      {
        header: t("error"),
        accessorKey: "errorMessage",
        cell: ({ row }: { row: { original: AuditLog } }) => (
          <Typography
            variant="body2"
            sx={{
              fontSize: "0.85rem",
              color: row.original.errorMessage ? "error.main" : "text.secondary",
              maxWidth: "200px",
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
            title={row.original.errorMessage || ""}
          >
            {row.original.errorMessage || "-"}
          </Typography>
        ),
        size: 200,
      },
    ],
    [t, lang]
  );

  return {
    columns,
  };
}
