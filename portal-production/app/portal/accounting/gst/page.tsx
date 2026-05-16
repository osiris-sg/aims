"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PrintIcon from "@mui/icons-material/Print";
import SearchIcon from "@mui/icons-material/Search";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";

type Category =
  | "OUTPUT_STANDARD"
  | "OUTPUT_ZERO"
  | "OUTPUT_EXEMPT"
  | "INPUT_STANDARD"
  | "INPUT_ZERO"
  | "INPUT_EXEMPT";

type Detail = {
  journalEntryId: string;
  journalNumber: string;
  sourceDocumentId: string | null;
  date: string;
  type: string;
  remarks: string;
  preTaxAmount: number;
  taxRate: number;
  taxAmount: number;
  category: Category;
};

type Report = {
  period: { from: string | null; to: string | null };
  taxRegistrationNumber: string | null;
  taxRate: number;
  summary: {
    outputTaxDue: number;
    inputTaxClaimed: number;
    netGstPayable: number;
    totalStandardRatedSupplies: number;
    totalZeroRatedSupplies: number;
    totalExemptedSupplies: number;
    totalSupplies: number;
    totalTaxablePurchases: number;
    majorExporterScheme: number;
    revenue: number;
  };
  details: Detail[];
};

const fmt = (n: number) =>
  n === 0 ? "0.00" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Default to current month
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const monthEnd = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
};

const CATEGORY_LABEL: Record<Category, string> = {
  OUTPUT_STANDARD: "Output Tax — Standard",
  OUTPUT_ZERO: "Output Tax — Zero rated",
  OUTPUT_EXEMPT: "Output Tax — Exempted",
  INPUT_STANDARD: "Input Tax — Standard",
  INPUT_ZERO: "Input Tax — Zero rated",
  INPUT_EXEMPT: "Input Tax — Exempted",
};

const CATEGORY_OPTIONS: Array<{ key: "" | Category; label: string }> = [
  { key: "", label: "All categories" },
  { key: "OUTPUT_STANDARD", label: "1 — Output Tax (Standard)" },
  { key: "OUTPUT_ZERO", label: "2 — Output Tax 0%" },
  { key: "OUTPUT_EXEMPT", label: "3 — Output Tax Exempted" },
  { key: "INPUT_STANDARD", label: "4 — Input Tax (Standard)" },
  { key: "INPUT_ZERO", label: "5 — Input Tax 0%" },
  { key: "INPUT_EXEMPT", label: "6 — Input Tax Exempted" },
];

