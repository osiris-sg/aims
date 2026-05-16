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
import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

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

const fmt = (n: number) => {
  if (n === 0) return "0.00";
  if (n < 0) return `( ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} )`;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const today = () => new Date().toISOString().slice(0, 10);
const formatHumanDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const formatShortDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

type Mode = "STANDARD" | "MONTH_END" | "YEAR_END";

export default function ProfitLossPage() {
  const { request } = useAccountingApi();
  const { organization } = useOrganization();
  const [tab, setTab] = useState<"PL" | "BS">("PL");
  const [cutOffDate, setCutOffDate] = useState(today);
  const [closingStock, setClosingStock] = useState("0");
  const [mode, setMode] = useState<Mode>("STANDARD");
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

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
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
          <TextField
            size="small"
            type="number"
            label="Closing Stock"
            value={closingStock}
            onChange={(e) => setClosingStock(e.target.value)}
            inputProps={{ step: "0.01" }}
            sx={{ width: 180 }}
          />
          <FormControl>
            <RadioGroup row value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <FormControlLabel value="STANDARD" control={<Radio size="small" />} label="Standard" />
              <FormControlLabel
                value="MONTH_END"
                control={<Radio size="small" />}
                label="Month-End Closing"
                disabled
                sx={{ "& .MuiFormControlLabel-label": { color: "text.disabled" } }}
              />
              <FormControlLabel
                value="YEAR_END"
                control={<Radio size="small" />}
                label="Year-End Closing"
                disabled
                sx={{ "& .MuiFormControlLabel-label": { color: "text.disabled" } }}
              />
            </RadioGroup>
            {mode !== "STANDARD" && (
              <Typography variant="caption" sx={{ color: "warning.main", mt: 0.5 }}>
                Closing modes (post adjustment entries) are not yet implemented — Standard view only.
              </Typography>
            )}
          </FormControl>
          <Stack direction="row" gap={1}>
            <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
              Refresh
            </Button>
            <Button startIcon={<PrintIcon />} variant="outlined" size="small" onClick={() => window.print()}>
              Print
            </Button>
            <Button
              startIcon={<DownloadIcon />}
              variant="outlined"
              size="small"
              onClick={() => toast.info("CSV export coming soon")}
            >
              Export
            </Button>
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
      {!loading && tab === "PL" && pl && (
        <PaperSheet>
          <ProfitLossDocument pl={pl} organization={organization} />
        </PaperSheet>
      )}
      {!loading && tab === "BS" && bs && (
        <PaperSheet>
          <BalanceSheetDocument bs={bs} organization={organization} />
        </PaperSheet>
      )}

      {/* Print CSS — hide app chrome, show only the paper */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          @page {
            size: A4;
            margin: 0;
          }
          body {
            background: white !important;
          }
          [data-print-paper] {
            box-shadow: none !important;
            margin: 0 !important;
            padding: 20mm !important;
          }
        }
      `}</style>
    </Box>
  );
}

// White A4-sized paper that frames the printable report content
function PaperSheet({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
      <Paper
        data-print-paper
        elevation={2}
        sx={{
          width: "210mm",
          minHeight: "297mm",
          p: "20mm",
          backgroundColor: "white",
          color: "#000",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.8125rem",
          lineHeight: 1.5,
        }}
      >
        {children}
      </Paper>
    </Box>
  );
}

function ReportHeader({
  organization,
  date,
  title,
}: {
  organization: any;
  date: string;
  title: string;
}) {
  return (
    <Box sx={{ textAlign: "center", mb: 3 }}>
      <Typography sx={{ fontSize: "1rem", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
        {organization?.name || "Company Name"}
      </Typography>
      <Typography sx={{ fontSize: "0.8125rem", mt: 0.25 }}>{formatHumanDate(date)}</Typography>
      <Typography sx={{ fontSize: "0.9375rem", fontWeight: 700, mt: 1.5, letterSpacing: 1 }}>{title}</Typography>
    </Box>
  );
}

function ProfitLossDocument({ pl, organization }: { pl: PnlReport; organization: any }) {
  // Period boundaries — the legacy shows Period From / Period To at the top.
  // We treat From as start-of-year and To as the cut-off (matches the YTD column).
  const cut = new Date(pl.cutOffDate);
  const periodFrom = new Date(cut.getFullYear(), 0, 1);

  return (
    <Box>
      <ReportHeader organization={organization} date={pl.cutOffDate} title="PROFIT AND LOSS" />

      {/* Period meta line */}
      <Box
        sx={{
          display: "flex",
          gap: 4,
          fontSize: "0.8125rem",
          mb: 0.5,
        }}
      >
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
        <Box sx={{ textAlign: "right" }}>Page No : 1</Box>
      </Box>

      {/* Column headers */}
      <Box sx={{ borderTop: "1px solid #000", borderBottom: "1px solid #000", py: 0.5, mb: 0.5 }}>
        <ReportRow
          left="Description"
          values={pl.columns.map((c) => c.label)}
          bold
          underlinePerCell={false}
        />
      </Box>

      <PnlSection section={pl.sales} />
      <Box sx={{ height: 6 }} />
      <PnlSection section={pl.cogs} hideHeader />
      <Box sx={{ height: 6 }} />

      <ReportSubtotalRow
        label={pl.grossProfit.label}
        values={pl.grossProfit.values.map(fmt)}
        topRule
      />

      <Box sx={{ height: 6 }} />
      <PnlSection section={pl.otherIncome} />
      <Box sx={{ height: 6 }} />
      <PnlSection section={pl.expenses} />

      <Box sx={{ height: 6 }} />
      <PnlSection section={pl.tax} />

      <Box sx={{ height: 8 }} />
      <ReportSubtotalRow
        label={pl.operationalNet.label}
        values={pl.operationalNet.values.map(fmt)}
        topRule
        bottomRule
        emphasize
      />
    </Box>
  );
}

function PnlSection({ section, hideHeader }: { section: Section; hideHeader?: boolean }) {
  // Always render — the legacy shows section headers and subtotals even at 0.
  return (
    <Box>
      {!hideHeader && (
        <ReportRow left={section.title.toUpperCase()} values={[]} bold sectionLabel />
      )}
      {section.rows.map((r) => (
        <ReportRow key={r.code} left={r.name} values={r.values.map(fmt)} indent />
      ))}
      <ReportSubtotalRow
        label={section.subtotal.label}
        values={section.subtotal.values.map(fmt)}
        topRule
      />
    </Box>
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
        <Box key={i} sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: bold ? 700 : 400 }}>
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
        <Box key={i} sx={{ textAlign: "right", fontFamily: "monospace" }}>
          {v}
        </Box>
      ))}
    </Box>
  );
}

function BalanceSheetDocument({ bs, organization }: { bs: BsReport; organization: any }) {
  return (
    <Box>
      <ReportHeader organization={organization} date={bs.asOfDate} title="BALANCE SHEET" />

      <Box
        sx={{
          display: "flex",
          gap: 4,
          fontSize: "0.8125rem",
          mb: 0.5,
        }}
      >
        <Box sx={{ flex: 1 }}>
          As at:{" "}
          <Box component="span" sx={{ fontWeight: 600 }}>
            {formatShortDate(bs.asOfDate)}
          </Box>
        </Box>
        <Chip
          size="small"
          variant="outlined"
          label={bs.totals.balanced ? "Balanced ✓" : "OUT OF BALANCE"}
          color={bs.totals.balanced ? "success" : "error"}
          sx={{ fontWeight: 700 }}
        />
        <Box sx={{ textAlign: "right" }}>Page No : 1</Box>
      </Box>

      {/* Header rule */}
      <Box sx={{ borderTop: "1px solid #000", borderBottom: "1px solid #000", py: 0.5, mb: 1 }}>
        <BsRow left="Description" right="Balance" bold />
      </Box>

      {/* Assets */}
      <BsBlock title="ASSETS" sections={bs.assets.sections} total={bs.assets.total} totalLabel="TOTAL ASSETS" />

      <Box sx={{ height: 12 }} />

      {/* Liabilities */}
      <BsBlock
        title="LIABILITIES"
        sections={bs.liabilities.sections}
        total={bs.liabilities.total}
        totalLabel="TOTAL LIABILITIES"
      />

      <Box sx={{ height: 12 }} />

      {/* Equity */}
      <BsBlock title="EQUITY" sections={[bs.equity]} total={bs.equity.total} totalLabel="TOTAL EQUITY" />

      <Box sx={{ height: 12 }} />
      <BsRow
        left="TOTAL LIABILITIES AND EQUITY"
        right={fmt(bs.totals.totalLiabilitiesAndEquity)}
        bold
        topRule
        bottomRule
      />
    </Box>
  );
}

function BsBlock({
  title,
  sections,
  total,
  totalLabel,
}: {
  title: string;
  sections: BsSection[];
  total: number;
  totalLabel: string;
}) {
  return (
    <Box>
      <BsRow left={title} right="" bold sectionLabel />
      {sections.map((s) =>
        s.rows.length === 0 && s.total === 0 ? null : (
          <Box key={s.title} sx={{ mb: 1 }}>
            <BsRow left={s.title} right="" subSection indent />
            {s.rows.map((r) => (
              <BsRow
                key={r.code}
                left={(r.code.startsWith("__") ? "" : `${r.code}  `) + r.name}
                right={fmt(r.balance)}
                indent={2}
              />
            ))}
            <BsRow left={`TOTAL ${s.title.toUpperCase()}`} right={fmt(s.total)} bold topRule indent />
          </Box>
        ),
      )}
      <BsRow left={totalLabel} right={fmt(total)} bold topRule />
    </Box>
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
      <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>{right}</Box>
    </Box>
  );
}
