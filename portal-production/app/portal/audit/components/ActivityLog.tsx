"use client";

import React from "react";
import PageTable from "@/components/PageTable";
import useActivityTableHeader from "../hooks/useActivityTableHeader";
import { useGetActionLogs } from "../hooks/useGetActionLogs";
import { Button, MenuItem, TextField } from "@mui/material";
import { Refresh as RefreshIcon } from "@mui/icons-material";

const ACTOR_TYPES = ["", "USER", "API_KEY", "GUEST", "SYSTEM"];
const STATUSES = ["", "SUCCESS", "FAILURE"];

export default function ActivityLog() {
  const { columns } = useActivityTableHeader();
  const { data, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refresh } = useGetActionLogs();

  const setFilter = (key: string, value: string) => {
    setPage(1);
    setFilters((prev: any) => ({ ...prev, [key]: value }));
  };

  return (
    <PageTable
      columns={columns}
      data={data.logs}
      tableName="Activity Log"
      subTitle="Every action in the system — users, API keys, guests and system creation"
      loading={loading}
      page={page}
      limit={limit}
      search={search}
      filters={filters}
      setPage={setPage}
      setLimit={setLimit}
      setSearch={setSearch}
      setFilters={setFilters}
      availableFilters={["createdOn"]}
      pageCount={Math.ceil((data.total || 0) / (data.limit || 25))}
      totalDocs={data.total || 0}
      actionButtons={[
        <TextField
          key="actorType"
          select
          size="small"
          label="Actor type"
          value={filters.actorType}
          onChange={(e) => setFilter("actorType", e.target.value)}
          sx={{ minWidth: 140 }}
        >
          {ACTOR_TYPES.map((t) => (
            <MenuItem key={t || "all"} value={t}>
              {t === "" ? "All" : t === "SYSTEM" ? "System creation" : t === "API_KEY" ? "API key" : t.charAt(0) + t.slice(1).toLowerCase()}
            </MenuItem>
          ))}
        </TextField>,
        <TextField key="status" select size="small" label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} sx={{ minWidth: 120 }}>
          {STATUSES.map((s) => (
            <MenuItem key={s || "all"} value={s}>
              {s === "" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </MenuItem>
          ))}
        </TextField>,
        <Button key="refresh" variant="outlined" startIcon={<RefreshIcon />} onClick={refresh} disabled={loading}>
          Refresh
        </Button>,
      ]}
    />
  );
}
