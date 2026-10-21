"use client";

// Round N — the Vedanta PI table → the month's orders (kept from the old details window; round T moved it here).
import React, { useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type InboxRow } from "../../_lib/api";
import { toast } from "../../_lib/toast";

export function PiTablePanel({ row, onApplied }: { row: InboxRow; onApplied: (r: InboxRow) => void }) {
  const api = useShipmentsApi();
  const plan = useQuery({ queryKey: ["trade-orders", "pi-table", row.id, (row.supplierOrderResults ?? []).length], queryFn: () => api.inboxPiTable(row.id) });
  const [busy, setBusy] = useState(false);
  const fieldText = (f: Record<string, string | number>) =>
    Object.entries(f)
      .map(([k, v]) => (k === "piNo" ? `PI no. ${v}` : k === "piAmount" ? `PI amount ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : `${k} ${v}`))
      .join(", ");
  return (
    <Box data-tour="inbox-pi-table">
      <Typography variant="overline" color="text.secondary">
        Vedanta&apos;s PI table → the month&apos;s orders
      </Typography>
      {plan.isLoading ? (
        <CircularProgress size={18} />
      ) : (
        (plan.data?.rows ?? []).map((p, i) => (
          <Typography key={i} variant="body2">
            • {p.row.grade ?? "—"} · {p.row.contractNo} · {p.row.qtyMt ?? "—"} MT · PI {p.row.piNo ?? "—"} →{" "}
            {p.orderLabel ? (
              <b>
                {p.orderLabel}
                {Object.keys(p.fields).length ? `: fill ${fieldText(p.fields)}` : " (already filled)"}
              </b>
            ) : (
              <span style={{ opacity: 0.7 }}>{p.reason}</span>
            )}
          </Typography>
        ))
      )}
      {(row.supplierOrderResults ?? []).map((r, i) => (
        <Typography key={`r${i}`} variant="caption" color="text.secondary" component="div">
          {r.contractNo} {r.piNo ? `PI ${r.piNo}` : ""}
          {r.orderLabel ? ` → ${r.orderLabel}` : ""}: {r.action}
          {r.reason ? ` (${r.reason})` : ""}
        </Typography>
      ))}
      <Button
        size="small"
        variant="outlined"
        sx={{ mt: 1 }}
        disabled={busy || !(plan.data?.rows ?? []).some((p) => p.orderId && Object.keys(p.fields).length)}
        onClick={async () => {
          setBusy(true);
          try {
            const out = await api.inboxApplyPiTable(row.id);
            onApplied(out.row);
            toast.success(`PI table: ${out.results.map((r) => `${r.orderLabel ?? r.contractNo} ${r.action}`).join(", ")}`);
            await plan.refetch();
          } catch (e: any) {
            toast.error(e?.message || "Could not apply");
          } finally {
            setBusy(false);
          }
        }}
      >
        Fill the PI fields on these orders
      </Button>
    </Box>
  );
}

