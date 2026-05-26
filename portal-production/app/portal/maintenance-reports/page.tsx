"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import { request } from "@/helpers/request";

interface ServiceData {
  customerName?: string | null;
  serviceDate?: string | null;
  jobLocation?: string | null;
}

interface MsrRow {
  id: string;
  reportNumber: number | null;
  createdAt: string;
  paymentRequired: boolean;
  invoiceDocumentId: string | null;
  serviceData: ServiceData | null;
  asset: { name: string; skuKey: string } | null;
  inventory: { sku: string; serialNumber: string | null } | null;
}

type StatusKind = "completed" | "pending-invoice" | "invoice-created";

const statusFor = (row: MsrRow): StatusKind => {
  if (!row.paymentRequired) return "completed";
  if (row.invoiceDocumentId) return "invoice-created";
  return "pending-invoice";
};

const statusChipProps = (kind: StatusKind): { label: string; color: "success" | "warning"; variant: "filled" | "outlined" } => {
  if (kind === "pending-invoice") return { label: "Pending Invoice", color: "warning", variant: "filled" };
  if (kind === "invoice-created") return { label: "Invoice Created", color: "success", variant: "outlined" };
  return { label: "Completed", color: "success", variant: "filled" };
};

interface ListResponse {
  docs: MsrRow[];
  total: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

const LIMIT = 20;

export default function MaintenanceReportsListPage() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce typing — flush 300 ms after the last keystroke. Resets page to 1
  // so the user isn't stuck on (now-empty) page 4 of a filtered result.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      const res = await request(
        { path: `/maintenance-reports?${qs.toString()}`, method: "GET" },
        {},
        token,
      );
      const payload = res?.data ?? res;
      setData(payload as ListResponse);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load service reports");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const docs = data?.docs ?? [];
  const total = data?.total ?? 0;
  const hasNext = !!data?.hasNextPage;
  const hasPrev = !!data?.hasPreviousPage;
  const startIdx = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIdx = (page - 1) * LIMIT + docs.length;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Service Reports</Typography>
          <Typography variant="body2" color="text.secondary">
            Maintenance &amp; Inspection Service Reports submitted from the field
          </Typography>
        </Box>
        {/* Disabled "New Report" button — reports originate from the field app's
            NFC scan flow. The span wrapper is required because MUI disabled
            buttons don't fire pointer events, which would suppress the Tooltip. */}
        <Tooltip title="Use the AIMS Field app to create reports">
          <span>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              disabled
              sx={{ minHeight: 40 }}
            >
              New Report
            </Button>
          </span>
        </Tooltip>
      </Stack>

      <TextField
        placeholder="Search by report number or customer name"
        size="small"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        InputProps={{
          startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />,
        }}
        fullWidth
      />

      {error && <Alert severity="error">{error}</Alert>}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: 100 }}>Report #</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Model</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 140 }}>Service Date</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 160 }}>Created</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 160 }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : docs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6, color: "text.secondary" }}>
                  {debouncedSearch ? "No reports match this search." : "No service reports yet."}
                </TableCell>
              </TableRow>
            ) : (
              docs.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  onClick={() => router.push(`/portal/maintenance-reports/${row.id}`)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.reportNumber ?? "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.serviceData?.customerName ?? "—"}</TableCell>
                  <TableCell>{row.asset?.name ?? "—"}</TableCell>
                  <TableCell>{row.inventory?.sku ?? "—"}</TableCell>
                  <TableCell>{row.serviceData?.serviceDate ?? "—"}</TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {(() => {
                      const chip = statusChipProps(statusFor(row));
                      return <Chip size="small" label={chip.label} color={chip.color} variant={chip.variant} />;
                    })()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          {total === 0 ? "0 results" : `${startIdx}–${endIdx} of ${total}`}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!hasPrev || loading}
          >
            Previous
          </Button>
          <Typography variant="body2" sx={{ mx: 1 }}>Page {page}</Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
          >
            Next
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
