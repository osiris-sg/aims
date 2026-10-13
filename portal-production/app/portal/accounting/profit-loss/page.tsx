"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import LockIcon from "@mui/icons-material/Lock";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import CloseWizardDialog from "../_lib/CloseWizardDialog";
import { PaperSheet, ReportHeader, ReportPrintCss, fmt, formatShortDate } from "../_lib/report-doc";
import { ReportPrintExportButton, type ReportExportTable } from "../_lib/report-export";

type Section = {
  title: string;
  rows: Array<{ code: string; name: string; values: number[] }>;
  subtotal: { label: string; values: number[] };
};

type PnlReport = {
  cutOffDate: string;
  closingStock: number;
  openingStock: number;
  columns: Array<{ key: string; label: string }>;
  sales: Section;
  cogs: Section;
  grossProfit: { label: string; values: number[] };
  otherIncome: Section;
  expenses: Section;
  tax: Section;
  operationalNet: { label: string; values: number[] };
};

type BsSection = { title: string; rows: Array<{ code: string; name: string; balance: number }>; total: number };
type BsReport = {
  asOfDate: string;
  closingStock: number;
  netProfitInPeriod: number;
  assets: { sections: BsSection[]; total: number };
  liabilities: { sections: BsSection[]; total: number };
  equity: BsSection;
  totals: { totalAssets: number; totalLiabilitiesAndEquity: number; balanced: boolean };
};

const today = () => new Date().toISOString().slice(0, 10);

type Mode = "STANDARD" | "MONTH_END" | "YEAR_END";

