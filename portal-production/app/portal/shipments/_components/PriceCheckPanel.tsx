"use client";

// Price check (contract master): the unit price the contract says — LME of the
// basis month + premium (+ QMJP) — next to what the PI / CI / invoice says,
// each line ✓ / ✗ with the difference. Read-only: it never changes a value.

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useShipmentsApi } from "../_lib/api";

const usd = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function PriceCheckPanel({ kind, id, title }: { kind: "supplier-order" | "shipment" | "generated"; id: string; title?: string }) {
  const api = useShipmentsApi();
  const q = useQuery({ queryKey: ["trade-orders", "price-check", kind, id], queryFn: () => api.priceCheck(kind, id), staleTime: 30_000 });
  if (q.isLoading) return null;
  if (q.isError || !q.data) return <Alert severity="warning">Price check unavailable: {(q.error as Error)?.message ?? "no data"}</Alert>;
  const c = q.data;
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-tour="price-check-panel">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {title ?? "Price check vs contract"} {c.basisMonth ? `· basis ${c.basisMonth}` : ""}
        </Typography>
        <Chip size="small" color={c.ok ? "success" : "warning"} variant="outlined" label={c.ok ? "Matches the contract" : "Check the differences"} />
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr", columnGap: 2, rowGap: 0.5, alignItems: "center" }}>
        <Typography variant="caption" color="text.secondary">
          Item
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right" }}>
          Expected
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right" }}>
          On the document
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right" }}>
          Difference
        </Typography>
        {c.lines.map((l) => (
          <React.Fragment key={l.key}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              {l.mark === "ok" ? <CheckCircleIcon fontSize="small" color="success" /> : l.mark === "diff" ? <CancelIcon fontSize="small" color="error" /> : <HelpOutlineIcon fontSize="small" color="disabled" />}
              <Typography variant="body2">{l.label}</Typography>
            </Stack>
            <Typography variant="body2" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {usd(l.expected)}
            </Typography>
            <Typography variant="body2" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {usd(l.found)}
            </Typography>
            <Typography variant="body2" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: l.mark === "diff" ? "error.main" : undefined }}>
              {l.diff === null ? "—" : `${l.diff > 0 ? "+" : ""}${usd(l.diff)}`}
            </Typography>
          </React.Fragment>
        ))}
      </Box>
      {(c.notes.length > 0 || c.source) && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          {[`From ${c.source}`, ...c.notes].join(" · ")}
        </Typography>
      )}
    </Paper>
  );
}
