"use client";

// Warehouse stock: per warehouse, every shipment in store — bundles in (PL /
// B/L) − delivered (出庫・納入依頼書 rows marked delivered) = in stock, the
// storage periods (期, half-months) since the storage start, and the storage
// fee estimate (periods × MT in stock × the org's ¥/MT rate). Set the
// warehouse and storage start on the shipment's Details tab.

import React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, CircularProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useShipmentsApi } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { fmtDmy, fmtYen } from "../_lib/format";

export default function StockPage() {
  const api = useShipmentsApi();
  const router = useRouter();
  const q = useQuery({ queryKey: [...SHIPMENT_KEYS.orders, "stock"], queryFn: () => api.stock() });
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1300, mx: "auto" }} data-tour="stock-page">
      <Typography variant="h5" sx={{ fontWeight: 800 }}>
        Warehouse stock
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Bundles in − delivered (SI rows ticked delivered) = in stock. Storage counts every half-month period (期) started; fee estimate at ¥{q.data?.ratePerMtPerPeriod ?? "—"}/MT per period.
      </Typography>
      {q.isLoading ? (
        <CircularProgress size={24} />
      ) : q.isError || !q.data ? (
        <Alert severity="error">Could not load the stock</Alert>
      ) : !q.data.warehouses.length ? (
        <Alert severity="info">Nothing in store — set a shipment&apos;s warehouse and storage start on its Details tab.</Alert>
      ) : (
        q.data.warehouses.map((w) => (
          <Paper key={w.warehouse} variant="outlined" sx={{ mb: 2, overflowX: "auto" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, px: 2, pt: 1.5 }}>
              {w.warehouse} · {w.bundlesInStock} bundles · {w.netMtInStock.toLocaleString("en-US", { maximumFractionDigits: 3 })} MT · est. {fmtYen(w.storageFeeEstimate)}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Shipment</TableCell>
                  <TableCell>Customer</TableCell>
                  <TableCell align="right">In</TableCell>
                  <TableCell align="right">Delivered</TableCell>
                  <TableCell align="right">In stock</TableCell>
                  <TableCell align="right">MT in stock</TableCell>
                  <TableCell>Storage since</TableCell>
                  <TableCell align="right">Periods (期)</TableCell>
                  <TableCell align="right">Fee estimate</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {w.items.map((l) => (
                  <TableRow key={l.shipmentId} hover sx={{ cursor: "pointer" }} onClick={() => router.push(`/portal/shipments/${l.shipmentId}`)}>
                    <TableCell sx={{ fontWeight: 700 }}>
                      {l.ref} {l.blNumber ? `· ${l.blNumber}` : ""}
                    </TableCell>
                    <TableCell>{l.customerName ?? "—"}</TableCell>
                    <TableCell align="right">{l.bundlesIn ?? "—"}</TableCell>
                    <TableCell align="right">{l.bundlesDelivered}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>
                      {l.bundlesInStock ?? "—"}
                    </TableCell>
                    <TableCell align="right">{l.netMtInStock ?? "—"}</TableCell>
                    <TableCell>{l.storageStartDate ? fmtDmy(l.storageStartDate) : "—"}</TableCell>
                    <TableCell align="right">{l.periods || "—"}</TableCell>
                    <TableCell align="right">{fmtYen(l.storageFeeEstimate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        ))
      )}
    </Box>
  );
}
