"use client";

// One order's cash: what ADH paid out (PI deposit, CI, import tax, logistics)
// against what came in (its customer invoices), each invoice with what is
// still outstanding and an overdue badge. "Record receipt" opens the payment
// dialog on that invoice.

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useShipmentsApi } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { fmtDmy } from "../_lib/format";
import PaymentDialog, { type PaymentContext } from "./PaymentDialog";

const money = (v: number, c = "USD") => `${c} ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const totals = (m: Record<string, number>) => (Object.keys(m).length ? Object.entries(m).map(([c, v]) => money(v, c)).join(" + ") : "—");

export default function OrderCashPanel({ orderId, canEdit, showMoney = true }: { orderId: string; canEdit: boolean; showMoney?: boolean }) {
  const api = useShipmentsApi();
  const q = useQuery({ queryKey: [...SHIPMENT_KEYS.orders, "cash", orderId], queryFn: () => api.orderCash(orderId) });
  const [ctx, setCtx] = useState<PaymentContext | null>(null);
  if (!showMoney || q.isLoading || !q.data) return null;
  const c = q.data;
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="order-cash">
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          Cash
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Out {totals(c.totals.out)} · In {totals(c.totals.in)}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Customer invoices
      </Typography>
      {!c.invoices.length ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No finalized invoice yet.
        </Typography>
      ) : (
        <Table size="small" sx={{ mb: 2 }}>
          <TableHead>
            <TableRow>
              <TableCell>Invoice</TableCell>
              <TableCell>Due</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell align="right">Received</TableCell>
              <TableCell align="right">Outstanding</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {c.invoices.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.label}</TableCell>
                <TableCell>
                  {i.dueDate ? fmtDmy(i.dueDate) : "—"} {i.overdue && <Chip size="small" color="error" label={`overdue ${i.daysOverdue}d`} sx={{ ml: 0.5 }} />}
                </TableCell>
                <TableCell align="right">{money(i.total)}</TableCell>
                <TableCell align="right">{money(i.paid)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {money(i.outstanding)}
                </TableCell>
                <TableCell align="right">
                  {canEdit && i.outstanding > 0.004 && (
                    <Button size="small" onClick={() => setCtx({ direction: "IN", target: { targetType: "INVOICE", targetId: i.id, label: i.label, amount: i.outstanding, currency: "USD" } })}>
                      Record receipt
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
        {(["cashOut", "cashIn"] as const).map((k) => (
          <Box key={k}>
            <Typography variant="caption" color="text.secondary">
              {k === "cashOut" ? "Paid out (supplier, tax, logistics)" : "Received"}
            </Typography>
            {!c[k].length ? (
              <Typography variant="body2" color="text.secondary">
                —
              </Typography>
            ) : (
              c[k].map((l, idx) => (
                <Typography key={`${l.paymentId}-${idx}`} variant="body2">
                  {fmtDmy(l.paidAt)} · {l.label} · <b>{money(l.amount, l.currency)}</b> · {l.account}
                </Typography>
              ))
            )}
          </Box>
        ))}
      </Box>
      <PaymentDialog open={!!ctx} context={ctx ?? undefined} onClose={() => setCtx(null)} />
    </Paper>
  );
}
