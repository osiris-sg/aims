"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
  alpha,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import ArrowOutwardIcon from "@mui/icons-material/ArrowOutward";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import PaymentsIcon from "@mui/icons-material/Payments";
import PercentIcon from "@mui/icons-material/Percent";
import ReceiptIcon from "@mui/icons-material/Receipt";
import AddIcon from "@mui/icons-material/Add";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useAccountingApi } from "./_lib/api";
import JournalEntryDialog from "./_lib/JournalEntryDialog";
import AskBar from "./_lib/AskBar";
import CloseWizardDialog from "./_lib/CloseWizardDialog";
import LockIcon from "@mui/icons-material/Lock";

type Hub = {
  asOf: string;
  kpis: {
    revenueMtd: number;
    revenueYtd: number;
    revenueMtdChange: number | null;
    netProfitMtd: number;
    netProfitYtd: number;
    netProfitMtdChange: number | null;
    cashBalance: number;
    arBalance: number;
    apBalance: number;
    taxOutstanding: number;
  };
  actionQueue: Array<{
    severity: "info" | "warning" | "error";
    title: string;
    detail?: string;
    count?: number;
    link?: string;
    items?: Array<{ journalNumber: string; label: string; amount?: number; date?: string }>;
  }>;
  insights: Array<{ tone: "positive" | "negative" | "neutral"; text: string }>;
};

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AccountingHubPage() {
  const { request } = useAccountingApi();
  const router = useRouter();
  const [hub, setHub] = useState<Hub | null>(null);
  const [loading, setLoading] = useState(true);
  const [newJournalOpen, setNewJournalOpen] = useState(false);
  const [closeWizardOpen, setCloseWizardOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Lazy trigger: run any due recurring journal templates first so the hub
      // snapshot already includes the new drafts in its counts.
      // Best-effort — a failure here shouldn't block the hub from loading.
      try {
        await request("/recurring-journals/run-due", { method: "POST" });
      } catch {
        // Silent.
      }
      const res = await request<Hub>("/journal/reports/hub");
      setHub(res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load Finance Hub");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !hub) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!hub) return null;

  const kpis = hub.kpis;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Finance Hub
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Snapshot as of {new Date(hub.asOf).toLocaleString()}
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
          Refresh
        </Button>
      </Stack>

      {/* Conversational Ask bar */}
      <AskBar />

      {/* KPI row */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" },
          gap: 2,
        }}
      >
        <KpiTile
          title="Revenue (MTD)"
          icon={<TrendingUpIcon />}
          value={kpis.revenueMtd}
          changePct={kpis.revenueMtdChange}
          changeLabel="vs last month"
          accent="success"
          link="/portal/accounting/reports?tab=pl"
          secondary={`YTD: ${fmt(kpis.revenueYtd)}`}
        />
        <KpiTile
          title="Net Profit (MTD)"
          icon={<TrendingUpIcon />}
          value={kpis.netProfitMtd}
          changePct={kpis.netProfitMtdChange}
          changeLabel="vs last month"
          accent={kpis.netProfitMtd >= 0 ? "success" : "error"}
          link="/portal/accounting/reports?tab=pl"
          secondary={`YTD: ${fmt(kpis.netProfitYtd)}`}
        />
        <KpiTile
          title="Cash & Bank"
          icon={<AccountBalanceWalletIcon />}
          value={kpis.cashBalance}
          accent="info"
          link="/portal/accounting/reports?tab=gl"
        />
        <KpiTile
          title="GST Payable"
          icon={<PercentIcon />}
          value={kpis.taxOutstanding}
          accent={kpis.taxOutstanding > 0 ? "warning" : "success"}
          link="/portal/accounting/reports?tab=gst"
          secondary={kpis.taxOutstanding > 0 ? "Ready to file" : "Nothing due"}
        />
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
          gap: 2,
        }}
      >
        <KpiTile
          title="Accounts Receivable"
          icon={<RequestQuoteIcon />}
          value={kpis.arBalance}
          accent="info"
          link="/portal/reports/statement-of-account"
          secondary="Customers owe you"
          compact
        />
        <KpiTile
          title="Accounts Payable"
          icon={<PaymentsIcon />}
          value={kpis.apBalance}
          accent="warning"
          link="/portal/accounting/reports?tab=gl"
          secondary="You owe suppliers"
          compact
        />
      </Box>

      {/* Action Queue + Insights */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2,
        }}
      >
        <ActionQueueCard items={hub.actionQueue} onNavigate={(href) => router.push(href)} />
        <InsightsCard insights={hub.insights} />
      </Box>

      {/* Quick actions */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
          <Typography variant="overline" sx={{ color: "text.secondary", mr: 1, fontWeight: 700 }}>
            Quick Actions
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            component={Link}
            href="/portal/sales/invoices"
          >
            New Invoice
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setNewJournalOpen(true)}
          >
            New Journal Entry
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<ReceiptIcon />}
            component={Link}
            href="/portal/accounting/reports?tab=audit"
          >
            View Journal Log
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<LockIcon />}
            onClick={() => setCloseWizardOpen(true)}
          >
            Close Period
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            component={Link}
            href="/portal/accounting/recurring"
          >
            Recurring
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            component={Link}
            href="/portal/accounting/fixed-assets"
          >
            Fixed Assets
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            component={Link}
            href="/portal/accounting/budget"
          >
            Budgets
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            component={Link}
            href="/portal/inventory/bills"
          >
            Bills (AP)
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            component={Link}
            href="/portal/accounting/bank-reconciliation"
          >
            Bank Rec
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            component={Link}
            href="/portal/accounting/integrations/xero"
          >
            Xero
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            component={Link}
            href="/portal/accounting/reports"
          >
            All Reports
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            component={Link}
            href="/portal/settings/accounting-setup"
          >
            Settings
          </Button>
        </Stack>
      </Paper>

      <JournalEntryDialog
        open={newJournalOpen}
        onClose={() => setNewJournalOpen(false)}
        onCreated={load}
      />
      <CloseWizardDialog
        open={closeWizardOpen}
        onClose={() => setCloseWizardOpen(false)}
        onCompleted={() => load()}
      />
    </Box>
  );
}

