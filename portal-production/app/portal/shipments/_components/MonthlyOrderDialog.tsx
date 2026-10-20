/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// "+ New monthly order" (Orders, round H): the month's quantities in a small
// grid — one row per customer × grade × size × qty × contract. Saving makes
// one order per row, all shipping in the month (delivery = +2 months),
// premiums from the contract's schedule / line for that month. One request:
// a bad row creates nothing.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { toast } from "../_lib/toast";
import { useContracts, useCustomers, useTradeMutation } from "../_lib/hooks";
import type { MonthlyOrderRow } from "../_lib/api";
import { guardDate, tradeDateError } from "../_lib/dates";

type Draft = { key: number; customerId: string; contractId: string; grade: string; size: string; qtyMt: string; clientPremium: string };

const nextMonth = () => {
  const d = new Date();
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return m.toISOString().slice(0, 7);
};
let seq = 0;
const blank = (): Draft => ({ key: ++seq, customerId: "", contractId: "", grade: "", size: "", qtyMt: "", clientPremium: "" });

export default function MonthlyOrderDialog({ open, onClose, onImportPis }: { open: boolean; onClose: () => void; /** "Import from PI PDFs…": the bulk PI reader (one order per PI). */ onImportPis?: () => void }) {
  const customers = useCustomers(open);
  const contracts = useContracts({ pageSize: 100 }, open);
  const [month, setMonth] = useState(nextMonth());
  const [rows, setRows] = useState<Draft[]>([blank()]);
  const save = useTradeMutation((a, body: { month: string; rows: MonthlyOrderRow[] }) => a.createMonthlyOrders(body));

  useEffect(() => {
    if (open) {
      setMonth(nextMonth());
      setRows([blank(), blank()]);
    }
  }, [open]);

  const allContracts = useMemo(() => (contracts.data?.items ?? []).filter((c) => c.status !== "CANCELLED"), [contracts.data]);
  const set = (key: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.customerId || r.contractId || r.qtyMt);
  const problems = filled.flatMap((r, i) => [
    ...(!r.customerId ? [`row ${i + 1}: customer`] : []),
    ...(!r.contractId ? [`row ${i + 1}: contract`] : []),
    ...(!(Number(r.qtyMt) > 0) ? [`row ${i + 1}: quantity`] : []),
  ]);
  const monthBad = !/^\d{4}-\d{2}$/.test(month) || !!tradeDateError(month);
  const totalMt = filled.reduce((s, r) => s + (Number(r.qtyMt) || 0), 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        New monthly order
        <Typography variant="body2" color="text.secondary">
          One order per row, all shipping in the month (delivery two months later). Premiums come from the contract for that month unless typed.
        </Typography>
      </DialogTitle>
      <DialogContent dividers data-tour="monthly-order-grid">
        <TextField size="small" label="Ship month" value={month} onChange={(e) => setMonth(e.target.value)} sx={{ mb: 2, width: 200 }} {...guardDate({ type: "month", InputLabelProps: { shrink: true }, helperText: " " }, month)} />
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ minWidth: 860 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 200 }}>Customer</TableCell>
                <TableCell sx={{ width: 220 }}>Contract</TableCell>
                <TableCell sx={{ width: 110 }}>Grade</TableCell>
                <TableCell sx={{ width: 160 }}>Size</TableCell>
                <TableCell sx={{ width: 110 }}>Qty (MT)</TableCell>
                <TableCell sx={{ width: 130 }}>Client premium</TableCell>
                <TableCell sx={{ width: 40 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const forCustomer = allContracts.filter((c) => !r.customerId || c.customer?.id === r.customerId);
                const contract = allContracts.find((c) => c.id === r.contractId);
                const grades = [...new Set((contract?.lines ?? []).map((l) => l.grade).filter(Boolean) as string[])];
                return (
                  <TableRow key={r.key}>
                    <TableCell>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        value={r.customerId}
                        onChange={(e) => {
                          const c = allContracts.filter((x) => x.customer?.id === e.target.value);
                          set(r.key, { customerId: e.target.value, contractId: c.length === 1 ? c[0].id : "" });
                        }}
                      >
                        {(customers.data ?? []).map((c) => (
                          <MenuItem key={c.id} value={c.id}>
                            {c.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        value={r.contractId}
                        onChange={(e) => {
                          const c = allContracts.find((x) => x.id === e.target.value);
                          const line = c?.lines.length === 1 ? c.lines[0] : null;
                          set(r.key, { contractId: e.target.value, customerId: r.customerId || c?.customer?.id || "", grade: r.grade || line?.grade || "", size: r.size || line?.sizeSpec || "" });
                        }}
                      >
                        {forCustomer.map((c) => (
                          <MenuItem key={c.id} value={c.id}>
                            {c.contractNo}
                            {c.linesSummary ? ` · ${c.linesSummary}` : ""}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <TextField
                        fullWidth
                        size="small"
                        value={r.grade}
                        onChange={(e) => {
                          const line = contract?.lines.find((l) => l.grade === e.target.value);
                          set(r.key, { grade: e.target.value, size: r.size || line?.sizeSpec || "" });
                        }}
                        inputProps={{ list: `grades-${r.key}` }}
                        placeholder={grades[0] ?? "6063"}
                      />
                      <datalist id={`grades-${r.key}`}>
                        {grades.map((g) => (
                          <option key={g} value={g} />
                        ))}
                      </datalist>
                    </TableCell>
                    <TableCell>
                      <TextField fullWidth size="small" value={r.size} onChange={(e) => set(r.key, { size: e.target.value })} placeholder="203 MM X 5800 MM" />
                    </TableCell>
                    <TableCell>
                      <TextField fullWidth size="small" type="number" value={r.qtyMt} onChange={(e) => set(r.key, { qtyMt: e.target.value })} inputProps={{ min: 0, step: "0.001" }} />
                    </TableCell>
                    <TableCell>
                      <TextField fullWidth size="small" type="number" value={r.clientPremium} onChange={(e) => set(r.key, { clientPremium: e.target.value })} placeholder="contract" />
                    </TableCell>
                    <TableCell>
                      <IconButton size="small" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 1 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, blank()])}>
            Add row
          </Button>
          <Typography variant="body2" color="text.secondary">
            {filled.length} order{filled.length === 1 ? "" : "s"} · {totalMt.toLocaleString("en-US", { maximumFractionDigits: 3 })} MT
          </Typography>
        </Stack>
        {/* Space reserved for the message so the grid doesn't jump while typing. */}
        <Box sx={{ minHeight: 52, mt: 1 }}>
          {filled.length > 0 && problems.length > 0 && (
            <Alert severity="info" sx={{ py: 0 }}>
              Still needed: {problems.join(", ")}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {onImportPis && (
          <Button startIcon={<AutoAwesomeIcon />} onClick={onImportPis} sx={{ mr: "auto" }} data-tour="monthly-order-import-pis">
            Import from PI PDFs…
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!filled.length || problems.length > 0 || monthBad || save.isPending}
          onClick={async () => {
            try {
              const out = await save.mutateAsync({
                month,
                rows: filled.map((r) => ({
                  customerId: r.customerId,
                  contractId: r.contractId,
                  grade: r.grade.trim() || null,
                  size: r.size.trim() || null,
                  qtyMt: Number(r.qtyMt),
                  clientPremium: r.clientPremium === "" ? null : Number(r.clientPremium),
                })),
              });
              toast.success(`Created ${out.created.map((o) => o.label).join(", ")}`);
              onClose();
            } catch (e: any) {
              toast.error(e?.message || "Could not create the orders");
            }
          }}
        >
          Create {filled.length || ""} order{filled.length === 1 ? "" : "s"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
