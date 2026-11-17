"use client";

// Sales report (WCT group, 2026-11-18; enableSalesReport). One salesperson's quotations (or all) for a quotation
// date range: summary by category (Signed vs Pending) on top, then QO No. / Date / Customer / Subject / Category /
// Amount (excl. GST) / Status. Server: GET /sales-report (src/sales-report). Admin / Accounting see everyone; a
// Sales-only user gets their own quotations (the server enforces it; the picker just shows them).
// Print / Export: the shared ReportPrintExportButton with one ReportExportModel (helpers/salesReport.ts).

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import PageTable, { DEFAULT_PAGE_SIZE } from "@/components/PageTable";
import { request, withActiveOrg } from "@/helpers/request";
import { todayIso } from "@/helpers/orgToday";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { ReportPrintExportButton } from "@/app/portal/accounting/_lib/report-export";
import { SUMMARY_HEADERS, paperDate, salesReportModel, summaryRows, type SalesReportData, type SalesReportRow, type SalesStatus } from "@/helpers/salesReport";

const STATUS_COLOR: Record<SalesStatus, "success" | "warning" | "default" | "error"> = {
  Signed: "success",
  Pending: "warning",
  Draft: "default",
  Cancelled: "error",
};

const money = (n: number) => (Number(n) || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const firstOfMonth = (iso: string) => `${iso.slice(0, 8)}01`;

export default function SalesReportPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { isSalesReportEnabled, isLoading } = useOrganizationFeatures();
  const today = todayIso();
  const [salesperson, setSalesperson] = useState("");
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<SalesReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  useEffect(() => {
    if (!isSalesReportEnabled) return;
    let gone = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const qs = new URLSearchParams();
        if (salesperson) qs.set("salesperson", salesperson);
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        const res: any = await request({ path: `/sales-report?${qs.toString()}`, method: "GET" }, {}, token ?? undefined);
        const body = res?.data && Array.isArray(res.data.rows) ? res.data : res;
        if (res?.success === false || !Array.isArray(body?.rows)) throw new Error(res?.message || "Could not load the report");
        if (!gone) {
          setData(body);
          setPage(1);
        }
      } catch (e: any) {
        const m = e?.message;
        if (!gone) setError((Array.isArray(m) ? m.join(". ") : m) || "Could not load the report");
      } finally {
        if (!gone) setLoading(false);
      }
    })();
    return () => {
      gone = true;
    };
  }, [isSalesReportEnabled, salesperson, from, to, getToken]);

  const own = data?.scope === "own";
  const salespersonLabel = own
    ? data?.salespeople?.[0]?.label || ""
    : salesperson
    ? data?.salespeople.find((p) => p.key === salesperson)?.label || salesperson
    : "All";

  const visible = useMemo(() => {
    const rows = data?.rows || [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.number, r.customer, r.subject, r.category, r.status].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [data, search]);
  useEffect(() => setPage(1), [search]);
  const paged = useMemo(() => visible.slice((page - 1) * limit, page * limit), [visible, page, limit]);

  const columns = useMemo(
    () => [
      { accessorKey: "number", header: "QO No." },
      { accessorKey: "date", header: "Date", cell: ({ row }: any) => paperDate(row.original.date) },
      { accessorKey: "customer", header: "Customer" },
      { accessorKey: "subject", header: "Subject" },
      { accessorKey: "category", header: "Category" },
      {
        accessorKey: "amount",
        header: "Amount (excl. GST)",
        cell: ({ row }: any) => <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(row.original.amount)}</Box>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }: any) => <Chip size="small" variant="outlined" color={STATUS_COLOR[row.original.status as SalesStatus] || "default"} label={row.original.status} />,
      },
    ],
    [],
  );

  const hrefOf = (r: SalesReportRow) => (r.templateId ? withActiveOrg(`/portal/documents/QUOTATION/${r.templateId}/${r.id}`) : "");

  if (isLoading) return null;
  if (!isSalesReportEnabled) {
    return (
      <Box sx={{ p: { xs: 1.5, md: 3 } }}>
        <Alert severity="info">The sales report is not enabled for this organisation.</Alert>
      </Box>
    );
  }

  const summary = data ? summaryRows(data) : [];

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Sales report
        </Typography>
        <Box sx={{ flex: 1 }} />
        <ReportPrintExportButton getModel={() => (data ? salesReportModel(data, { orgName: organization?.name || "", salespersonLabel }) : null)} />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} gap={2} alignItems={{ xs: "stretch", sm: "flex-end" }} flexWrap="wrap">
          <TextField
            select
            size="small"
            label="Salesperson"
            value={own ? data?.salespeople?.[0]?.key || "" : salesperson}
            onChange={(e) => setSalesperson(e.target.value)}
            disabled={own}
            sx={{ minWidth: 220 }}
            SelectProps={{ displayEmpty: true }}
            InputLabelProps={{ shrink: true }}
            data-tour="sales-report-salesperson"
          >
            {!own && <MenuItem value="">All</MenuItem>}
            {(data?.salespeople || []).map((p) => (
              <MenuItem key={p.key} value={p.key}>
                {p.label}
              </MenuItem>
            ))}
            {!own && salesperson && !(data?.salespeople || []).some((p) => p.key === salesperson) && <MenuItem value={salesperson}>{salespersonLabel}</MenuItem>}
          </TextField>
          <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} data-tour="sales-report-dates" />
          <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
          {loading && <CircularProgress size={22} sx={{ alignSelf: "center" }} />}
        </Stack>
      </Paper>

      {error && (
        <Alert severity="warning" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {data && (
        <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }} data-tour="sales-report-summary">
          <Table size="small">
            <TableHead>
              <TableRow>
                {SUMMARY_HEADERS.map((h, i) => (
                  <TableCell key={h} sx={{ fontWeight: 700, textAlign: i === 0 ? "left" : "right" }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.map((r, ri) => (
                <TableRow key={ri} sx={ri === summary.length - 1 ? { "& td": { fontWeight: 700, borderTop: 2, borderColor: "divider" } } : undefined}>
                  {r.map((v, i) => (
                    <TableCell key={i} sx={{ textAlign: i === 0 ? "left" : "right", fontVariantNumeric: "tabular-nums" }}>
                      {v}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {data && (
        <PageTable
          columns={columns}
          data={paged}
          tableName="Quotations"
          loading={loading}
          page={page}
          limit={limit}
          search={search}
          filters={filters}
          setPage={setPage}
          setLimit={setLimit}
          setSearch={setSearch}
          setFilters={setFilters}
          pageCount={Math.max(1, Math.ceil(visible.length / limit))}
          totalDocs={visible.length}
          onRowClick={(r: SalesReportRow) => {
            const href = hrefOf(r);
            if (href) router.push(href);
          }}
          rowHref={(r: SalesReportRow) => hrefOf(r)}
          rowSx={() => ({ cursor: "pointer" })}
          noSelectionColumn
        />
      )}
    </Box>
  );
}