export default function ProfitLossPage() {
  const { request } = useAccountingApi();
  const { organization } = useOrganization();
  const [tab, setTab] = useState<"PL" | "BS">("PL");
  const [cutOffDate, setCutOffDate] = useState(today);
  const [closingStock, setClosingStock] = useState("0");
  // Tracks whether the user has manually edited the closing-stock field. If
  // they have, we don't overwrite it on auto-refetch — they've taken control.
  const [closingStockTouched, setClosingStockTouched] = useState(false);
  const [autoClosingStock, setAutoClosingStock] = useState<{
    total: number;
    itemsWithMissingCost: number;
    itemCount: number;
  } | null>(null);
  const [mode, setMode] = useState<Mode>("STANDARD");
  const [closeWizardOpen, setCloseWizardOpen] = useState(false);
  const [closeWizardType, setCloseWizardType] = useState<"MONTH_END" | "YEAR_END">("MONTH_END");
  const [pl, setPl] = useState<PnlReport | null>(null);
  const [bs, setBs] = useState<BsReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cs = parseFloat(closingStock) || 0;
      const params = new URLSearchParams();
      params.set("cutOffDate", cutOffDate);
      params.set("closingStock", String(cs));

      const bsParams = new URLSearchParams();
      bsParams.set("asOfDate", cutOffDate);
      bsParams.set("closingStock", String(cs));

      const [plRes, bsRes] = await Promise.all([
        request<PnlReport>(`/journal/reports/profit-loss?${params.toString()}`),
        request<BsReport>(`/journal/reports/balance-sheet?${bsParams.toString()}`),
      ]);
      setPl(plRes);
      setBs(bsRes);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, cutOffDate, closingStock]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-fetch closing-stock valuation when the cut-off date changes. Pre-fills
  // the input field unless the user has manually overridden the value.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await request<{
          total: number;
          itemCount: number;
          itemsWithMissingCost: number;
        }>(`/accounting/closing-stock?asOfDate=${cutOffDate}`);
        if (cancelled) return;
        setAutoClosingStock(res);
        if (!closingStockTouched) {
          setClosingStock(String(res.total));
        }
      } catch {
        // Silent — closing stock pre-fill is a nicety, not required.
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally exclude closingStockTouched from deps — we only want
    // this to refire when the date changes, not when the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutOffDate, request]);

  // Standard export model (CLAUDE.md report standard) for the ACTIVE tab —
  // PDF / .xlsx / CSV mirror what the paper document shows.
  const exportModel = () => {
    const orgName = organization?.name || "";
    if (tab === "PL" && pl) {
      const rows: string[][] = [];
      const bold: number[] = [];
      const section = (s: Section, hideHeader?: boolean) => {
        if (!hideHeader) { bold.push(rows.length); rows.push([s.title.toUpperCase(), "", "", ""]); }
        for (const r of s.rows) rows.push([`  ${r.name}`, ...r.values.map(fmt)]);
        bold.push(rows.length);
        rows.push([s.subtotal.label, ...s.subtotal.values.map(fmt)]);
      };
      section(pl.sales);
      section(pl.cogs, true);
      bold.push(rows.length);
      rows.push([pl.grossProfit.label, ...pl.grossProfit.values.map(fmt)]);
      section(pl.otherIncome);
      section(pl.expenses);
      section(pl.tax);
      bold.push(rows.length);
      rows.push([pl.operationalNet.label, ...pl.operationalNet.values.map(fmt)]);
      const table: ReportExportTable = { headers: ["Description", ...pl.columns.map((c) => c.label)], rows, boldRows: bold };
      const from = new Date(new Date(pl.cutOffDate).getFullYear(), 0, 1);
      return {
        title: "Profit and Loss",
        orgName,
        metaLines: [`Period From : ${formatShortDate(from)}`, `Period To : ${formatShortDate(pl.cutOffDate)}`],
        tables: [table],
      };
    }
    if (tab === "BS" && bs) {
      const rows: string[][] = [];
      const bold: number[] = [];
      const block = (title: string, sections: BsSection[], total: number, totalLabel: string) => {
        bold.push(rows.length);
        rows.push([title, ""]);
        for (const s of sections) {
          if (s.rows.length === 0 && s.total === 0) continue;
          rows.push([`  ${s.title.toUpperCase()}`, ""]);
          for (const r of s.rows) rows.push([`    ${(r.code.startsWith("__") ? "" : `${r.code}  `) + r.name}`, fmt(r.balance)]);
          bold.push(rows.length);
          rows.push([`  TOTAL ${s.title.toUpperCase()}`, fmt(s.total)]);
        }
        bold.push(rows.length);
        rows.push([totalLabel, fmt(total)]);
      };
      block("ASSETS", bs.assets.sections, bs.assets.total, "TOTAL ASSETS");
      block("LIABILITIES", bs.liabilities.sections, bs.liabilities.total, "TOTAL LIABILITIES");
      block("EQUITY", [bs.equity], bs.equity.total, "TOTAL EQUITY");
      bold.push(rows.length);
      rows.push(["TOTAL LIABILITIES AND EQUITY", fmt(bs.totals.totalLiabilitiesAndEquity)]);
      return {
        title: "Balance Sheet",
        orgName,
        metaLines: [`As at : ${formatShortDate(bs.asOfDate)}`],
        tables: [{ headers: ["Description", "Balance"], rows, boldRows: bold }],
      };
    }
    return null;
  };

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Page title — hidden on print */}
      <Box className="no-print">
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Profit & Loss / Balance Sheet
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Computed from posted journal entries up to the cut-off date.
        </Typography>
      </Box>

      {/* Filter card — hidden on print */}
      <Paper variant="outlined" sx={{ p: 2 }} className="no-print">
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "auto auto 1fr auto" },
            gap: 2,
            alignItems: "center",
          }}
        >
          <TextField
            size="small"
            type="date"
            label="Cut-Off Date"
            InputLabelProps={{ shrink: true }}
            value={cutOffDate}
            onChange={(e) => setCutOffDate(e.target.value)}
          />
          <Stack direction="column" gap={0.25}>
            <TextField
              size="small"
              type="number"
              label="Closing Stock"
              value={closingStock}
              onChange={(e) => {
                setClosingStock(e.target.value);
                setClosingStockTouched(true);
              }}
              inputProps={{ step: "0.01" }}
              sx={{ width: 180 }}
              helperText={
                autoClosingStock
                  ? closingStockTouched && parseFloat(closingStock) !== autoClosingStock.total
                    ? `Overriding auto (${autoClosingStock.total.toFixed(2)})`
                    : `Auto-derived from ${autoClosingStock.itemCount} item${autoClosingStock.itemCount === 1 ? "" : "s"}${autoClosingStock.itemsWithMissingCost > 0 ? ` · ${autoClosingStock.itemsWithMissingCost} missing cost` : ""}`
                  : " "
              }
              FormHelperTextProps={{
                sx: { fontSize: "0.65rem", mx: 0, mt: 0.25 },
              }}
            />
            {closingStockTouched && autoClosingStock && parseFloat(closingStock) !== autoClosingStock.total && (
              <Box
                component="span"
                onClick={() => {
                  setClosingStock(String(autoClosingStock.total));
                  setClosingStockTouched(false);
                }}
                sx={{
                  fontSize: "0.65rem",
                  color: "primary.main",
                  cursor: "pointer",
                  textDecoration: "underline",
                  alignSelf: "flex-start",
                }}
              >
                Reset to auto
              </Box>
            )}
          </Stack>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button
              size="small"
              variant="outlined"
              startIcon={<LockIcon />}
              onClick={() => {
                setCloseWizardType("MONTH_END");
                setCloseWizardOpen(true);
              }}
            >
              Month-End Close
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="primary"
              startIcon={<LockIcon />}
              onClick={() => {
                setCloseWizardType("YEAR_END");
                setCloseWizardOpen(true);
              }}
            >
              Year-End Close
            </Button>
          </Stack>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
              Refresh
            </Button>
            <ReportPrintExportButton getModel={exportModel} onPrint={() => window.print()} />
          </Stack>
        </Box>
      </Paper>

      {/* Tabs — hidden on print */}
      <Paper variant="outlined" sx={{ borderRadius: 2 }} className="no-print">
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ px: 1, "& .MuiTab-root": { textTransform: "none", fontWeight: 600 } }}
        >
          <Tab value="PL" label="Profit & Loss" />
          <Tab value="BS" label="Balance Sheet" />
        </Tabs>
      </Paper>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {/* Document-style preview area — only this prints */}
      {!loading && tab === "PL" && pl && <ProfitLossDocument pl={pl} organization={organization} />}
      {!loading && tab === "BS" && bs && <BalanceSheetDocument bs={bs} organization={organization} />}

      <ReportPrintCss />

      <CloseWizardDialog
        open={closeWizardOpen}
        onClose={() => setCloseWizardOpen(false)}
        defaultCutOffDate={cutOffDate}
        defaultType={closeWizardType}
        onCompleted={() => load()}
      />
    </Box>
  );
}

