/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// A shipment's port and storage facts: the carrier ("Track" opens its own
// tracking page — the B/L is filled in where the carrier allows, else copied
// to paste), the ETA history ("8/6 → 8/16 → 8/17"), the discharge date and
// free time (DET / DEM days — the alerts warn a day before it ends), and the
// warehouse + storage start that the Stock page counts periods from.

import React, { useEffect, useState } from "react";
import { Box, Button, Grid2, Paper, Stack, TextField, Typography } from "@mui/material";
import LaunchIcon from "@mui/icons-material/Launch";
import type { Shipment } from "../_lib/api";
import { useTradeMutation } from "../_lib/hooks";
import { fmtDay } from "../_lib/format";
import { toast } from "../_lib/toast";

export default function PortStoragePanel({ shipment: s }: { shipment: Shipment }) {
  const save = useTradeMutation((a, patch: Record<string, unknown>) => a.updateShipment(s.id, patch));
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    setF({
      dischargeDate: s.dischargeDate ? s.dischargeDate.slice(0, 10) : "",
      detFreeDays: s.detFreeDays != null ? String(s.detFreeDays) : "",
      demFreeDays: s.demFreeDays != null ? String(s.demFreeDays) : "",
      warehouse: s.warehouse ?? "",
      storageStartDate: s.storageStartDate ? s.storageStartDate.slice(0, 10) : "",
    });
  }, [s.dischargeDate, s.detFreeDays, s.demFreeDays, s.warehouse, s.storageStartDate]);
  const canEdit = s.status === "OPEN";
  const put = async (patch: Record<string, unknown>) => {
    try {
      await save.mutateAsync(patch);
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    }
  };
  const blur = (k: string, kind: "date" | "int" | "text") => () => {
    const v = (f[k] ?? "").trim();
    const cur = k === "dischargeDate" || k === "storageStartDate" ? ((s as any)[k] ?? "").slice(0, 10) : (s as any)[k] == null ? "" : String((s as any)[k]);
    if (v === cur) return;
    void put({ [k]: v === "" ? null : kind === "int" ? Number(v) : v });
  };
  const track = async () => {
    if (!s.carrier) return;
    if (!s.carrier.prefilled && s.blNumber) {
      try {
        await navigator.clipboard.writeText(s.blNumber);
        toast.info(`B/L ${s.blNumber} copied — paste it into ${s.carrier.name}'s tracking search`);
      } catch {
        toast.info(`Search ${s.carrier.name} for B/L ${s.blNumber}`);
      }
    }
    window.open(s.carrier.url, "_blank", "noopener");
  };
  const field = (k: string, label: string, kind: "date" | "int" | "text", extra: Record<string, unknown> = {}) => (
    <TextField
      fullWidth
      size="small"
      label={label}
      type={kind === "date" ? "date" : kind === "int" ? "number" : "text"}
      InputLabelProps={kind === "date" ? { shrink: true } : undefined}
      value={f[k] ?? ""}
      disabled={!canEdit}
      onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
      onBlur={blur(k, kind)}
      {...extra}
    />
  );
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="shipment-port-storage">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Arrival, free time and storage
        </Typography>
        {s.carrier && (
          <Button size="small" variant="outlined" startIcon={<LaunchIcon />} onClick={track} data-tour="shipment-track">
            Track ({s.carrier.name})
          </Button>
        )}
      </Stack>
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          ETA {fmtDay(s.eta)}
          {s.etaTrail ? ` · history ${s.etaTrail}` : ""}
        </Typography>
      </Box>
      <Grid2 container spacing={1.5}>
        <Grid2 size={{ xs: 12, sm: 4 }}>{field("dischargeDate", "Discharge date", "date")}</Grid2>
        <Grid2 size={{ xs: 6, sm: 4 }}>{field("detFreeDays", "DET free days (default 4)", "int")}</Grid2>
        <Grid2 size={{ xs: 6, sm: 4 }}>{field("demFreeDays", "DEM free days (default 10)", "int")}</Grid2>
        <Grid2 size={{ xs: 12, sm: 8 }}>{field("warehouse", "Warehouse (e.g. Mitsui Soko Honmoku)", "text")}</Grid2>
        <Grid2 size={{ xs: 12, sm: 4 }}>{field("storageStartDate", "Storage start", "date")}</Grid2>
      </Grid2>
    </Paper>
  );
}
