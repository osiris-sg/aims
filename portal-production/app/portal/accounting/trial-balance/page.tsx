"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { PaperSheet, ReportHeader, ReportPrintCss, fmt, formatShortDate } from "../_lib/report-doc";
import { ReportPrintExportButton } from "../_lib/report-export";

type Row = {
  accountId: string;
  code: string;
  name: string;
  category: "PNL" | "BALANCE_SHEET";
  accountType?: string;
  normalBalance: "DEBIT" | "CREDIT";
  debit: number;
  credit: number;
  balance: number;
};

type TrialBalance = {
  asOfDate: string | null;
  rows: Row[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
};

// Document convention: each account shows its NET balance in the Debit or
// Credit column (debit − credit of all posted lines; P&L accounts are already
// FY-scoped by the backend, prior years rolled into Retained Earnings).
type NetRow = Row & { netDebit: number; netCredit: number };

const toNet = (r: Row): NetRow => {
  const net = Math.round((r.debit - r.credit) * 100) / 100;
  return { ...r, netDebit: net > 0 ? net : 0, netCredit: net < 0 ? -net : 0 };
};

const today = () => new Date().toISOString().slice(0, 10);

export default function TrialBalancePage() {
  const { request } = useAccountingApi();
  const { organization } = useOrganization();
  const [data, setData] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState<string>(today);
  const [filter, setFilter] = useState("");
  const [showZero, setShowZero] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = asOfDate ? `?asOfDate=${asOfDate}` : "";
      const res = await request<TrialBalance>(`/journal/reports/trial-balance${q}`);
      setData(res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load trial balance");
    } finally {
      setLoading(false);
    }
  }, [asOfDate, request]);

  useEffect(() => {
    load();
  }, [load]);

  const netRows = useMemo(() => (data?.rows || []).map(toNet), [data]);

  // Totals always cover the FULL report, whatever the on-screen filter shows.
  const totals = useMemo(() => {
    const d = netRows.reduce((s, r) => s + r.netDebit, 0);
    const c = netRows.reduce((s, r) => s + r.netCredit, 0);
    return {
      debit: Math.round(d * 100) / 100,
      credit: Math.round(c * 100) / 100,
      balanced: Math.abs(d - c) < 0.02,
    };
  }, [netRows]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let rows = netRows;
    if (!showZero) rows = rows.filter((r) => r.netDebit !== 0 || r.netCredit !== 0);
    if (q) rows = rows.filter((r) => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    return rows;
  }, [netRows, filter, showZero]);

  // Standard export model (CLAUDE.md report standard): PDF / .xlsx / CSV all
  // derive from the same rows the paper document shows.
  const exportModel = () => {
    if (!data) return null;
    const rows = visible.map((r) => [r.code, r.name, r.netDebit ? fmt(r.netDebit) : "", r.netCredit ? fmt(r.netCredit) : ""]);
    rows.push(["TOTAL", filter.trim() ? "(ALL ACCOUNTS)" : "", fmt(totals.debit), fmt(totals.credit)]);
    return {
      title: "Trial Balance",
      orgName: organization?.name || "",
      metaLines: [`Cut-Off-Date : ${formatShortDate(asOfDate)}`],
      tables: [{ headers: ["Account", "Description", "Debit", "Credit"], rows, boldRows: [rows.length - 1] }],
    };
  };

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Page title — hidden on print */}
      <Box className="no-print">
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Trial Balance
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Net balance per account from all posted journal entries up to the chosen date.
        </Typography>
      </Box>

      {/* Filter card — hidden on print */}
      <Paper variant="outlined" sx={{ p: 1.5 }} className="no-print">
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            type="date"
            label="Cut-Off Date"
            InputLabelProps={{ shrink: true }}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
          <TextField
            size="small"
            label="Locate"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            sx={{ minWidth: 220 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />}
            label={<Typography variant="body2">Show zero balances</Typography>}
          />
          <Box sx={{ flex: 1 }} />
          {data && (
            <Chip
              size="small"
              variant="outlined"
              label={totals.balanced ? "Balanced ✓" : "OUT OF BALANCE ✗"}
              color={totals.balanced ? "success" : "error"}
              sx={{ fontWeight: 700 }}
            />
          )}
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
            Refresh
          </Button>
          <ReportPrintExportButton getModel={exportModel} onPrint={() => window.print()} />
        </Stack>
      </Paper>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* Document-style preview — only this prints */}
      {!loading && data && (
        <TrialBalanceDocument
          organization={organization}
          asOfDate={data.asOfDate || asOfDate}
          rows={visible}
          totals={totals}
          filtered={Boolean(filter.trim())}
        />
      )}

      <ReportPrintCss />
    </Box>
  );
}

