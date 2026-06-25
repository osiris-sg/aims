"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Box, Paper, Typography, Stack, TextField, Button, MenuItem,
  CircularProgress, Alert, Chip,
} from "@mui/material";
import { useAccountingApi } from "../_lib/api";
import PageTable from "@/components/PageTable";

type Supplier = { id: string; name: string };
type Tx = { date: string; type: "BILL" | "PAYMENT"; reference: string; description: string; debit: number; credit: number; balance: number };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SupplierStatementPage() {
  const { request } = useAccountingApi();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // PageTable-driven state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  useEffect(() => {
    (async () => {
      try {
        const res: any = await request("/suppliers");
        const list = Array.isArray(res) ? res : res?.data || [];
        setSuppliers(list);
      } catch { /* silent */ }
    })();
  }, [request]);

  const run = async () => {
    if (!supplierId) return;
    setLoading(true);
    try {
      const res: any = await request("/statements/supplier-soa", {
        method: "POST",
        body: JSON.stringify({ supplierId, startDate: startDate || undefined, endDate: endDate || undefined }),
      });
      setData(res?.data || res);
    } finally {
      setLoading(false);
    }
  };

  const transactions: Tx[] = data?.transactions || [];

  const visible = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(
      (t) =>
        (t.reference || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.type || "").toLowerCase().includes(q),
    );
  }, [transactions, search]);

  useEffect(() => { setPage(1); }, [search, data]);

  const pageCount = Math.max(1, Math.ceil(visible.length / limit));
  const paged = useMemo(
    () => visible.slice((page - 1) * limit, page * limit),
    [visible, page, limit],
  );

  const columns = useMemo(() => [
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }: any) => <Box sx={{ fontSize: "0.8rem" }}>{new Date(row.original.date).toLocaleDateString()}</Box>,
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }: any) => (
        <Chip size="small" label={row.original.type} color={row.original.type === "BILL" ? "warning" : "success"} variant="outlined" sx={{ fontSize: "0.65rem" }} />
      ),
    },
    {
      accessorKey: "reference",
      header: "Reference",
      cell: ({ row }: any) => <Box sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{row.original.reference}</Box>,
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }: any) => <Box sx={{ fontSize: "0.8rem" }}>{row.original.description}</Box>,
    },
    {
      accessorKey: "debit",
      header: "Bill",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>
          {row.original.debit ? fmt(row.original.debit) : "—"}
        </Box>
      ),
    },
    {
      accessorKey: "credit",
      header: "Payment",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>
          {row.original.credit ? fmt(row.original.credit) : "—"}
        </Box>
      ),
    },
    {
      accessorKey: "balance",
      header: "Balance",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{fmt(row.original.balance)}</Box>
      ),
    },
  ], []);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Supplier Statement of Account</Typography>
        <Typography variant="body2" color="text.secondary">
          Bill + payment history for one supplier with running outstanding balance.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="flex-end">
          <TextField
            select size="small" label="Supplier" value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)} sx={{ minWidth: 320 }}
          >
            {suppliers.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <Button variant="contained" onClick={run} disabled={!supplierId || loading}>
            {loading ? <CircularProgress size={18} /> : "Generate"}
          </Button>
        </Stack>
      </Paper>

      {!data && !loading && (
        <Alert severity="info">Pick a supplier and click Generate.</Alert>
      )}

      {data && (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" flexWrap="wrap" gap={2}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{data.supplier.name}</Typography>
                {data.supplier.address && <Typography variant="caption" color="text.secondary">{data.supplier.address}</Typography>}
              </Box>
              <Stack direction="row" gap={3}>
                <Box><Typography variant="caption" color="text.secondary">Opening</Typography>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 600 }}>{fmt(data.summary.openingBalance)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Bills</Typography>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 600 }}>{fmt(data.summary.totalDebit)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Payments</Typography>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 600 }}>{fmt(data.summary.totalCredit)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Closing</Typography>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.1rem" }}>{fmt(data.summary.closingBalance)}</Typography></Box>
              </Stack>
            </Stack>
          </Paper>

          {data.aging && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Aging (outstanding)</Typography>
              <Stack direction="row" gap={3} flexWrap="wrap">
                {(["current","days30","days60","days90","days120Plus"] as const).map((k) => (
                  <Box key={k}>
                    <Typography variant="caption" color="text.secondary">{({ current: "0-30 days", days30: "31-60", days60: "61-90", days90: "91-120", days120Plus: "120+" })[k]}</Typography>
                    <Typography sx={{ fontFamily: "monospace", fontWeight: 600 }}>{fmt(data.aging[k] || 0)}</Typography>
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}

          <PageTable
            columns={columns}
            data={paged}
            tableName="Transactions"
            subTitle="Bills + payments with running balance"
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
