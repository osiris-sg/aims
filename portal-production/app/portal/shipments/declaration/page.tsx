/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Declaration — the month Vedanta asks for ("ADH | Aug'26 declaration"):
// Toshiro answers with quantities per customer and grade (SUS 6063 300t, SUS
// 6005 120t, Kato 6063 40t). One grid, one row per customer × grade × qty ×
// contract; "Create orders" makes a supplier order (the PI to come) and a
// customer order under it for every row, in one go. Ship month = the
// declaration month, delivery = +2 months, premiums from the contract's
// schedule (editable here).

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { toast } from "../_lib/toast";
import { useContracts, useCustomers, useSupplierOrders, useTradeMutation } from "../_lib/hooks";
import type { DeclarationResult, DeclarationRow } from "../_lib/api";
import { monthShort } from "../_lib/format";
import LegacyGate from "../_components/LegacyGate";

type GridRow = { key: number; customerId: string; contractId: string; grade: string; size: string; qtyMt: string; clientPremium: string; deliveryMonth: string };

const nextMonth = () => {
  const d = new Date();
  const m = d.getMonth() + 1; // next month (0-based + 1)
  const y = d.getFullYear() + (m === 12 ? 1 : 0);
  return `${y}-${String((m % 12) + 1).padStart(2, "0")}`;
};
const plus2 = (m: string) => {
  if (!/^\d{4}-\d{2}$/.test(m)) return "";
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + 2;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
/** "Average LME of MOSS (Aug'26)" — Vedanta's QP wording. */
const qpFor = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? `Average LME of MOSS (${monthShort(m).replace(" ", "'")})` : "");

let seq = 0;
const blank = (): GridRow => ({ key: ++seq, customerId: "", contractId: "", grade: "", size: "", qtyMt: "", clientPremium: "", deliveryMonth: "" });