// A4 pagination (guru 2026-10-11, rule for EVERY paper report): rows chunk
// into pages, each page repeats the full header with its own Page No, and the
// final summary row closes the last page.
const DOC_LINES_PER_PAGE = 34;

function chunkLines(lines: React.ReactNode[], perPage = DOC_LINES_PER_PAGE): React.ReactNode[][] {
  const pages: React.ReactNode[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

function ProfitLossDocument({ pl, organization }: { pl: PnlReport; organization: any }) {
  // Period boundaries — the legacy shows Period From / Period To at the top.
  // We treat From as start-of-year and To as the cut-off (matches the YTD column).
  const cut = new Date(pl.cutOffDate);
  const periodFrom = new Date(cut.getFullYear(), 0, 1);

  // Flatten the statement into uniform lines, then paginate. The legacy shows
  // section headers and subtotals even at 0.
  const lines: React.ReactNode[] = [];
  let k = 0;
  const pushSection = (section: Section, hideHeader?: boolean) => {
    if (!hideHeader) lines.push(<ReportRow key={k++} left={section.title.toUpperCase()} values={[]} bold sectionLabel />);
    for (const r of section.rows) lines.push(<ReportRow key={k++} left={r.name} values={r.values.map(fmt)} indent />);
    lines.push(<ReportSubtotalRow key={k++} label={section.subtotal.label} values={section.subtotal.values.map(fmt)} topRule />);
  };
  pushSection(pl.sales);
  pushSection(pl.cogs, true);
  lines.push(<ReportSubtotalRow key={k++} label={pl.grossProfit.label} values={pl.grossProfit.values.map(fmt)} topRule />);
  pushSection(pl.otherIncome);
  pushSection(pl.expenses);
  pushSection(pl.tax);
  lines.push(
    <Box key={k++} sx={{ mt: 1 }}>
      <ReportSubtotalRow label={pl.operationalNet.label} values={pl.operationalNet.values.map(fmt)} topRule bottomRule emphasize />
    </Box>,
  );
  const pages = chunkLines(lines);

  return (
    <>
      {pages.map((pageLines, pageIdx) => (
        <PaperSheet key={pageIdx} breakAfter={pageIdx < pages.length - 1}>
          <ReportHeader organization={organization} date={pl.cutOffDate} title="PROFIT AND LOSS" />

          {/* Period meta line — repeated on every page */}
          <Box sx={{ display: "flex", gap: 4, fontSize: "0.8125rem", mb: 0.5 }}>
            <Box sx={{ flex: 1 }}>
              <Box component="span">Period From :</Box>{" "}
              <Box component="span" sx={{ fontWeight: 600 }}>
                {formatShortDate(periodFrom)}
              </Box>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Box component="span">Period To :</Box>{" "}
              <Box component="span" sx={{ fontWeight: 600 }}>
                {formatShortDate(pl.cutOffDate)}
              </Box>
            </Box>
            <Box sx={{ textAlign: "right" }}>Page No : {pageIdx + 1}</Box>
          </Box>

          {/* Column headers */}
          <Box sx={{ borderTop: "1px solid #000", borderBottom: "1px solid #000", py: 0.5, mb: 0.5 }}>
            <ReportRow left="Description" values={pl.columns.map((c) => c.label)} bold underlinePerCell={false} />
          </Box>

          {pageLines}
        </PaperSheet>
      ))}
    </>
  );
}

function ReportRow({
  left,
  values,
  bold,
  indent,
  sectionLabel,
}: {
  left: string;
  values: string[];
  bold?: boolean;
  indent?: boolean;
  sectionLabel?: boolean;
  underlinePerCell?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr repeat(3, 110px)",
        columnGap: "8px",
        py: sectionLabel ? 0.5 : 0.25,
        fontSize: "0.8125rem",
        fontWeight: bold ? 700 : 400,
        textTransform: sectionLabel ? "uppercase" : "none",
      }}
    >
      <Box sx={{ pl: indent ? 1.5 : 0 }}>{left}</Box>
      {values.map((v, i) => (
        <Box key={i} sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: bold ? 700 : 400 }}>
          {v}
        </Box>
      ))}
    </Box>
  );
}

