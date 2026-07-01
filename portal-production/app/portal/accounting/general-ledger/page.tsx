"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
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
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import SearchIcon from "@mui/icons-material/Search";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ShoppingBagIcon from "@mui/icons-material/ShoppingBag";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";

type Account = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
};

type ActivityRow = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
  debit: number;
  credit: number;
  balance: number;
};

type MergedRow = ActivityRow & { accountId: string };

type LedgerRow = {
  journalEntryId: string;
  journalNumber: string;
  entryDate: string;
  type: string;
  reference?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
  balance: number;
};

type Ledger = {
  account: { id: string; code: string; name: string; normalBalance: string };
  openingBalance: number;
  closingBalance: number;
  rows: LedgerRow[];
};

const fmt = (n: number) =>
  !n ? "" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtKpi = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isCashOrBank = (code: string) =>
  code === "CA004" || code === "CA600" || /^CA1\d{2}$/.test(code);

// Xero-style account-type groups, in statement order.
const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: "Revenue", types: ["SALES", "INCOME"] },
  { label: "Cost of Sales", types: ["PURCHASE"] },
  { label: "Expenses", types: ["EXPENSE", "EXCHANGE_GAIN_LOSS", "EXTRAORDINARY", "DEPRECIATION_PROVISION"] },
  { label: "Assets", types: ["FIXED_ASSET", "INTANGIBLE_ASSET", "CURRENT_ASSET", "FOREIGN_BANK", "WORK_IN_PROGRESS"] },
  { label: "Liabilities", types: ["CURRENT_LIABILITY", "TAX_LIABILITY", "TAX", "MEDIUM_TERM_LIABILITY", "LONG_TERM_LIABILITY"] },
  { label: "Equity", types: ["SHARE_CAPITAL", "RETAINED_PROFIT", "CAPITAL_RESERVE", "DIVIDEND"] },
];
const groupForType = (t: string) => TYPE_GROUPS.find((g) => g.types.includes(t))?.label || "Other";
const GROUP_ORDER = [...TYPE_GROUPS.map((g) => g.label), "Other"];

// ---- date-range presets ----
const iso = (d: Date) => d.toISOString().slice(0, 10);
function presetRange(preset: string): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "this-month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "last-month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "this-quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case "this-year":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    case "ytd":
      return { from: iso(new Date(y, 0, 1)), to: iso(now) };
    case "all":
      return { from: "2000-01-01", to: iso(now) };
    default:
      return null; // custom
  }
}

