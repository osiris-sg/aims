"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";

type Account = {
  id: string;
  code: string;
  name: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
  isActive: boolean;
};

type Line = {
  uid: string;
  accountId: string | null;
  description: string;
  debit: string; // string in form state to allow empty input
  credit: string;
};

const TYPES = [
  { value: "MANUAL", label: "Manual Voucher" },
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "OPENING_BALANCE", label: "Opening Balance" },
];

const newLine = (): Line => ({
  uid: Math.random().toString(36).slice(2),
  accountId: null,
  description: "",
  debit: "",
  credit: "",
});

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

export default function JournalEntryDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const { request } = useAccountingApi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [saving, setSaving] = useState<"draft" | "post" | null>(null);

  const [date, setDate] = useState<string>(today);
  const [type, setType] = useState<string>("MANUAL");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine(), newLine()]);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const list = await request<Account[]>("/accounting/accounts");
      setAccounts((list || []).filter((a) => a.isActive).sort((a, b) => a.code.localeCompare(b.code)));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load chart of accounts");
    } finally {
      setLoadingAccounts(false);
    }
  }, [request]);

  useEffect(() => {
    if (open) {
      loadAccounts();
      // Reset form each time the dialog opens
      setDate(today());
      setType("MANUAL");
      setReference("");
      setDescription("");
      setLines([newLine(), newLine()]);
    }
  }, [open, loadAccounts]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    // Round to 2dp for the balanced check — float maths bites here otherwise.
    const balanced = Math.round((debit - credit) * 100) === 0 && debit > 0;
    return { debit, credit, balanced };
  }, [lines]);

  const updateLine = (uid: string, patch: Partial<Line>) => {
    setLines((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };

  const addLine = () => setLines((rows) => [...rows, newLine()]);

  const removeLine = (uid: string) => {
    setLines((rows) => (rows.length <= 2 ? rows : rows.filter((r) => r.uid !== uid)));
  };

  // When user types a debit, blank the credit (and vice versa) so a single line
  // can't have both — matches the convention every accounting tool enforces.
  const onDebitChange = (uid: string, v: string) => {
    updateLine(uid, { debit: v, credit: v ? "" : lines.find((l) => l.uid === uid)?.credit ?? "" });
  };
  const onCreditChange = (uid: string, v: string) => {
    updateLine(uid, { credit: v, debit: v ? "" : lines.find((l) => l.uid === uid)?.debit ?? "" });
  };

  const validate = (): string | null => {
    if (!date) return "Entry date is required";
    if (lines.length < 2) return "Need at least 2 lines";
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.accountId) return `Line ${i + 1}: pick an account`;
      const d = parseFloat(l.debit) || 0;
      const c = parseFloat(l.credit) || 0;
      if (d === 0 && c === 0) return `Line ${i + 1}: enter a debit or credit amount`;
      if (d > 0 && c > 0) return `Line ${i + 1}: a line can't have both debit and credit`;
    }
    if (!totals.balanced) return `Out of balance — Debits ${fmt(totals.debit)}, Credits ${fmt(totals.credit)}`;
    return null;
  };

  const submit = async (action: "draft" | "post") => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(action);
    try {
      const body = {
        entryDate: date,
        type,
        reference: reference || undefined,
        description: description || undefined,
        lines: lines.map((l) => ({
          accountId: l.accountId!,
          description: l.description || undefined,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
        })),
      };
      const created = await request<{ id: string; journalNumber: string }>("/journal/entries", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (action === "post") {
        await request(`/journal/entries/${created.id}/post`, { method: "POST" });
        toast.success(`Posted ${created.journalNumber}`);
      } else {
        toast.success(`Draft ${created.journalNumber} saved`);
      }

      onCreated?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create journal entry");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="lg">
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            New Journal Entry
          </Typography>
          <IconButton onClick={onClose} size="small" disabled={!!saving}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {/* Header fields */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr 1fr", md: "auto auto 1fr 1fr" },
            gap: 2,
            mb: 2,
          }}
        >
          <TextField
            size="small"
            type="date"
            label="Date"
            InputLabelProps={{ shrink: true }}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!!saving}
          />
          <TextField
            select
            size="small"
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={!!saving}
            sx={{ minWidth: 180 }}
          >
            {TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Reference"
            placeholder="e.g. INV-2026-001 / Depreciation May"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={!!saving}
          />
          <TextField
            size="small"
            label="Description"
            placeholder="What this entry is for"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!!saving}
          />
        </Box>

        {/* Lines table */}
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700, width: 40 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 700, width: "35%" }}>Account</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 140 }}>
                  Debit
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 140 }}>
                  Credit
                </TableCell>
                <TableCell sx={{ width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line, i) => {
                const selectedAccount = accounts.find((a) => a.id === line.accountId) || null;
                return (
                  <TableRow key={line.uid}>
                    <TableCell sx={{ color: "text.secondary" }}>{i + 1}</TableCell>
                    <TableCell>
                      <Autocomplete
                        size="small"
                        options={accounts}
                        value={selectedAccount}
                        loading={loadingAccounts}
                        onChange={(_, v) => updateLine(line.uid, { accountId: v?.id ?? null })}
                        getOptionLabel={(o) => `${o.code} — ${o.name}`}
                        renderInput={(params) => (
                          <TextField {...params} placeholder="Pick an account" disabled={!!saving} />
                        )}
                        renderOption={(props, option) => (
                          <Box component="li" {...props}>
                            <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 600, mr: 1 }}>
                              {option.code}
                            </Typography>
                            <Typography component="span">{option.name}</Typography>
                            <Typography
                              component="span"
                              sx={{ ml: "auto", fontSize: "0.7rem", color: "text.secondary" }}
                            >
                              {option.category === "PNL" ? "P&L" : "BS"}
                            </Typography>
                          </Box>
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Line memo"
                        value={line.description}
                        onChange={(e) => updateLine(line.uid, { description: e.target.value })}
                        disabled={!!saving}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="number"
                        inputProps={{ step: "0.01", min: 0, style: { textAlign: "right", fontFamily: "monospace" } }}
                        value={line.debit}
                        onChange={(e) => onDebitChange(line.uid, e.target.value)}
                        disabled={!!saving}
                        sx={{ width: 130 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="number"
                        inputProps={{ step: "0.01", min: 0, style: { textAlign: "right", fontFamily: "monospace" } }}
                        value={line.credit}
                        onChange={(e) => onCreditChange(line.uid, e.target.value)}
                        disabled={!!saving}
                        sx={{ width: 130 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Tooltip title={lines.length <= 2 ? "At least 2 lines required" : "Remove line"}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => removeLine(line.uid)}
                            disabled={lines.length <= 2 || !!saving}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>

        <Stack direction="row" alignItems="center" gap={2} sx={{ mt: 1.5 }}>
          <Button startIcon={<AddIcon />} size="small" onClick={addLine} disabled={!!saving}>
            Add line
          </Button>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" gap={3} alignItems="center">
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Totals:
            </Typography>
            <Typography sx={{ fontFamily: "monospace", fontWeight: 700, minWidth: 100, textAlign: "right" }}>
              {fmt(totals.debit)}
            </Typography>
            <Typography sx={{ fontFamily: "monospace", fontWeight: 700, minWidth: 100, textAlign: "right" }}>
              {fmt(totals.credit)}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              color={totals.balanced ? "success" : "error"}
              label={totals.balanced ? "Balanced ✓" : "Out of balance"}
              sx={{ fontWeight: 700 }}
            />
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={!!saving}>
          Cancel
        </Button>
        <Button
          onClick={() => submit("draft")}
          variant="outlined"
          disabled={!!saving}
          startIcon={saving === "draft" ? <CircularProgress size={14} /> : undefined}
        >
          Save as Draft
        </Button>
        <Button
          onClick={() => submit("post")}
          variant="contained"
          disabled={!!saving || !totals.balanced}
          startIcon={saving === "post" ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          Save & Post
        </Button>
      </DialogActions>
    </Dialog>
  );
}
