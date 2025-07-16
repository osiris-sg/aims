"use client";

import React from "react";
import MainCard from "@/components/MainCard";
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
      <MainCard>
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
      </MainCard>
  );
}