export default function GeneralLedgerPage() {
  const { request } = useAccountingApi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [drilldown, setDrilldown] = useState<Account | null>(null);

  // Toolbar state — default to "This year" so historical-data orgs show
  // something on first load (switch to All time / a custom range as needed).
  const [preset, setPreset] = useState("this-year");
  const initial = presetRange("this-year")!;
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [include, setInclude] = useState<"all" | "with-tx">("with-tx");
  const [search, setSearch] = useState("");

  const onPreset = (p: string) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, act] = await Promise.all([
        request<Account[]>("/accounting/accounts"),
        request<ActivityRow[]>(`/journal/reports/account-activity?startDate=${from}&endDate=${to}`),
      ]);
      setAccounts((list || []).slice().sort((a, b) => a.code.localeCompare(b.code)));
      setActivity(act || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load general ledger");
    } finally {
      setLoading(false);
    }
  }, [request, from, to]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actByAccount = useMemo(() => {
    const m = new Map<string, ActivityRow>();
    activity.forEach((r) => m.set(r.id, r));
    return m;
  }, [activity]);

  const merged: MergedRow[] = useMemo(
    () =>
      accounts.map((a) => {
        const r = actByAccount.get(a.id);
        return {
          accountId: a.id,
          id: a.id,
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          category: a.category,
          normalBalance: a.normalBalance,
          debit: r?.debit || 0,
          credit: r?.credit || 0,
          balance: r?.balance || 0,
        };
      }),
    [accounts, actByAccount],
  );

  const kpis = useMemo(() => {
    const byType = (types: string[]) =>
      merged.filter((m) => types.includes(m.accountType)).reduce((s, r) => s + r.balance, 0);
    const byCode = (codes: string[]) =>
      merged.filter((m) => codes.includes(m.code)).reduce((s, r) => s + r.balance, 0);
    const cashRows = merged.filter((m) => isCashOrBank(m.code));
    return {
      revenue: { sales: byType(["SALES"]), income: byType(["INCOME"]) },
      costOfSales: { purchases: byType(["PURCHASE"]), openingStock: byCode(["CA002"]) },
      expenses: { expenses: byType(["EXPENSE"]), taxation: byType(["TAX", "TAX_LIABILITY"]) },
      cashFlow: {
        receipts: cashRows.reduce((s, r) => s + r.debit, 0),
        payments: cashRows.reduce((s, r) => s + r.credit, 0),
      },
    };
  }, [merged]);

  // Apply "accounts to include" + search, then group by account type.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = merged.filter((m) => {
      if (include === "with-tx" && !m.debit && !m.credit) return false;
      if (q && !m.code.toLowerCase().includes(q) && !m.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const byGroup = new Map<string, MergedRow[]>();
    for (const r of rows) {
      const g = groupForType(r.accountType);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(r);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => {
      const list = byGroup.get(g)!.sort((a, b) => a.code.localeCompare(b.code));
      return {
        label: g,
        rows: list,
        subDebit: list.reduce((s, r) => s + r.debit, 0),
        subCredit: list.reduce((s, r) => s + r.credit, 0),
      };
    });
  }, [merged, include, search]);

  const totalDebit = grouped.reduce((s, g) => s + g.subDebit, 0);
  const totalCredit = grouped.reduce((s, g) => s + g.subCredit, 0);
  const rowCount = grouped.reduce((s, g) => s + g.rows.length, 0);

  const exportCsv = () => {
    const lines = ["Account,Description,Debit,Credit"];
    for (const g of grouped) {
      lines.push(`,${g.label},,`);
      for (const r of g.rows) {
        lines.push(`${r.code},"${r.name.replace(/"/g, '""')}",${r.debit || ""},${r.credit || ""}`);
      }
      lines.push(`,${g.label} subtotal,${g.subDebit.toFixed(2)},${g.subCredit.toFixed(2)}`);
    }
    lines.push(`,TOTAL,${totalDebit.toFixed(2)},${totalCredit.toFixed(2)}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `general-ledger_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>General Ledger</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            All accounts for {new Date(from).toLocaleDateString()} – {new Date(to).toLocaleDateString()}. Click an account to open its detailed ledger.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={exportCsv}>Excel</Button>
          <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
        </Stack>
      </Stack>

      {/* KPI strip */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" }, gap: 2 }}>
        <KpiCard title="Revenue" icon={<TrendingUpIcon />} accent="success" total={kpis.revenue.sales + kpis.revenue.income}
          rows={[{ label: "Sales", value: kpis.revenue.sales }, { label: "Income", value: kpis.revenue.income }]} />
        <KpiCard title="Cost Of Sales" icon={<ShoppingBagIcon />} accent="warning" total={kpis.costOfSales.purchases + kpis.costOfSales.openingStock}
          rows={[{ label: "Purchases", value: kpis.costOfSales.purchases }, { label: "Opening Stock", value: kpis.costOfSales.openingStock }]} />
        <KpiCard title="Expenses" icon={<RemoveCircleOutlineIcon />} accent="error" total={kpis.expenses.expenses + kpis.expenses.taxation}
          rows={[{ label: "Expenses", value: kpis.expenses.expenses }, { label: "Taxation", value: kpis.expenses.taxation }]} />
        <KpiCard title="Cash Flow" icon={<LocalAtmIcon />} accent="info" total={kpis.cashFlow.receipts - kpis.cashFlow.payments} totalLabel="Net"
          rows={[{ label: "Receipts", value: kpis.cashFlow.receipts }, { label: "Payment", value: kpis.cashFlow.payments }]} />
      </Box>

      {/* Xero-style control toolbar */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
          <TextField select size="small" label="Date range" value={preset} onChange={(e) => onPreset(e.target.value)} sx={{ width: 170 }}>
            <MenuItem value="this-month">This month</MenuItem>
            <MenuItem value="last-month">Last month</MenuItem>
            <MenuItem value="this-quarter">This quarter</MenuItem>
            <MenuItem value="this-year">This year</MenuItem>
            <MenuItem value="ytd">Year to date</MenuItem>
            <MenuItem value="all">All time</MenuItem>
            <MenuItem value="custom">Custom</MenuItem>
          </TextField>
          <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={from}
            onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} sx={{ width: 160 }} />
          <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={to}
            onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} sx={{ width: 160 }} />
          <TextField select size="small" label="Accounts to include" value={include} onChange={(e) => setInclude(e.target.value as any)} sx={{ width: 190 }}>
            <MenuItem value="with-tx">Only with transactions</MenuItem>
            <MenuItem value="all">All accounts</MenuItem>
          </TextField>
          <TextField size="small" placeholder="Locate by code / description" value={search} onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.5, color: "text.secondary" }} /> }} sx={{ width: 240 }} />
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" size="small" startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <RefreshIcon />} onClick={load} disabled={loading}>
            Update
          </Button>
        </Stack>
      </Paper>

      {/* Account table — single scroll, grouped by type with subtotals */}
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <TableContainer sx={{ maxHeight: "calc(100vh - 380px)" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, width: 120 }}>Account</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 150 }}>Debit</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 150 }}>Credit</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={4} align="center" sx={{ py: 5 }}><CircularProgress size={22} /></TableCell></TableRow>
              )}
              {!loading && rowCount === 0 && (
                <TableRow><TableCell colSpan={4} align="center" sx={{ py: 5, color: "text.secondary" }}>No accounts match.</TableCell></TableRow>
              )}
              {!loading && grouped.map((g) => (
                <GroupRows key={g.label} group={g} onAccount={(r) => setDrilldown({
                  id: r.accountId, code: r.code, name: r.name, accountType: r.accountType, category: r.category, normalBalance: r.normalBalance,
                })} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {!loading && rowCount > 0 && (
          <Box sx={{ display: "flex", borderTop: 2, borderColor: "text.primary", px: 2, py: 1, bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
            <Typography sx={{ flex: 1, fontWeight: 800 }}>TOTAL</Typography>
            <Typography sx={{ width: 150, textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>{fmtKpi(totalDebit)}</Typography>
            <Typography sx={{ width: 150, textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>{fmtKpi(totalCredit)}</Typography>
          </Box>
        )}
      </Paper>

      <DrilldownDialog account={drilldown} onClose={() => setDrilldown(null)} from={from} to={to} />
    </Box>
  );
}

function GroupRows({ group, onAccount }: { group: { label: string; rows: MergedRow[]; subDebit: number; subCredit: number }; onAccount: (r: MergedRow) => void }) {
  return (
    <>
      <TableRow sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.06) }}>
        <TableCell colSpan={4} sx={{ fontWeight: 700, color: "primary.main", letterSpacing: 0.3 }}>{group.label}</TableCell>
      </TableRow>
      {group.rows.map((r) => (
        <TableRow key={r.accountId} hover>
          <TableCell>
            <Box component="span" onClick={() => onAccount(r)}
              sx={{ fontFamily: "monospace", fontWeight: 600, color: "primary.main", textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
              {r.code}
            </Box>
          </TableCell>
          <TableCell>{r.name}</TableCell>
          <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(r.debit)}</TableCell>
          <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(r.credit)}</TableCell>
        </TableRow>
      ))}
      <TableRow>
        <TableCell />
        <TableCell sx={{ fontWeight: 600, color: "text.secondary", fontStyle: "italic" }}>{group.label} subtotal</TableCell>
        <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, borderTop: 1, borderColor: "divider" }}>{fmtKpi(group.subDebit)}</TableCell>
        <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 700, borderTop: 1, borderColor: "divider" }}>{fmtKpi(group.subCredit)}</TableCell>
      </TableRow>
    </>
  );
}

