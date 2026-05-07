"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid2,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import { toast } from "react-toastify";

type Account = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  accountType: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
  isControlAccount: boolean;
  isSystem: boolean;
  isActive: boolean;
};

const ACCOUNT_TYPES = [
  { value: "SALES", label: "Sales", category: "PNL", normalBalance: "CREDIT" },
  { value: "PURCHASE", label: "Purchase / Cost of Sales", category: "PNL", normalBalance: "DEBIT" },
  { value: "INCOME", label: "Income", category: "PNL", normalBalance: "CREDIT" },
  { value: "EXPENSE", label: "Expenses", category: "PNL", normalBalance: "DEBIT" },
  { value: "TAX", label: "Tax", category: "PNL", normalBalance: "DEBIT" },
  { value: "EXTRAORDINARY", label: "Extraordinary Items", category: "PNL", normalBalance: "DEBIT" },
  { value: "EXCHANGE_GAIN_LOSS", label: "Exchange Gain / Loss", category: "PNL", normalBalance: "CREDIT" },
  { value: "FIXED_ASSET", label: "Fixed Assets", category: "BALANCE_SHEET", normalBalance: "DEBIT" },
  { value: "INTANGIBLE_ASSET", label: "Intangible Assets", category: "BALANCE_SHEET", normalBalance: "DEBIT" },
  { value: "CURRENT_ASSET", label: "Current Assets", category: "BALANCE_SHEET", normalBalance: "DEBIT" },
  { value: "CURRENT_LIABILITY", label: "Current Liabilities", category: "BALANCE_SHEET", normalBalance: "CREDIT" },
  { value: "TAX_LIABILITY", label: "Tax Liabilities (VAT / GST)", category: "BALANCE_SHEET", normalBalance: "CREDIT" },
  { value: "MEDIUM_TERM_LIABILITY", label: "Medium Term Liabilities", category: "BALANCE_SHEET", normalBalance: "CREDIT" },
  { value: "LONG_TERM_LIABILITY", label: "Long Term Liabilities", category: "BALANCE_SHEET", normalBalance: "CREDIT" },
  { value: "SHARE_CAPITAL", label: "Share Capital", category: "BALANCE_SHEET", normalBalance: "CREDIT" },
  { value: "RETAINED_PROFIT", label: "Retained Profit", category: "BALANCE_SHEET", normalBalance: "CREDIT" },
  { value: "CAPITAL_RESERVE", label: "Capital Reserve", category: "BALANCE_SHEET", normalBalance: "CREDIT" },
  { value: "DIVIDEND", label: "Dividends", category: "BALANCE_SHEET", normalBalance: "DEBIT" },
  { value: "DEPRECIATION_PROVISION", label: "Provision for Depreciation", category: "BALANCE_SHEET", normalBalance: "CREDIT" },
  { value: "FOREIGN_BANK", label: "Foreign Bank Account", category: "BALANCE_SHEET", normalBalance: "DEBIT" },
  { value: "WORK_IN_PROGRESS", label: "Work In Progress", category: "BALANCE_SHEET", normalBalance: "DEBIT" },
];

const PNL_RANGES: { key: string; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "purchase", label: "Purchase / Cost of Sales" },
  { key: "income", label: "Income" },
  { key: "expenses", label: "Expenses" },
  { key: "tax", label: "Tax" },
  { key: "extraordinary", label: "Extraordinary Items" },
  { key: "exchangeGainLoss", label: "Exchange Gain / Loss" },
];

const BS_RANGES: { key: string; label: string }[] = [
  { key: "fixedAssets", label: "Fixed Assets" },
  { key: "intangibleAssets", label: "Intangible Assets" },
  { key: "currentAssets", label: "Current Assets" },
  { key: "currentLiabilities", label: "Current Liabilities" },
  { key: "openingStock", label: "Opening Stock" },
  { key: "taxLiabilities", label: "Tax Liabilities (VAT / GST)" },
];

