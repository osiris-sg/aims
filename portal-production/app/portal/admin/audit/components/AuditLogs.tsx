"use client";

import React from "react";
import AdminCard from "@/components/AdminCard";
import useAuditTableHeader from "../hooks/useAuditTableHeader";
import PageTable from "@/components/PageTable";
import { useGetAuditLogs } from "../hooks/useGetAuditLogs";
import { Box, Typography, Card, CardContent, Chip, Button } from "@mui/material";
import { Security as SecurityIcon, Assessment as AssessmentIcon, Visibility as VisibilityIcon, Refresh as RefreshIcon } from "@mui/icons-material";

export default function AuditLogs() {
  const { columns } = useAuditTableHeader();
  const { auditLogs, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshAuditLogs } = useGetAuditLogs();

  // Calculate some basic stats for display
  const stats = React.useMemo(() => {
    if (loading || !auditLogs?.logs?.length) return null;

    const actionCounts = auditLogs.logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const statusCounts = auditLogs.logs.reduce((acc, log) => {
      acc[log.status] = (acc[log.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return { actionCounts, statusCounts };
  }, [auditLogs?.logs, loading]);

  // Available filter options for the audit logs (simplified for now)
  const availableFilters = ["createdOn"];

  return (
    <AdminCard>
      <Box sx={{ width: "100%" }}>
        {/* Stats Summary */}
        {stats && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
              <AssessmentIcon /> Audit Summary
            </Typography>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              <Card sx={{ minWidth: 200 }}>
                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                  <Typography variant="subtitle2" sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <SecurityIcon fontSize="small" /> Actions
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {Object.entries(stats.actionCounts).map(([action, count]) => (
                      <Chip key={action} label={`${action}: ${count}`} size="small" variant="outlined" />
                    ))}
                  </Box>
                </CardContent>
              </Card>

              <Card sx={{ minWidth: 200 }}>
                <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                  <Typography variant="subtitle2" sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <VisibilityIcon fontSize="small" /> Status
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {Object.entries(stats.statusCounts).map(([status, count]) => (
                      <Chip key={status} label={`${status}: ${count}`} size="small" variant="outlined" color={status === "SUCCESS" ? "success" : status === "FAILURE" ? "error" : "warning"} />
                    ))}
                  </Box>
                </CardContent>
              </Card>
            </Box>
          </Box>
        )}

        {/* Audit Logs Table */}
        <PageTable
          columns={columns}
          data={auditLogs?.logs || []}
          tableName="Audit Logs"
          subTitle="System audit trail and user activity logs"
          // No buttonName means no add button will be displayed
          loading={loading}
          page={page}
          limit={limit}
          search={search}
          filters={filters}
          setPage={setPage}
          setLimit={setLimit}
          setSearch={setSearch}
          setFilters={setFilters}
          availableFilters={availableFilters}
          pageCount={Math.ceil((auditLogs?.total || 0) / (auditLogs?.limit || 15))}
          totalDocs={auditLogs?.total || 0}
          actionButtons={[
            <Button key="refresh" variant="outlined" startIcon={<RefreshIcon />} onClick={refreshAuditLogs} disabled={loading}>
              Refresh
            </Button>,
          ]}
        />
      </Box>
    </AdminCard>
  );
}