function ReportSubtotalRow({
  label,
  values,
  topRule,
  bottomRule,
  emphasize,
}: {
  label: string;
  values: string[];
  topRule?: boolean;
  bottomRule?: boolean;
  emphasize?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr repeat(3, 110px)",
        columnGap: "8px",
        py: 0.5,
        fontSize: emphasize ? "0.875rem" : "0.8125rem",
        fontWeight: 700,
        textTransform: "uppercase",
        ...(topRule && { borderTop: "1px solid #000" }),
        ...(bottomRule && { borderBottom: "2px solid #000" }),
      }}
    >
      <Box>{label}</Box>
      {values.map((v, i) => (
        <Box key={i} sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {v}
        </Box>
      ))}
    </Box>
  );
}

function BalanceSheetDocument({ bs, organization }: { bs: BsReport; organization: any }) {
  // Flatten blocks into uniform lines, then paginate like the P&L.
  const lines: React.ReactNode[] = [];
  let k = 0;
  const pushBlock = (title: string, sections: BsSection[], total: number, totalLabel: string) => {
    lines.push(<BsRow key={k++} left={title} right="" bold sectionLabel />);
    for (const s of sections) {
      if (s.rows.length === 0 && s.total === 0) continue;
      lines.push(<BsRow key={k++} left={s.title} right="" subSection indent />);
      for (const r of s.rows) {
        lines.push(
          <BsRow key={k++} left={(r.code.startsWith("__") ? "" : `${r.code}  `) + r.name} right={fmt(r.balance)} indent={2} />,
        );
      }
      lines.push(
        <Box key={k++} sx={{ mb: 1 }}>
          <BsRow left={`TOTAL ${s.title.toUpperCase()}`} right={fmt(s.total)} bold topRule indent />
        </Box>,
      );
    }
    lines.push(
      <Box key={k++} sx={{ mb: 1.5 }}>
        <BsRow left={totalLabel} right={fmt(total)} bold topRule />
      </Box>,
    );
  };
  pushBlock("ASSETS", bs.assets.sections, bs.assets.total, "TOTAL ASSETS");
  pushBlock("LIABILITIES", bs.liabilities.sections, bs.liabilities.total, "TOTAL LIABILITIES");
  pushBlock("EQUITY", [bs.equity], bs.equity.total, "TOTAL EQUITY");
  lines.push(
    <Box key={k++} sx={{ mt: 1 }}>
      <BsRow left="TOTAL LIABILITIES AND EQUITY" right={fmt(bs.totals.totalLiabilitiesAndEquity)} bold topRule bottomRule />
    </Box>,
  );
  const pages = chunkLines(lines);

  return (
    <>
      {pages.map((pageLines, pageIdx) => (
        <PaperSheet key={pageIdx} breakAfter={pageIdx < pages.length - 1}>
          <ReportHeader organization={organization} date={bs.asOfDate} title="BALANCE SHEET" />

          <Box sx={{ display: "flex", gap: 4, fontSize: "0.8125rem", mb: 0.5 }}>
            <Box sx={{ flex: 1 }}>
              As at:{" "}
              <Box component="span" sx={{ fontWeight: 600 }}>
                {formatShortDate(bs.asOfDate)}
              </Box>
            </Box>
            {pageIdx === 0 && (
              <Chip
                size="small"
                variant="outlined"
                className="no-print"
                label={bs.totals.balanced ? "Balanced ✓" : "OUT OF BALANCE"}
                color={bs.totals.balanced ? "success" : "error"}
                sx={{ fontWeight: 700 }}
              />
            )}
            <Box sx={{ textAlign: "right" }}>Page No : {pageIdx + 1}</Box>
          </Box>

          {/* Header rule */}
          <Box sx={{ borderTop: "1px solid #000", borderBottom: "1px solid #000", py: 0.5, mb: 1 }}>
            <BsRow left="Description" right="Balance" bold />
          </Box>

          {pageLines}
        </PaperSheet>
      ))}
    </>
  );
}

function BsRow({
  left,
  right,
  bold,
  indent,
  topRule,
  bottomRule,
  sectionLabel,
  subSection,
}: {
  left: string;
  right: string;
  bold?: boolean;
  indent?: number | boolean;
  topRule?: boolean;
  bottomRule?: boolean;
  sectionLabel?: boolean;
  subSection?: boolean;
}) {
  const indentLevel = typeof indent === "number" ? indent : indent ? 1 : 0;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 130px",
        columnGap: "8px",
        py: sectionLabel ? 0.5 : 0.25,
        fontSize: sectionLabel ? "0.875rem" : "0.8125rem",
        fontWeight: bold || sectionLabel ? 700 : subSection ? 600 : 400,
        textTransform: sectionLabel || subSection ? "uppercase" : "none",
        ...(topRule && { borderTop: "1px solid #000" }),
        ...(bottomRule && { borderBottom: "2px solid #000" }),
      }}
    >
      <Box sx={{ pl: indentLevel * 1.5 }}>{left}</Box>
      <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{right}</Box>
    </Box>
  );
}
