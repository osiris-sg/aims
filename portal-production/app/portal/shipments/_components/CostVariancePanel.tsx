"use client";

// An invoice issued on ESTIMATED costs (Invoice #2 sent early to be paid
// sooner): once Mitsui Soko's actuals are in (step 12), the cost lines billed
// vs the actual costs at the invoice's FX. Nothing is re-invoiced unless
// "Issue adjustment" is clicked (a new Invoice #2 draft for the difference).

import React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useShipmentsApi } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { toast } from "../_lib/toast";

const usd = (v: number | null) => (v === null ? "—" : `US$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function CostVariancePanel({ invoiceId, canAdjust, returnTo }: { invoiceId: string; canAdjust: boolean; returnTo?: string }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: [...SHIPMENT_KEYS.generated, "variance", invoiceId], queryFn: () => api.costVariance(invoiceId) });
  if (!q.data) return null;
  const v = q.data;
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-tour="cost-variance">
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {v.number ?? "Invoice"} — costs billed on estimate
      </Typography>
      {!v.complete ? (
        <Alert severity="info">Waiting for the actual costs (step 12) of every shipment it covers.</Alert>
      ) : (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2">
              Estimated {usd(v.estimatedUsd)} · actual ¥{(v.actualJpy ?? 0).toLocaleString("en-US")} at {v.fxRate ?? "—"} = {usd(v.actualUsd)}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, color: (v.varianceUsd ?? 0) > 0 ? "warning.main" : "success.main" }}>
              Variance {v.varianceUsd !== null && v.varianceUsd > 0 ? "+" : ""}
              {usd(v.varianceUsd)} {v.varianceUsd !== null && v.varianceUsd > 0 ? "(under-billed)" : v.varianceUsd !== null && v.varianceUsd < 0 ? "(over-billed)" : ""}
            </Typography>
          </Box>
          {canAdjust && v.varianceUsd !== null && Math.abs(v.varianceUsd) >= 0.01 && (
            <Button
              variant="outlined"
              onClick={async () => {
                try {
                  const g = await api.issueAdjustment(invoiceId);
                  await qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.generated });
                  toast.success("Adjustment draft created");
                  router.push(`/portal/trade-documents/generated/${g.id}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`);
                } catch (e: any) {
                  toast.error(e?.message || "Could not create the adjustment");
                }
              }}
            >
              Issue adjustment
            </Button>
          )}
        </Stack>
      )}
    </Paper>
  );
}
