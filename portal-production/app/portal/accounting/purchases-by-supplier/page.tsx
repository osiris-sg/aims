"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Box, Paper, Typography, Stack, Button, CircularProgress, Alert } from "@mui/material";
import { useAccountingApi } from "../_lib/api";
import PageTable from "@/components/PageTable";
import { useClientSort } from "@/components/clientSort";
import { DEFAULT_PAGE_SIZE } from "@/components/PageTable";
import DateInput from "@/components/DateInput";
import { FiscalYearButton } from "../_lib/report-shell/DateRangeSelect";

const fmt = (n: number) => (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PurchasesBySupplierPage() {
  const { request } = useAccountingApi();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // PageTable-driven state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const run = async () => {
    setLoading(true);
    try {
      const url = `/statements/purchases-by-supplier${startDate || endDate ? `?startDate=${startDate}&endDate=${endDate}` : ""}`;
      const res: any = await request(url);
      setData(res?.data || res);
    } finally {
      setLoading(false);
    }
  };

  const rows: any[] = data?.rows || [];

  const visible = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.name || "").toLowerCase().includes(q));
  }, [rows, search]);

  useEffect(() => { setPage(1); }, [search, data]);

  // Header sort over the WHOLE filtered list (not just the visible page);
  // the table is in manualSorting mode. All columns are direct row fields.
  const { sorted, sorting, sortingProps } = useClientSort(visible);

  useEffect(() => { setPage(1); }, [sorting]);

  const pageCount = Math.max(1, Math.ceil(visible.length / limit));
  const paged = useMemo(
    () => sorted.slice((page - 1) * limit, page * limit),
    [sorted, page, limit],
  );

  const columns = useMemo(() => [
    { accessorKey: "name", header: "Supplier", cell: ({ row }: any) => row.original.name },
    {
      accessorKey: "billCount",
      header: "Bills",
      cell: ({ row }: any) => <Box sx={{ textAlign: "right" }}>{row.original.billCount}</Box>,
    },
    {
      accessorKey: "totalPurchases",
      header: "Total Purchases",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${fmt(row.original.totalPurchases)}</Box>
      ),
    },
    {
      accessorKey: "totalPaid",
      header: "Paid",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>${fmt(row.original.totalPaid)}</Box>
      ),
    },
    {
      accessorKey: "outstanding",
      header: "Outstanding",
      cell: ({ row }: any) => {
        const v = row.original.outstanding;
        return (
          <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: v > 0 ? 600 : 400, color: v > 0 ? "warning.main" : "text.primary" }}>
            ${fmt(v)}
          </Box>
        );
      },
    },
  ], []);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Purchases by Supplier</Typography>
        <Typography variant="body2" color="text.secondary">Total billed + paid + outstanding per supplier.</Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" gap={2} alignItems="flex-end" flexWrap="wrap">
          <DateInput size="small" label="From" InputLabelProps={{ shrink: true }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <DateInput size="small" label="To" InputLabelProps={{ shrink: true }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <FiscalYearButton from={startDate} to={endDate} onPick={(f, t) => { setStartDate(f); setEndDate(t); }} />
          <Button variant="contained" onClick={run} disabled={loading}>
            {loading ? <CircularProgress size={18} /> : "Generate"}
          </Button>
        </Stack>
      </Paper>

      {!data && !loading && <Alert severity="info">Click Generate to load all-time purchases by supplier.</Alert>}

      {data && (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" gap={4} flexWrap="wrap">
              <Box><Typography variant="caption" color="text.secondary">Bills</Typography>
                <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{data.totals.billCount}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Total Purchases</Typography>
                <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>${fmt(data.totals.totalPurchases)}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Paid</Typography>
                <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>${fmt(data.totals.totalPaid)}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Outstanding</Typography>
                <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "warning.main" }}>${fmt(data.totals.outstanding)}</Typography></Box>
            </Stack>
          </Paper>

          <PageTable
            columns={columns}
            data={paged}
            {...sortingProps}
            tableName="Purchases by Supplier"
            subTitle="One row per supplier in the selected range"
            loading={loading}
            page={page}
            limit={limit}
            search={search}
            filters={filters}
            setPage={setPage}
            setLimit={setLimit}
            setSearch={setSearch}
            setFilters={setFilters}
            pageCount={pageCount}
            totalDocs={visible.length}
          />
        </>
      )}
    </Box>
  );
}