const CONTROL_ACCOUNTS: { key: string; label: string }[] = [
  { key: "creditorControl", label: "Creditor Control Account" },
  { key: "debtorControl", label: "Debtor Control Account" },
  { key: "dividends", label: "Dividends" },
  { key: "shareCapitals", label: "Share Capitals" },
  { key: "provisionForDepreciation", label: "Provision for Depreciation" },
  { key: "retainedProfits", label: "Retained Profits" },
  { key: "capitalReserve", label: "Capital Reserve" },
  { key: "mediumTermLiabilities", label: "Medium Term Liabilities" },
  { key: "longTermLiabilities", label: "Long Term Liabilities" },
  { key: "foreignBankAccount", label: "Foreign Bank Account" },
  { key: "workInProgress", label: "Work In Progress" },
];

interface Props {
  settings: any;
  accounts: Account[];
  loading: boolean;
  onSaveSettings: (updates: any) => Promise<void>;
  onSeedDefaults: () => Promise<void>;
  onCreateAccount: (payload: any) => Promise<void>;
  onUpdateAccount: (id: string, payload: any) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
}

export default function AccountsDefinitionTab({
  settings,
  accounts,
  loading,
  onSaveSettings,
  onSeedDefaults,
  onCreateAccount,
  onUpdateAccount,
  onDeleteAccount,
}: Props) {
  const [ranges, setRanges] = useState<Record<string, { from: string; to: string }>>({});
  const [controls, setControls] = useState<Record<string, string>>({});
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);

  useEffect(() => {
    setRanges(settings?.accountCodeRanges || {});
    setControls(settings?.controlAccounts || {});
  }, [settings]);

  const visibleAccounts = useMemo(
    () => accounts.filter((a) => (showInactive ? true : a.isActive)),
    [accounts, showInactive]
  );

  const updateRange = (key: string, field: "from" | "to", value: string) => {
    setRanges((prev) => ({ ...prev, [key]: { from: prev[key]?.from || "", to: prev[key]?.to || "", [field]: value } }));
  };

  const saveDefinitions = async () => {
    await onSaveSettings({ accountCodeRanges: ranges, controlAccounts: controls });
  };

  const handleDelete = async (acc: Account) => {
    if (!confirm(`Deactivate account ${acc.code} — ${acc.name}?`)) return;
    try {
      await onDeleteAccount(acc.id);
      toast.success("Account deactivated");
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  };

  if (loading && !settings) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* ---------- Code Ranges ---------- */}
      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, color: "primary.main" }}>
          Profit &amp; Loss Items
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
          Code ranges reserved for each P&amp;L section. Accounts created within a range inherit that section.
        </Typography>
        <Grid2 container spacing={2}>
          {PNL_RANGES.map((r) => (
            <RangeRow key={r.key} label={r.label} value={ranges[r.key]} onChange={(f, v) => updateRange(r.key, f, v)} />
          ))}
        </Grid2>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, color: "primary.main" }}>
          Balance Sheet Items
        </Typography>
        <Grid2 container spacing={2}>
          {BS_RANGES.map((r) => (
            <RangeRow key={r.key} label={r.label} value={ranges[r.key]} onChange={(f, v) => updateRange(r.key, f, v)} />
          ))}
        </Grid2>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, color: "primary.main" }}>
          Control Accounts
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
          System-wide reference accounts. These are used when posting to the general ledger from invoices, payments, and tax entries.
        </Typography>
        <Grid2 container spacing={2}>
          {CONTROL_ACCOUNTS.map((c) => (
            <Grid2 key={c.key} size={{ xs: 12, md: 6 }}>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography sx={{ width: 240, fontSize: 14 }}>{c.label}</Typography>
                <TextField
                  size="small"
                  placeholder="e.g. CA001"
                  value={controls[c.key] || ""}
                  onChange={(e) => setControls((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  sx={{ width: 180 }}
                />
              </Stack>
            </Grid2>
          ))}
        </Grid2>
      </Box>

      <Box>
        <Button variant="contained" onClick={saveDefinitions}>
          Save Definitions
        </Button>
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* ---------- Chart of Accounts List ---------- */}
      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "primary.main" }}>
              Chart of Accounts
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {accounts.length} account{accounts.length === 1 ? "" : "s"} defined
            </Typography>
          </Box>
          <Stack direction="row" gap={1} alignItems="center">
            <FormControlLabel
              control={<Switch size="small" checked={showInactive} onChange={(_, v) => setShowInactive(v)} />}
              label="Show inactive"
            />
            {accounts.length === 0 && (
              <Button variant="outlined" onClick={onSeedDefaults}>
                Seed default accounts
              </Button>
            )}
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              Add account
            </Button>
          </Stack>
        </Stack>

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Normal</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Flags</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleAccounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                    No accounts yet — click "Seed default accounts" to start with a standard Singapore chart, or add one manually.
                  </TableCell>
                </TableRow>
              )}
              {visibleAccounts.map((a) => (
                <TableRow key={a.id} hover sx={{ opacity: a.isActive ? 1 : 0.5 }}>
                  <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>{ACCOUNT_TYPES.find((t) => t.value === a.accountType)?.label || a.accountType}</TableCell>
                  <TableCell>{a.category === "PNL" ? "P&L" : "Balance Sheet"}</TableCell>
                  <TableCell>{a.normalBalance}</TableCell>
                  <TableCell>
                    <Stack direction="row" gap={0.5}>
                      {a.isControlAccount && <Chip size="small" label="Control" color="primary" variant="outlined" />}
                      {a.isSystem && <Chip size="small" label="System" variant="outlined" />}
                      {!a.isActive && <Chip size="small" label="Inactive" color="default" />}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => { setEditing(a); setDialogOpen(true); }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={a.isSystem ? "System accounts can only be deactivated" : "Deactivate"}>
                      <span>
                        <IconButton size="small" onClick={() => handleDelete(a)} disabled={!a.isActive}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <AccountDialog
        open={dialogOpen}
        account={editing}
        onClose={() => setDialogOpen(false)}
        onSubmit={async (payload) => {
          try {
            if (editing) await onUpdateAccount(editing.id, payload);
            else await onCreateAccount(payload);
            setDialogOpen(false);
            toast.success(editing ? "Account updated" : "Account created");
          } catch (e: any) {
            toast.error(e?.message || "Save failed");
          }
        }}
      />
    </Box>
  );
}

function RangeRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: { from: string; to: string };
  onChange: (field: "from" | "to", value: string) => void;
}) {
  return (
    <Grid2 size={{ xs: 12, md: 6 }}>
      <Stack direction="row" gap={1} alignItems="center">
        <Typography sx={{ width: 240, fontSize: 14 }}>{label}</Typography>
        <TextField
          size="small"
          placeholder="From"
          value={value?.from || ""}
          onChange={(e) => onChange("from", e.target.value)}
          sx={{ width: 110 }}
        />
        <TextField
          size="small"
          placeholder="To"
          value={value?.to || ""}
          onChange={(e) => onChange("to", e.target.value)}
          sx={{ width: 110 }}
        />
      </Stack>
    </Grid2>
  );
}

