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
import LogoutIcon from "@mui/icons-material/Logout";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import ShoppingBagIcon from "@mui/icons-material/ShoppingBag";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import PageTable from "@/components/PageTable";

type Account = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
};

type TBRow = {
  accountId: string;
  code: string;
  name: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
  debit: number;
  credit: number;
  balance: number;
};

type TrialBalance = {
  asOfDate: string | null;
  rows: TBRow[];
  totalDebit: number;
  totalCredit: number;
};

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
  n === 0 ? "" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtKpi = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Cash/bank account detection — matches seed CoA pattern (CA004 cash, CA100-CA105 banks, CA600 cash at bank)
const isCashOrBank = (code: string) =>
  code === "CA004" || code === "CA600" || /^CA1\d{2}$/.test(code);

export default function GeneralLedgerPage() {
  const router = useRouter();
  const { request } = useAccountingApi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [cutOffDate, setCutOffDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [drilldown, setDrilldown] = useState<Account | null>(null);

  // PageTable-driven state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, balance] = await Promise.all([
        request<Account[]>("/accounting/accounts"),
        request<TrialBalance>(`/journal/reports/trial-balance${cutOffDate ? `?asOfDate=${cutOffDate}` : ""}`),
      ]);
      setAccounts((list || []).slice().sort((a, b) => a.code.localeCompare(b.code)));
      setTb(balance);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load general ledger");
    } finally {
      setLoading(false);
    }
  }, [request, cutOffDate]);

  useEffect(() => {
    load();
  }, [load]);

  // Index TB rows by accountId for quick joins; fall back to zero-balance row for accounts with no activity
  const tbByAccount = useMemo(() => {
    const m = new Map<string, TBRow>();
    (tb?.rows || []).forEach((r) => m.set(r.accountId, r));
    return m;
  }, [tb]);

  // Join chart of accounts with TB rows so every defined account is shown — empty accounts get 0/0
  const merged = useMemo(() => {
    return accounts.map((a) => {
      const r = tbByAccount.get(a.id);
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        category: a.category,
        normalBalance: a.normalBalance,
        debit: r?.debit || 0,
        credit: r?.credit || 0,
        balance: r?.balance || 0,
      };
    });
  }, [accounts, tbByAccount]);

  // KPI cards — group by accountType (uses the seed CoA's accountType field, not just code prefix)
  const kpis = useMemo(() => {
    const sumBalanceByType = (types: string[]) =>
      merged.filter((m) => types.includes(m.accountType)).reduce((s, r) => s + r.balance, 0);

    const sumBalanceByCode = (codes: string[]) =>
      merged.filter((m) => codes.includes(m.code)).reduce((s, r) => s + r.balance, 0);

    const sales = sumBalanceByType(["SALES"]);
    const income = sumBalanceByType(["INCOME"]);
    const purchases = sumBalanceByType(["PURCHASE"]);
    const openingStock = sumBalanceByCode(["CA002"]);
    const expenses = sumBalanceByType(["EXPENSE"]);
    const taxation = sumBalanceByType(["TAX", "TAX_LIABILITY"]);

    // Cash flow — gross debit/credit on cash and bank accounts
    const cashRows = merged.filter((m) => isCashOrBank(m.code));
    const receipts = cashRows.reduce((s, r) => s + r.debit, 0);
    const payments = cashRows.reduce((s, r) => s + r.credit, 0);

    return {
      revenue: { sales, income },
      costOfSales: { purchases, openingStock },
      expenses: { expenses, taxation },
      cashFlow: { receipts, payments },
    };
  }, [merged]);

  // Locate by description filter (now driven by PageTable's search)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((m) => m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [merged, search]);

  useEffect(() => { setPage(1); }, [search]);

  const pageCount = Math.max(1, Math.ceil(visible.length / limit));
  const paged = useMemo(
    () => visible.slice((page - 1) * limit, page * limit),
    [visible, page, limit],
  );

  const columns = useMemo(() => [
    {
      accessorKey: "code",
      header: "Account",
      cell: ({ row }: any) => (
        <Box
          sx={{
            fontFamily: "monospace",
            fontWeight: 600,
            color: "primary.main",
            textDecoration: "underline",
            textUnderlineOffset: 3,
            cursor: "pointer",
          }}
          onClick={() => setDrilldown({
            id: row.original.accountId,
            code: row.original.code,
            name: row.original.name,
            accountType: row.original.accountType,
            category: row.original.category,
            normalBalance: row.original.normalBalance,
          })}
        >
          {row.original.code}
        </Box>
      ),
    },
    { accessorKey: "name", header: "Description", cell: ({ row }: any) => row.original.name },
    {
      accessorKey: "debit",
      header: "Debit",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(row.original.debit)}</Box>
      ),
    },
    {
      accessorKey: "credit",
      header: "Credit",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(row.original.credit)}</Box>
      ),
    },
  ], []);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* KPI cards row */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" },
          gap: 2,
        }}
      >
        <KpiCard
          title="Revenue"
          icon={<TrendingUpIcon />}
          accent="success"
          total={kpis.revenue.sales + kpis.revenue.income}
          rows={[
            { label: "Sales", value: kpis.revenue.sales },
            { label: "Income", value: kpis.revenue.income },
          ]}
        />
        <KpiCard
          title="Cost Of Sales"
          icon={<ShoppingBagIcon />}
          accent="warning"
          total={kpis.costOfSales.purchases + kpis.costOfSales.openingStock}
          rows={[
            { label: "Purchases", value: kpis.costOfSales.purchases },
            { label: "Opening Stock", value: kpis.costOfSales.openingStock },
          ]}
        />
        <KpiCard
          title="Expenses"
          icon={<RemoveCircleOutlineIcon />}
          accent="error"
          total={kpis.expenses.expenses + kpis.expenses.taxation}
          rows={[
            { label: "Expenses", value: kpis.expenses.expenses },
            { label: "Taxation", value: kpis.expenses.taxation },
          ]}
        />
        <KpiCard
          title="Cash Flow"
          icon={<LocalAtmIcon />}
          accent="info"
          total={kpis.cashFlow.receipts - kpis.cashFlow.payments}
          totalLabel="Net"
          rows={[
            { label: "Receipts", value: kpis.cashFlow.receipts },
            { label: "Payment", value: kpis.cashFlow.payments },
          ]}
        />
      </Box>

      {/* Toolbar: cut-off date + actions */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            type="date"
            label="Cut-Off Date"
            InputLabelProps={{ shrink: true }}
            value={cutOffDate}
            onChange={(e) => setCutOffDate(e.target.value)}
          />
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<PrintIcon />} variant="outlined" size="small" onClick={() => window.print()}>
            Print
          </Button>
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
            Refresh
          </Button>
          <Button
            startIcon={<LogoutIcon />}
            variant="outlined"
            color="inherit"
            size="small"
            onClick={() => router.push("/portal")}
          >
            Exit
          </Button>
        </Stack>
        <Typography variant="caption" sx={{ color: "text.secondary", mt: 1, display: "block" }}>
          Left-Click on the Account Column to invoke General Ledger
        </Typography>
      </Paper>

      <PageTable
        columns={columns}
        data={paged}
        tableName="General Ledger"
        subTitle="Click any account row to invoke its detailed ledger."
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

      {/* Drill-down dialog */}
      <DrilldownDialog account={drilldown} onClose={() => setDrilldown(null)} cutOffDate={cutOffDate} />
    </Box>
  );
}