function DeclarationPage() {
  const router = useRouter();
  const customers = useCustomers();
  const contracts = useContracts({ pageSize: 100, status: "OPEN" });
  const [month, setMonth] = useState(nextMonth());
  const [qp, setQp] = useState<string | null>(null);
  const [rows, setRows] = useState<GridRow[]>([blank()]);
  const [result, setResult] = useState<DeclarationResult | null>(null);
  const existing = useSupplierOrders({ declarationMonth: month, pageSize: 100 }, /^\d{4}-\d{2}$/.test(month));
  const declare = useTradeMutation((a, body: { month: string; qpBasis?: string | null; rows: DeclarationRow[] }) => a.declare(body));

  const contractList = contracts.data?.items ?? [];
  const contractOf = (id: string) => contractList.find((c) => c.id === id);
  /** The contract's premium for the month (schedule row, else its line of the grade). */
  const premiumHint = (r: GridRow) => {
    const c: any = contractOf(r.contractId);
    if (!c) return "";
    const sched = Array.isArray(c.premiumSchedule) ? c.premiumSchedule.find((p: any) => p.from <= month && (!p.to || p.to >= month)) : null;
    if (sched?.clientPremium != null) return String(sched.clientPremium);
    const line = (c.lines ?? []).find((l: any) => !r.grade || l.grade === r.grade) ?? null;
    return line?.billetPremium ?? line?.clientPremium ?? "";
  };
  const set = (key: number, patch: Partial<GridRow>) => setRows((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const totalMt = useMemo(() => rows.reduce((s, r) => s + (Number(r.qtyMt) || 0), 0), [rows]);
  const problems = rows.flatMap((r, i) => [
    ...(!r.customerId ? [`row ${i + 1}: customer`] : []),
    ...(!r.contractId ? [`row ${i + 1}: contract`] : []),
    ...(!(Number(r.qtyMt) > 0) ? [`row ${i + 1}: quantity`] : []),
  ]);

  const submit = async () => {
    try {
      const out = await declare.mutateAsync({
        month,
        qpBasis: qp ?? qpFor(month),
        rows: rows.map((r) => ({
          customerId: r.customerId,
          contractId: r.contractId,
          grade: r.grade.trim() || null,
          size: r.size.trim() || null,
          qtyMt: Number(r.qtyMt),
          clientPremium: r.clientPremium.trim() ? Number(r.clientPremium) : null,
          deliveryMonth: r.deliveryMonth || null,
        })),
      });
      setResult(out);
      setRows([blank()]);
      toast.success(`${out.created.length} supplier order(s) and customer order(s) created`);
    } catch (e: any) {
      toast.error(e?.message || "Could not create the orders");
    }
  };

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1200, mx: "auto" }} data-tour="declaration-page">
      <Typography variant="h5" sx={{ fontWeight: 800 }}>
        Declaration
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The month&apos;s quantities per customer and grade (your reply to Vedanta&apos;s declaration). &quot;Create orders&quot; makes a supplier order (its PI comes next) and a customer order under it for every row.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField size="small" type="month" label="Declaration month" InputLabelProps={{ shrink: true }} value={month} onChange={(e) => setMonth(e.target.value)} />
          <TextField size="small" sx={{ minWidth: 320 }} label="QP basis" value={qp ?? qpFor(month)} onChange={(e) => setQp(e.target.value)} helperText="Printed on the PI; stored on each supplier order" />
        </Stack>
        {(existing.data?.items ?? []).length > 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Already made for {monthShort(month)}:{" "}
            {existing.data!.items.map((so) => `${so.label} (${so.contractNo ?? "no contract"} · ${so.grade ?? ""} · ${so.customerOrders.map((o) => `${o.label} ${o.customerName ?? ""}`).join(", ")})`).join("; ")}
          </Alert>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small" data-tour="declaration-grid">
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 180 }}>Customer</TableCell>
              <TableCell sx={{ minWidth: 200 }}>Contract</TableCell>
              <TableCell sx={{ minWidth: 90 }}>Grade</TableCell>
              <TableCell sx={{ minWidth: 110 }}>Size</TableCell>
              <TableCell sx={{ minWidth: 100 }} align="right">
                Qty (MT)
              </TableCell>
              <TableCell sx={{ minWidth: 120 }} align="right">
                Client premium
              </TableCell>
              <TableCell sx={{ minWidth: 130 }}>Delivery month</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const forCustomer = contractList.filter((c) => !r.customerId || c.customer?.id === r.customerId);
              return (
                <TableRow key={r.key}>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      value={r.customerId}
                      onChange={(e) => {
                        const only = contractList.filter((c) => c.customer?.id === e.target.value);
                        set(r.key, { customerId: e.target.value, contractId: only.length === 1 ? only[0].id : "" });
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
                        const c: any = contractOf(e.target.value);
                        set(r.key, { contractId: e.target.value, customerId: r.customerId || c?.customer?.id || "", grade: r.grade || c?.lines?.[0]?.grade || "" });
                      }}
                    >
                      {forCustomer.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {[c.contractNo, c.customer?.name, c.linesSummary].filter(Boolean).join(" · ")}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField fullWidth size="small" value={r.grade} onChange={(e) => set(r.key, { grade: e.target.value })} placeholder="6063" />
                  </TableCell>
                  <TableCell>
                    <TextField fullWidth size="small" value={r.size} onChange={(e) => set(r.key, { size: e.target.value })} placeholder="8 inch" />
                  </TableCell>
                  <TableCell>
                    <TextField fullWidth size="small" type="number" value={r.qtyMt} onChange={(e) => set(r.key, { qtyMt: e.target.value })} inputProps={{ style: { textAlign: "right" } }} />
                  </TableCell>
                  <TableCell>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      value={r.clientPremium}
                      placeholder={String(premiumHint(r) ?? "")}
                      onChange={(e) => set(r.key, { clientPremium: e.target.value })}
                      inputProps={{ style: { textAlign: "right" } }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField fullWidth size="small" type="month" value={r.deliveryMonth || plus2(month)} onChange={(e) => set(r.key, { deliveryMonth: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" aria-label="Remove row" disabled={rows.length === 1} onClick={() => setRows((xs) => xs.filter((x) => x.key !== r.key))}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ p: 1.5 }}>
          <Button startIcon={<AddIcon />} onClick={() => setRows((xs) => [...xs, blank()])}>
            Add row
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {rows.length} row(s) · {totalMt.toLocaleString("en-US", { maximumFractionDigits: 3 })} MT
          </Typography>
          <Button variant="contained" disabled={!!problems.length || declare.isPending} onClick={submit} data-tour="declaration-create">
            Create orders
          </Button>
        </Stack>
        {problems.length > 0 && rows.some((r) => r.customerId || r.contractId || r.qtyMt) && (
          <Alert severity="warning" sx={{ m: 1.5, mt: 0 }}>
            Still needed: {problems.join(", ")}
          </Alert>
        )}
      </Paper>

      {result && (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Created
          </Typography>
          <Stack spacing={0.5}>
            {result.created.map((c) => (
              <Stack key={c.orderId} direction="row" spacing={1} alignItems="center">
                <Button size="small" onClick={() => router.push(`/portal/shipments/orders/${c.orderId}`)}>
                  Order {c.orderLabel} · {c.customerName}
                </Button>
                <Button size="small" onClick={() => router.push(`/portal/shipments/supplier-orders/${c.supplierOrderId}`)}>
                  Supplier order
                </Button>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}

/** Hidden since round H (enableTradeLegacyPages, off by default). */
export default function GatedDeclarationPage() {
  return (
    <LegacyGate what="The Declaration page">
      <DeclarationPage />
    </LegacyGate>
  );
}