function AccountDialog({
  open,
  account,
  onClose,
  onSubmit,
}: {
  open: boolean;
  account: Account | null;
  onClose: () => void;
  onSubmit: (payload: any) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accountType, setAccountType] = useState("SALES");
  const [isControlAccount, setIsControlAccount] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (open) {
      setCode(account?.code || "");
      setName(account?.name || "");
      setDescription(account?.description || "");
      setAccountType(account?.accountType || "SALES");
      setIsControlAccount(!!account?.isControlAccount);
      setIsActive(account?.isActive ?? true);
    }
  }, [open, account]);

  const meta = ACCOUNT_TYPES.find((t) => t.value === accountType)!;

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error("Code and name are required");
      return;
    }
    await onSubmit({
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      accountType,
      category: meta.category,
      normalBalance: meta.normalBalance,
      isControlAccount,
      ...(account ? { isActive } : {}),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{account ? `Edit account ${account.code}` : "Add new account"}</DialogTitle>
      <DialogContent dividers>
        <Stack gap={2} sx={{ pt: 1 }}>
          <TextField
            label="Code"
            size="small"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={!!account?.isSystem}
            helperText={account?.isSystem ? "System accounts have a fixed code" : "e.g. S0001, CA001"}
          />
          <TextField label="Name" size="small" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Description"
            size="small"
            multiline
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <TextField select label="Type" size="small" value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label} — {t.category === "PNL" ? "P&L" : "Balance Sheet"} / {t.normalBalance}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Switch checked={isControlAccount} onChange={(_, v) => setIsControlAccount(v)} />}
            label="Control account"
          />
          {account && (
            <FormControlLabel
              control={<Switch checked={isActive} onChange={(_, v) => setIsActive(v)} />}
              label="Active"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit}>
          {account ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