export default function GstPage() {
  const { request } = useAccountingApi();
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState({ from: monthStart(), to: monthEnd() });
  const [category, setCategory] = useState<"" | Category>("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (period.from) params.set("startDate", period.from);
      if (period.to) params.set("endDate", period.to);
      if (category) params.set("category", category);
      const res = await request<Report>(`/journal/reports/gst?${params.toString()}`);
      setData(res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load GST report");
    } finally {
      setLoading(false);
    }
  }, [period, category, request]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.details || [];
    return (data?.details || []).filter(
      (d) =>
        d.journalNumber.toLowerCase().includes(q) ||
        d.remarks.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q),
    );
  }, [data, search]);

  const totals = useMemo(() => {
    return visible.reduce(
      (acc, r) => ({
        preTax: acc.preTax + r.preTaxAmount,
        tax: acc.tax + r.taxAmount,
      }),
      { preTax: 0, tax: 0 },
    );
  }, [visible]);

  const summary = data?.summary;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Page title */}
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Goods & Services Tax
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Output / input tax derived from posted journal entries on the GST control account.
        </Typography>
      </Box>

      {/* KPI cards */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" },
          gap: 2,
        }}
      >
        <KpiCard
          title="Output Tax Due"
          icon={<TrendingUpIcon />}
          accent="success"
          value={summary?.outputTaxDue ?? 0}
          sub={`from ${fmt(summary?.totalSupplies ?? 0)} in supplies`}
        />
        <KpiCard
          title="Input Tax Claimed"
          icon={<TrendingDownIcon />}
          accent="info"
          value={summary?.inputTaxClaimed ?? 0}
          sub={`from ${fmt(summary?.totalTaxablePurchases ?? 0)} in purchases`}
        />
        <KpiCard
          title="Net GST Payable"
          icon={<AccountBalanceIcon />}
          accent={summary && summary.netGstPayable >= 0 ? "warning" : "success"}
          value={summary?.netGstPayable ?? 0}
          sub={summary && summary.netGstPayable >= 0 ? "owed to tax authority" : "refundable"}
          emphasize
        />
        <KpiCard
          title="Total Supplies"
          icon={<ReceiptLongIcon />}
          accent="info"
          value={summary?.totalSupplies ?? 0}
          sub={`${visible.length} taxable transaction${visible.length === 1 ? "" : "s"}`}
        />
      </Box>

      {/* Toolbar */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            type="date"
            label="From Date"
            InputLabelProps={{ shrink: true }}
            value={period.from}
            onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
          />
          <TextField
            size="small"
            type="date"
            label="To Date"
            InputLabelProps={{ shrink: true }}
            value={period.to}
            onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
          />
          <TextField
            select
            size="small"
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as any)}
            sx={{ minWidth: 240 }}
          >
            {CATEGORY_OPTIONS.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Locate"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<PrintIcon />} variant="outlined" size="small" onClick={() => window.print()}>
            Print
          </Button>
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
            Refresh
          </Button>
        </Stack>
      </Paper>

      {/* GST F5 summary form (collapsible) — placed above the details table */}
      <Accordion variant="outlined" defaultExpanded={false} sx={{ "&:before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" gap={1.5} alignItems="center">
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              GST Return Summary
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              F5-style breakdown for the period
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "auto 1fr auto 1fr" },
              gap: 1.5,
              alignItems: "baseline",
              maxWidth: 760,
            }}
          >
            <FormRow label="GST Registration No." value={data?.taxRegistrationNumber || "—"} />
            <FormRow
              label="Period"
              value={
                period.from && period.to
                  ? `${new Date(period.from).toLocaleDateString()} → ${new Date(period.to).toLocaleDateString()}`
                  : "—"
              }
            />
            <FormRow label="Std-Rated Supplies" value={fmt(summary?.totalStandardRatedSupplies ?? 0)} mono />
            <FormRow label="Zero-Rated Supplies" value={fmt(summary?.totalZeroRatedSupplies ?? 0)} mono />
            <FormRow label="Exempted Supplies" value={fmt(summary?.totalExemptedSupplies ?? 0)} mono />
            <FormRow label="Total Supplies" value={fmt(summary?.totalSupplies ?? 0)} mono bold />
            <FormRow label="Taxable Purchases" value={fmt(summary?.totalTaxablePurchases ?? 0)} mono />
            <FormRow label="Output Tax Due" value={fmt(summary?.outputTaxDue ?? 0)} mono />
            <FormRow label="Input Tax Claimed" value={fmt(summary?.inputTaxClaimed ?? 0)} mono />
            <FormRow label="Nett GST Payable" value={fmt(summary?.netGstPayable ?? 0)} mono bold highlight />
            <FormRow label="Major Exporter Scheme" value={fmt(summary?.majorExporterScheme ?? 0)} mono />
            <FormRow label="Revenue" value={fmt(summary?.revenue ?? 0)} mono />
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Details table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Document</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Remarks</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Pre-Tax</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>%</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Tax</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No taxable transactions in this period.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              visible.map((r) => {
                const isOutput = r.category.startsWith("OUTPUT");
                return (
                  <TableRow key={r.journalEntryId} hover>
                    <TableCell sx={{ fontFamily: "monospace" }}>{r.journalNumber}</TableCell>
                    <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={r.type}
                        color={isOutput ? "success" : "info"}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.remarks}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                      {fmt(r.preTaxAmount)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                      {r.taxRate ? r.taxRate.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {fmt(r.taxAmount)}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {CATEGORY_LABEL[r.category]}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            {!loading && visible.length > 0 && (
              <TableRow sx={{ "& td": { borderTop: 2, borderTopColor: "divider", borderBottom: 0 } }}>
                <TableCell colSpan={4} align="right" sx={{ fontWeight: 700 }}>
                  TOTAL
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {fmt(totals.preTax)}
                </TableCell>
                <TableCell />
                <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {fmt(totals.tax)}
                </TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

    </Box>
  );
}

function KpiCard({
  title,
  icon,
  accent,
  value,
  sub,
  emphasize,
}: {
  title: string;
  icon: React.ReactNode;
  accent: "success" | "warning" | "error" | "info";
  value: number;
  sub?: string;
  emphasize?: boolean;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.25,
        borderRadius: 2,
        ...(emphasize && {
          borderColor: (t) => alpha(t.palette[accent].main, 0.5),
          bgcolor: (t) => alpha(t.palette[accent].main, 0.04),
        }),
        transition: "box-shadow 160ms ease",
        "&:hover": {
          boxShadow: (t) => `0 1px 3px ${alpha(t.palette.text.primary, 0.06)}, 0 4px 12px ${alpha(t.palette.text.primary, 0.04)}`,
        },
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: "text.secondary",
            fontSize: "0.6875rem",
          }}
        >
          {title}
        </Typography>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: (t) => alpha(t.palette[accent].main, 0.1),
            color: (t) => t.palette[accent].main,
            "& svg": { fontSize: "1.125rem" },
          }}
        >
          {icon}
        </Box>
      </Stack>

      <Typography
        sx={{
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: emphasize ? "1.75rem" : "1.5rem",
          lineHeight: 1.1,
          mb: sub ? 0.5 : 0,
          color: emphasize ? (t) => t.palette[accent].main : "text.primary",
        }}
      >
        {fmt(value)}
      </Typography>

      {sub && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

function FormRow({
  label,
  value,
  mono,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          fontWeight: bold ? 700 : 500,
          gridColumn: "span 1",
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontFamily: mono ? "monospace" : undefined,
          fontWeight: bold ? 700 : 500,
          textAlign: mono ? "right" : "left",
          color: highlight ? "warning.main" : "text.primary",
          gridColumn: "span 1",
        }}
      >
        {value}
      </Typography>
    </>
  );
}