function KpiTile({
  title,
  icon,
  value,
  changePct,
  changeLabel,
  accent,
  link,
  secondary,
  compact,
}: {
  title: string;
  icon: React.ReactNode;
  value: number;
  changePct?: number | null;
  changeLabel?: string;
  accent: "success" | "warning" | "error" | "info";
  link?: string;
  secondary?: string;
  compact?: boolean;
}) {
  const showChange = changePct !== null && changePct !== undefined;
  const positive = (changePct ?? 0) >= 0;
  return (
    <Paper
      variant="outlined"
      component={link ? Link : "div"}
      href={link as any}
      sx={{
        p: compact ? 1.75 : 2.25,
        borderRadius: 2,
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 160ms ease, box-shadow 160ms ease",
        cursor: link ? "pointer" : "default",
        "&:hover": link
          ? {
              borderColor: (t) => alpha(t.palette[accent].main, 0.4),
              boxShadow: (t) => `0 2px 8px ${alpha(t.palette.text.primary, 0.05)}`,
            }
          : {},
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
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

      <Stack direction="row" alignItems="baseline" gap={1}>
        <Typography
          sx={{
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: compact ? "1.25rem" : "1.625rem",
            lineHeight: 1.1,
          }}
        >
          {fmt(value)}
        </Typography>
        {showChange && (
          <Stack direction="row" alignItems="center" gap={0.25}>
            {positive ? (
              <TrendingUpIcon sx={{ fontSize: "0.875rem", color: "success.main" }} />
            ) : (
              <TrendingDownIcon sx={{ fontSize: "0.875rem", color: "error.main" }} />
            )}
            <Typography
              variant="caption"
              sx={{
                color: positive ? "success.main" : "error.main",
                fontWeight: 600,
                fontSize: "0.75rem",
              }}
            >
              {Math.abs(changePct!).toFixed(0)}%
            </Typography>
          </Stack>
        )}
      </Stack>

      {(secondary || changeLabel) && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem", mt: 0.25, display: "block" }}>
          {secondary || changeLabel}
        </Typography>
      )}
    </Paper>
  );
}

function ActionQueueCard({
  items,
  onNavigate,
}: {
  items: Hub["actionQueue"];
  onNavigate: (href: string) => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Action Queue
        </Typography>
        <Chip size="small" label={items.length} variant="outlined" />
      </Stack>
      {items.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary", py: 2, textAlign: "center" }}>
          Nothing requires attention. ✓
        </Typography>
      ) : (
        <Stack gap={1}>
          {items.map((item, i) => (
            <Stack
              key={i}
              direction="row"
              alignItems="flex-start"
              gap={1}
              sx={{
                p: 1,
                borderRadius: 1,
                cursor: item.link ? "pointer" : "default",
                "&:hover": item.link ? { bgcolor: (t) => alpha(t.palette.text.primary, 0.03) } : {},
              }}
              onClick={() => item.link && onNavigate(item.link)}
            >
              <Box
                sx={{
                  color:
                    item.severity === "error"
                      ? "error.main"
                      : item.severity === "warning"
                      ? "warning.main"
                      : "info.main",
                  mt: 0.25,
                  "& svg": { fontSize: "1.125rem" },
                }}
              >
                {item.severity === "error" ? (
                  <ErrorOutlineIcon />
                ) : item.severity === "warning" ? (
                  <WarningAmberIcon />
                ) : (
                  <InfoOutlinedIcon />
                )}
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {item.title}
                </Typography>
                {item.detail && (
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                    {item.detail}
                  </Typography>
                )}
                {item.items && item.items.length > 0 && (
                  <Stack gap={0.25} sx={{ mt: 0.75 }}>
                    {item.items.slice(0, 5).map((sub) => (
                      <Stack
                        key={sub.journalNumber}
                        direction="row"
                        gap={1}
                        alignItems="baseline"
                        sx={{
                          cursor: "pointer",
                          color: "text.secondary",
                          "&:hover": { color: "primary.main", textDecoration: "underline" },
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate(
                            `/portal/accounting/audit-trail?journalNumbers=${encodeURIComponent(sub.journalNumber)}`
                          );
                        }}
                      >
                        <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: "0.7rem" }}>
                          {sub.journalNumber}
                        </Typography>
                        <Typography variant="caption" sx={{ flex: 1, fontSize: "0.75rem" }}>
                          {sub.label}
                        </Typography>
                        {sub.amount !== undefined && (
                          <Typography variant="caption" sx={{ fontFamily: "monospace", fontSize: "0.7rem" }}>
                            ${sub.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Typography>
                        )}
                      </Stack>
                    ))}
                    {item.items.length > 5 && (
                      <Typography variant="caption" sx={{ color: "text.disabled", fontSize: "0.7rem" }}>
                        +{item.items.length - 5} more — open audit trail to see all
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>
              {item.link && <ArrowOutwardIcon sx={{ fontSize: "0.875rem", color: "text.secondary" }} />}
            </Stack>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function InsightsCard({ insights }: { insights: Hub["insights"] }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1.5 }}>
        <AutoAwesomeIcon sx={{ fontSize: "1rem", color: "primary.main" }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Smart Insights
        </Typography>
      </Stack>
      {insights.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary", py: 2, textAlign: "center" }}>
          No notable changes this period.
        </Typography>
      ) : (
        <Stack gap={1.5}>
          {insights.map((ins, i) => (
            <Box
              key={i}
              sx={{
                p: 1.25,
                borderRadius: 1,
                bgcolor: (t) =>
                  alpha(
                    ins.tone === "positive"
                      ? t.palette.success.main
                      : ins.tone === "negative"
                      ? t.palette.error.main
                      : t.palette.info.main,
                    0.06,
                  ),
                borderLeft: 3,
                borderColor:
                  ins.tone === "positive"
                    ? "success.main"
                    : ins.tone === "negative"
                    ? "error.main"
                    : "info.main",
              }}
            >
              <Typography variant="body2">{ins.text}</Typography>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