function KpiCard({ title, icon, accent, total, totalLabel, rows }: {
  title: string; icon: React.ReactNode; accent: "success" | "warning" | "error" | "info"; total: number; totalLabel?: string; rows: { label: string; value: number }[];
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase", color: "text.secondary", fontSize: "0.6875rem" }}>{title}</Typography>
        <Box sx={{ width: 32, height: 32, borderRadius: 1.5, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: (t) => alpha(t.palette[accent].main, 0.1), color: (t) => t.palette[accent].main, "& svg": { fontSize: "1.125rem" } }}>{icon}</Box>
      </Stack>
      <Stack direction="row" alignItems="baseline" gap={1} sx={{ mb: 1.5 }}>
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.1 }}>{fmtKpi(total)}</Typography>
        {totalLabel && <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>{totalLabel}</Typography>}
      </Stack>
      <Stack gap={0.5} sx={{ pt: 1, borderTop: 1, borderColor: "divider" }}>
        {rows.map((r) => (
          <Stack key={r.label} direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.75rem" }}>{r.label}</Typography>
            <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 500, fontSize: "0.75rem" }}>{fmtKpi(r.value)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function DrilldownDialog({ account, onClose, from, to }: { account: Account | null; onClose: () => void; from: string; to: string }) {
  const { request } = useAccountingApi();
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!account) { setData(null); return; }
    (async () => {
      setLoading(true);
      try {
        const res = await request<Ledger>(`/journal/reports/general-ledger/${account.id}?startDate=${from}&endDate=${to}`);
        setData(res);
      } catch (e: any) {
        toast.error(e?.message || "Failed to load account ledger");
      } finally {
        setLoading(false);
      }
    })();
  }, [account, from, to, request]);

  return (
    <Dialog open={!!account} onClose={onClose} fullWidth maxWidth="lg">
      {account && (
        <>
          <DialogTitle>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" alignItems="baseline" gap={1.5}>
                <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{account.code}</Typography>
                <Typography component="span">{account.name}</Typography>
                <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
                  {account.normalBalance} · {account.category === "PNL" ? "P&L" : "Balance Sheet"}
                </Typography>
              </Stack>
              <IconButton onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent dividers>
            {loading && <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}><CircularProgress size={24} /></Box>}
            {!loading && data && (
              <>
                <Stack direction="row" gap={3} sx={{ mb: 2 }}>
                  <Typography variant="body2"><strong>Opening:</strong> {fmtKpi(data.openingBalance)}</Typography>
                  <Typography variant="body2"><strong>Closing:</strong> {fmtKpi(data.closingBalance)}</Typography>
                </Stack>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Entry #</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Reference</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Debit</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Credit</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Balance</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <TableRow>
                        <TableCell colSpan={7} sx={{ fontStyle: "italic", color: "text.secondary" }}>Opening balance</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, fontFamily: "monospace" }}>{fmtKpi(data.openingBalance)}</TableCell>
                      </TableRow>
                      {data.rows.length === 0 && (
                        <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4, color: "text.secondary" }}>No activity in this period.</TableCell></TableRow>
                      )}
                      {data.rows.map((r) => (
                        <TableRow key={`${r.journalEntryId}-${r.journalNumber}-${r.entryDate}`} hover>
                          <TableCell>{new Date(r.entryDate).toLocaleDateString()}</TableCell>
                          <TableCell sx={{ fontFamily: "monospace" }}>{r.journalNumber}</TableCell>
                          <TableCell>{r.type}</TableCell>
                          <TableCell>{r.reference}</TableCell>
                          <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(r.debit)}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(r.credit)}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600 }}>{fmtKpi(r.balance)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}
