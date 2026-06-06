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
import { useAccountingApi } from "../../_lib/api";

type Account = {
  id: string;
  code: string;
  name: string;
  category: "PNL" | "BALANCE_SHEET";
  normalBalance: "DEBIT" | "CREDIT";
  isActive: boolean;
};

type LineForm = {
  uid: string;
  accountId: string | null;
  description: string;
  debit: string;
  credit: string;
};

const FREQUENCIES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
];

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const newLine = (): LineForm => ({
  uid: Math.random().toString(36).slice(2),
  accountId: null,
  description: "",
  debit: "",
  credit: "",
});

export default function RecurringTemplateDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useAccountingApi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [frequency, setFrequency] = useState<string>("MONTHLY");
  const [nextRunDate, setNextRunDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>("");
  const [lines, setLines] = useState<LineForm[]>([newLine(), newLine()]);

  const loadAccounts = useCallback(async () => {
    try {
      const list = await request<Account[]>("/accounting/accounts");
      setAccounts((list || []).filter((a) => a.isActive).sort((a, b) => a.code.localeCompare(b.code)));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load accounts");
    }
  }, [request]);

  useEffect(() => {
    if (!open) return;
    loadAccounts();
    if (editing) {
      setName(editing.name || "");
      setDescription(editing.description || "");
      setReference(editing.reference || "");
      setFrequency(editing.frequency || "MONTHLY");
      setNextRunDate(editing.nextRunDate ? editing.nextRunDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
      setEndDate(editing.endDate ? editing.endDate.slice(0, 10) : "");
      const lineRows = (Array.isArray(editing.lines) ? editing.lines : []).map((l: any) => ({
        uid: Math.random().toString(36).slice(2),
        accountId: l.accountId,
        description: l.description || "",
        debit: l.debit ? String(l.debit) : "",
        credit: l.credit ? String(l.credit) : "",
      }));
      setLines(lineRows.length >= 2 ? lineRows : [newLine(), newLine()]);
    } else {
      setName("");
      setDescription("");
      setReference("");
      setFrequency("MONTHLY");
      setNextRunDate(new Date().toISOString().slice(0, 10));
      setEndDate("");
      setLines([newLine(), newLine()]);
    }
  }, [open, editing, loadAccounts]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.round((debit - credit) * 100) === 0 && debit > 0 };
  }, [lines]);

  const updateLine = (uid: string, patch: Partial<LineForm>) => {
    setLines((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };

  const onDebitChange = (uid: string, v: string) => {
    updateLine(uid, { debit: v, credit: v ? "" : lines.find((l) => l.uid === uid)?.credit ?? "" });
  };
  const onCreditChange = (uid: string, v: string) => {
    updateLine(uid, { credit: v, debit: v ? "" : lines.find((l) => l.uid === uid)?.debit ?? "" });
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("Name is required");
    if (!totals.balanced) return toast.error(`Out of balance — debits ${fmt(totals.debit)}, credits ${fmt(totals.credit)}`);
    if (lines.some((l) => !l.accountId)) return toast.error("Every line needs an account");

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description || undefined,
        reference: reference || undefined,
        frequency,
        nextRunDate,
        endDate: endDate || null,
        lines: lines.map((l) => ({
          accountId: l.accountId!,
          description: l.description || undefined,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
        })),
      };
      if (editing) {
        await request(`/recurring-journals/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        toast.success("Template updated");
      } else {
        await request("/recurring-journals", { method: "POST", body: JSON.stringify(body) });
        toast.success("Template created");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="lg">
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {editing ? "Edit Recurring Template" : "New Recurring Template"}
          </Typography>
          <IconButton onClick={onClose} size="small" disabled={saving}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr 1fr", md: "2fr 1fr 1fr 1fr" },
            gap: 2,
            mb: 2,
          }}
        >
          <TextField
            size="small"
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            required
          />
          <TextField
            select
            size="small"
            label="Frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            disabled={saving}
          >
            {FREQUENCIES.map((f) => (
              <MenuItem key={f.value} value={f.value}>
                {f.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="Next Run"
            InputLabelProps={{ shrink: true }}
            value={nextRunDate}
            onChange={(e) => setNextRunDate(e.target.value)}
            disabled={saving}
          />
          <TextField
            size="small"
            type="date"
            label="End Date (optional)"
            InputLabelProps={{ shrink: true }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={saving}
          />
          <TextField
            size="small"
            label="Reference (optional)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={saving}
            sx={{ gridColumn: { xs: "1 / -1", md: "1 / 3" } }}
          />
          <TextField
            size="small"
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
            sx={{ gridColumn: { xs: "1 / -1", md: "3 / -1" } }}
          />
        </Box>

        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700, width: 40 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 700, width: "35%" }}>Account</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 140 }}>Debit</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 140 }}>Credit</TableCell>
                <TableCell sx={{ width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((line, i) => {
                const selected = accounts.find((a) => a.id === line.accountId) || null;
                return (
                  <TableRow key={line.uid}>
                    <TableCell sx={{ color: "text.secondary" }}>{i + 1}</TableCell>
                    <TableCell>
                      <Autocomplete
                        size="small"
                        options={accounts}
                        value={selected}
                        onChange={(_, v) => updateLine(line.uid, { accountId: v?.id ?? null })}
                        getOptionLabel={(o) => `${o.code} — ${o.name}`}
                        renderInput={(params) => <TextField {...params} placeholder="Pick an account" disabled={saving} />}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Line memo"
                        value={line.description}
                        onChange={(e) => updateLine(line.uid, { description: e.target.value })}
                        disabled={saving}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        type="number"
                        inputProps={{ step: "0.01", min: 0, style: { textAlign: "right", fontFamily: "monospace" } }}
                        value={line.debit}
                        onChange={(e) => onDebitChange(line.uid, e.target.value)}
                        disabled={saving}
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
                        disabled={saving}
                        sx={{ width: 130 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Tooltip title={lines.length <= 2 ? "At least 2 lines required" : "Remove line"}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => setLines((rows) => (rows.length <= 2 ? rows : rows.filter((r) => r.uid !== line.uid)))}
                            disabled={lines.length <= 2 || saving}
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
          <Button startIcon={<AddIcon />} size="small" onClick={() => setLines((rows) => [...rows, newLine()])} disabled={saving}>
            Add line
          </Button>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" gap={3} alignItems="center">
            <Typography variant="body2" sx={{ color: "text.secondary" }}>Totals:</Typography>
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
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={saving || !totals.balanced}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {editing ? "Save changes" : "Create template"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
