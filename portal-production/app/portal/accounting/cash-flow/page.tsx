"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PrintIcon from "@mui/icons-material/Print";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

type Movement = { code: string; name: string; movement?: number; cashImpact: number };

type CashFlowReport = {
  startDate: string;
  endDate: string;
  operating: { netIncome: number; adjustments: Movement[]; total: number };
  investing: { movements: Movement[]; total: number };
  financing: { movements: Movement[]; total: number };
  summary: {
    beginningCash: number;
    netChangeInCash: number;
    endingCash: number;
    reconciles: boolean;
    actualEndingCash: number;
    reconciliationDiff: number;
  };
};

const fmt = (n: number) => {
  if (n === 0) return "0.00";
  if (n < 0) return `( ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} )`;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

export default function CashFlowPage() {
  const { request } = useAccountingApi();
  const { organization } = useOrganization();
  const [data, setData] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState({ from: monthStart(), to: today() });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ startDate: period.from, endDate: period.to });
      const res = await request<CashFlowReport>(`/journal/reports/cash-flow?${params.toString()}`);
      setData(res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load cash flow");
    } finally {
      setLoading(false);
    }
  }, [period, request]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box className="no-print">
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Cash Flow Statement
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Indirect method — derived from posted journal entries between two dates.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5 }} className="no-print">
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            type="date"
            label="From"
            InputLabelProps={{ shrink: true }}
            value={period.from}
            onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            InputLabelProps={{ shrink: true }}
            value={period.to}
            onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
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

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {!loading && data && (
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
            <Box sx={{ textAlign: "center", mb: 3 }}>
              <Typography sx={{ fontSize: "1rem", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
                {organization?.name || "Company Name"}
              </Typography>
              <Typography sx={{ fontSize: "0.9375rem", fontWeight: 700, mt: 1.5, letterSpacing: 1 }}>
                CASH FLOW STATEMENT
              </Typography>
              <Typography sx={{ fontSize: "0.8125rem", mt: 0.5 }}>
                {new Date(data.startDate).toLocaleDateString()} → {new Date(data.endDate).toLocaleDateString()}
              </Typography>
            </Box>

            <Section title="CASH FLOWS FROM OPERATING ACTIVITIES">
              <Row label="Net income for the period" value={data.operating.netIncome} indent />
              <SubHeader text="Adjustments — working capital changes" />
              {data.operating.adjustments.length === 0 && (
                <Row label="(none)" value={0} indent muted />
              )}
              {data.operating.adjustments.map((m) => (
                <Row key={m.code} label={`${m.code} ${m.name}`} value={m.cashImpact} indent />
              ))}
              <Subtotal label="Net cash from operating activities" value={data.operating.total} />
            </Section>

            <Section title="CASH FLOWS FROM INVESTING ACTIVITIES">
              {data.investing.movements.length === 0 && (
                <Row label="(no investing activity)" value={0} indent muted />
              )}
              {data.investing.movements.map((m) => (
                <Row key={m.code} label={`${m.code} ${m.name}`} value={m.cashImpact} indent />
              ))}
              <Subtotal label="Net cash from investing activities" value={data.investing.total} />
            </Section>

            <Section title="CASH FLOWS FROM FINANCING ACTIVITIES">
              {data.financing.movements.length === 0 && (
                <Row label="(no financing activity)" value={0} indent muted />
              )}
              {data.financing.movements.map((m) => (
                <Row key={m.code} label={`${m.code} ${m.name}`} value={m.cashImpact} indent />
              ))}
              <Subtotal label="Net cash from financing activities" value={data.financing.total} />
            </Section>

            <Box sx={{ mt: 3, pt: 1, borderTop: "1px solid #000" }}>
              <Row label="Beginning cash & bank" value={data.summary.beginningCash} bold />
              <Row label="Net change in cash" value={data.summary.netChangeInCash} bold />
              <Row label="Ending cash & bank (computed)" value={data.summary.beginningCash + data.summary.netChangeInCash} bold />
              <Box sx={{ borderTop: "2px solid #000", mt: 0.5, pt: 0.5 }}>
                <Row label="Ending cash & bank (actual from GL)" value={data.summary.actualEndingCash} bold emphasize />
              </Box>
              {!data.summary.reconciles && (
                <Box sx={{ mt: 1 }}>
                  <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={`Reconciliation diff: ${fmt(data.summary.reconciliationDiff)}`}
                  />
                </Box>
              )}
              {data.summary.reconciles && (
                <Box sx={{ mt: 1 }}>
                  <Chip size="small" color="success" variant="outlined" label="Reconciles ✓" />
                </Box>
              )}
            </Box>
          </Paper>
        </Box>
      )}

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 0; }
          body { background: white !important; }
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ borderTop: "1px solid #000", borderBottom: "1px solid #000", py: 0.5, mb: 0.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: "0.8125rem", letterSpacing: 0.5 }}>{title}</Typography>
      </Box>
      {children}
    </Box>
  );
}

function SubHeader({ text }: { text: string }) {
  return (
    <Typography
      sx={{
        fontSize: "0.75rem",
        textTransform: "uppercase",
        color: "#444",
        fontWeight: 600,
        pl: 1.5,
        py: 0.5,
      }}
    >
      {text}
    </Typography>
  );
}

function Row({
  label,
  value,
  indent,
  bold,
  muted,
  emphasize,
}: {
  label: string;
  value: number;
  indent?: boolean;
  bold?: boolean;
  muted?: boolean;
  emphasize?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 140px",
        py: 0.25,
        fontSize: emphasize ? "0.875rem" : "0.8125rem",
        fontWeight: bold ? 700 : 400,
        color: muted ? "#888" : "#000",
      }}
    >
      <Box sx={{ pl: indent ? 1.5 : 0 }}>{label}</Box>
      <Box sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: bold ? 700 : 400 }}>
        {fmt(value)}
      </Box>
    </Box>
  );
}

function Subtotal({ label, value }: { label: string; value: number }) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 140px",
        py: 0.5,
        borderTop: "1px solid #000",
        fontWeight: 700,
        fontSize: "0.8125rem",
        textTransform: "uppercase",
      }}
    >
      <Box>{label}</Box>
      <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(value)}</Box>
    </Box>
  );
}