// A4 pagination (guru 2026-10-11, rule for EVERY paper report): each page
// repeats the full header with its own Page No; the grand TOTAL and the
// local-currency note close the last page.
const TB_LINES_PER_PAGE = 38;

function TrialBalanceDocument({
  organization,
  asOfDate,
  rows,
  totals,
  filtered,
}: {
  organization: any;
  asOfDate: string;
  rows: NetRow[];
  totals: { debit: number; credit: number; balanced: boolean };
  filtered: boolean;
}) {
  const pages = useMemo(() => {
    const out: NetRow[][] = [];
    for (let i = 0; i < rows.length; i += TB_LINES_PER_PAGE) out.push(rows.slice(i, i + TB_LINES_PER_PAGE));
    return out.length ? out : [[]];
  }, [rows]);

  return (
    <>
      {pages.map((pageRows, pageIdx) => {
        const last = pageIdx === pages.length - 1;
        return (
          <PaperSheet key={pageIdx} breakAfter={!last}>
            <ReportHeader organization={organization} date={asOfDate} title="TRIAL BALANCE" />

            {/* Meta line — repeated on every page (legacy wording) */}
            <Box sx={{ display: "flex", gap: 4, fontSize: "0.8125rem", mb: 0.5 }}>
              <Box sx={{ flex: 1 }}>
                Cut-Off-Date :{" "}
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {formatShortDate(asOfDate)}
                </Box>
              </Box>
              {pageIdx === 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  className="no-print"
                  label={totals.balanced ? "Balanced ✓" : "OUT OF BALANCE"}
                  color={totals.balanced ? "success" : "error"}
                  sx={{ fontWeight: 700 }}
                />
              )}
              <Box sx={{ textAlign: "right" }}>Page No : {pageIdx + 1}</Box>
            </Box>

            {/* Column header rule */}
            <Box sx={{ borderTop: "1px solid #000", borderBottom: "1px solid #000", py: 0.5, mb: 0.5 }}>
              <TbRow code="Account" name="Description" debit="Debit" credit="Credit" bold />
            </Box>

            {pageIdx === 0 && rows.length === 0 && (
              <Box sx={{ py: 3, textAlign: "center", color: "#555" }}>No posted activity for this date.</Box>
            )}

            {pageRows.map((r) => (
              <TbRow
                key={r.accountId}
                code={r.code}
                name={r.name}
                debit={r.netDebit ? fmt(r.netDebit) : ""}
                credit={r.netCredit ? fmt(r.netCredit) : ""}
              />
            ))}

            {last && (
              <>
                <Box sx={{ height: 8 }} />
                {/* Legacy print: TOTAL sits in the Account column, double rules */}
                <TbRow
                  code="TOTAL"
                  name={filtered ? "(ALL ACCOUNTS)" : ""}
                  debit={fmt(totals.debit)}
                  credit={fmt(totals.credit)}
                  bold
                  topRule
                  bottomRule
                />
              </>
            )}
          </PaperSheet>
        );
      })}
    </>
  );
}

function TbRow({
  code,
  name,
  debit,
  credit,
  bold,
  topRule,
  bottomRule,
}: {
  code: string;
  name: string;
  debit: string;
  credit: string;
  bold?: boolean;
  topRule?: boolean;
  bottomRule?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "90px 1fr 120px 120px",
        columnGap: "8px",
        py: 0.25,
        fontSize: "0.8125rem",
        fontWeight: bold ? 700 : 400,
        ...(topRule && { borderTop: "1px solid #000" }),
        ...(bottomRule && { borderBottom: "3px double #000" }),
      }}
    >
      <Box sx={{ fontVariantNumeric: "tabular-nums" }}>{code}</Box>
      <Box>{name}</Box>
      <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{debit}</Box>
      <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{credit}</Box>
    </Box>
  );
}