function KpiCard({
  title,
  icon,
  accent,
  total,
  totalLabel,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  accent: "success" | "warning" | "error" | "info";
  total: number;
  totalLabel?: string;
  rows: { label: string; value: number }[];
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.25,
        borderRadius: 2,
        transition: "box-shadow 160ms ease, border-color 160ms ease",
        "&:hover": {
          boxShadow: (t) => `0 1px 3px ${alpha(t.palette.text.primary, 0.06)}, 0 4px 12px ${alpha(t.palette.text.primary, 0.04)}`,
          borderColor: "divider",
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

      <Stack direction="row" alignItems="baseline" gap={1} sx={{ mb: 1.5 }}>
        <Typography
          sx={{
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: "1.5rem",
            lineHeight: 1.1,
            color: "text.primary",
          }}
        >
          {fmtKpi(total)}
        </Typography>
        {totalLabel && (
          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
            {totalLabel}
          </Typography>
        )}
      </Stack>

      <Stack gap={0.5} sx={{ pt: 1, borderTop: 1, borderColor: "divider" }}>
        {rows.map((r) => (
          <Stack key={r.label} direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.75rem" }}>
              {r.label}
            </Typography>
            <Typography
              variant="caption"
              sx={{ fontFamily: "monospace", fontWeight: 500, fontSize: "0.75rem", color: "text.primary" }}
            >
              {fmtKpi(r.value)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function DrilldownDialog({
  account,
  onClose,
  cutOffDate,
}: {
  account: Account | null;
  onClose: () => void;
  cutOffDate: string;
}) {
  const { request } = useAccountingApi();
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!account) {
      setData(null);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const q = cutOffDate ? `?endDate=${cutOffDate}` : "";
        const res = await request<Ledger>(`/journal/reports/general-ledger/${account.id}${q}`);
        setData(res);
      } catch (e: any) {
        toast.error(e?.message || "Failed to load account ledger");
      } finally {
        setLoading(false);
      }
    })();
  }, [account, cutOffDate, request]);

  return (
    <Dialog open={!!account} onClose={onClose} fullWidth maxWidth="lg">
      {account && (
        <>
          <DialogTitle>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" alignItems="baseline" gap={1.5}>
                <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {account.code}
                </Typography>
                <Typography component="span">{account.name}</Typography>
                <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
                  {account.normalBalance} · {account.category === "PNL" ? "P&L" : "Balance Sheet"}
                </Typography>
              </Stack>
              <IconButton onClick={onClose} size="small">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent dividers>
            {loading && (
              <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                <CircularProgress size={24} />
              </Box>
            )}
            {!loading && data && (
              <>
                <Stack direction="row" gap={3} sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    <strong>Opening:</strong> {fmtKpi(data.openingBalance)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Closing:</strong> {fmtKpi(data.closingBalance)}
                  </Typography>
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
                        <TableCell colSpan={7} sx={{ fontStyle: "italic", color: "text.secondary" }}>
                          Opening balance
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600, fontFamily: "monospace" }}>
                          {fmtKpi(data.openingBalance)}
                        </TableCell>
                      </TableRow>
                      {data.rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} align="center" sx={{ py: 4, color: "text.secondary" }}>
                            No activity in this period.
                          </TableCell>
                        </TableRow>
                      )}
                      {data.rows.map((r) => (
                        <TableRow
                          key={`${r.journalEntryId}-${r.journalNumber}-${r.entryDate}`}
                          hover
                        >
                          <TableCell>{new Date(r.entryDate).toLocaleDateString()}</TableCell>
                          <TableCell sx={{ fontFamily: "monospace" }}>{r.journalNumber}</TableCell>
                          <TableCell>{r.type}</TableCell>
                          <TableCell>{r.reference}</TableCell>
                          <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.description}
                          </TableCell>
                          <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(r.debit)}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(r.credit)}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                            {fmtKpi(r.balance)}
                          </TableCell>
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
