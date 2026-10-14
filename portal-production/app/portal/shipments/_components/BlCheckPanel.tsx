/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// "B/L draft check": what the AI read off the B/L draft compared with the
// contract (consignee, notify party, contract no., grade, POD), the line's
// quantity, and the shipment's saved fields. Advisory only — it never blocks
// completing a step; "Acknowledge" records who accepted the remaining issues.

import React, { useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import type { BlCheck, BlCheckSummary, CheckItem } from "../_lib/api";
import { useShipmentsApi } from "../_lib/api";
import { useTradeMutation } from "../_lib/hooks";
import { fmtDateTime } from "../_lib/format";
import { toast } from "../_lib/toast";

const ICON: Record<BlCheck["status"], React.ReactNode> = {
  ok: <CheckCircleOutlineIcon fontSize="small" color="success" />,
  issue: <ErrorOutlineIcon fontSize="small" color="error" />,
  missing: <HelpOutlineIcon fontSize="small" color="warning" />,
  info: <InfoOutlinedIcon fontSize="small" color="info" />,
};
const ITEM: Record<CheckItem["status"], { label: string; color: "success" | "error" | "warning" }> = {
  ok: { label: "✓", color: "success" },
  mismatch: { label: "✗ differs", color: "error" },
  missing: { label: "missing", color: "warning" },
};

/** Chip for the "Approve B/L draft" step row and the Overview header. */
export function BlCheckChip({ check, onClick }: { check: BlCheckSummary; onClick?: () => void }) {
  const open = check.issueCount > 0 && !check.acknowledgedAt;
  return (
    <Chip
      size="small"
      variant="outlined"
      clickable={!!onClick}
      onClick={onClick}
      color={open ? "warning" : "success"}
      icon={open ? <ErrorOutlineIcon /> : <CheckCircleOutlineIcon />}
      label={open ? `B/L check: ${check.issueCount} issue${check.issueCount === 1 ? "" : "s"}` : check.issueCount ? `B/L check: acknowledged` : "B/L check ✓"}
      title="AI check of the B/L draft against the contract"
    />
  );
}

export default function BlCheckPanel({ check, shipmentId, canEdit }: { check: BlCheckSummary; shipmentId: string; canEdit: boolean }) {
  const api = useShipmentsApi();
  const [rechecking, setRechecking] = useState(false);
  const ack = useTradeMutation((a, id: string) => a.acknowledgeExtraction(id));
  // Re-read the PDF (new extraction row) — e.g. after Vedanta sends a corrected draft.
  const reread = useTradeMutation((a, v: { fileId: string }) => a.extractBlDraft({ fileId: v.fileId, shipmentId }));

  const view = async () => {
    try {
      const { url } = await api.fileUrl(check.fileId);
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message || "Could not open the file");
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-tour="bl-draft-check">
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="subtitle2">B/L draft check</Typography>
        <BlCheckChip check={check} />
        <Typography variant="caption" color="text.secondary">
          {check.fileName ?? "B/L draft"} · read {fmtDateTime(check.extractedAt)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={view}>
          View PDF
        </Button>
        <Button
          size="small"
          startIcon={rechecking ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
          disabled={!canEdit || rechecking}
          onClick={async () => {
            setRechecking(true);
            try {
              const x = await reread.mutateAsync({ fileId: check.fileId });
              if (x.status === "FAILED") toast.error(x.error || "Could not read the B/L draft");
              else toast.success("B/L draft re-checked");
            } catch (e: any) {
              toast.error(e?.message || "Could not re-check");
            } finally {
              setRechecking(false);
            }
          }}
        >
          {rechecking ? "Reading…" : "Re-read PDF"}
        </Button>
        {check.issueCount > 0 && !check.acknowledgedAt && (
          <Button
            size="small"
            variant="outlined"
            color="warning"
            disabled={!canEdit || ack.isPending}
            onClick={async () => {
              try {
                await ack.mutateAsync(check.extractionId);
                toast.success("B/L check acknowledged");
              } catch (e: any) {
                toast.error(e?.message || "Could not acknowledge");
              }
            }}
          >
            Acknowledge
          </Button>
        )}
      </Stack>
      {check.acknowledgedAt && check.issueCount > 0 && (
        <Alert severity="info" sx={{ mb: 1, py: 0 }}>
          {check.issueCount} issue{check.issueCount === 1 ? "" : "s"} acknowledged by {check.acknowledgedByName ?? "someone"} · {fmtDateTime(check.acknowledgedAt)}
        </Alert>
      )}
      <Table size="small" sx={{ tableLayout: "fixed", "& td": { verticalAlign: "top", py: 0.75 } }}>
        <colgroup>
          <col style={{ width: 36 }} />
          <col style={{ width: 170 }} />
          <col />
        </colgroup>
        <TableBody>
          {check.checks.map((c) => (
            <TableRow key={c.key}>
              <TableCell sx={{ pr: 0 }}>{ICON[c.status]}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{c.label}</TableCell>
              <TableCell>
                <Typography variant="body2">{c.detail}</Typography>
                {c.items && c.items.length > 0 && (c.key === "consignee" || c.key === "notifyParty" || c.status !== "ok") && (
                  // Same fixed columns in every sub-table so consignee / notify / fields line up.
                  <Table size="small" sx={{ mt: 0.5, tableLayout: "fixed", "& td, & th": { py: 0.25, px: 1, borderBottom: 0, fontSize: 12, wordBreak: "break-word" } }}>
                    <colgroup>
                      <col style={{ width: 130 }} />
                      <col />
                      <col style={{ width: c.key === "fields" ? "35%" : 110 }} />
                    </colgroup>
                    {c.key === "fields" && (
                      <TableHead>
                        <TableRow>
                          <TableCell>Field</TableCell>
                          <TableCell>B/L draft</TableCell>
                          <TableCell>Shipment</TableCell>
                        </TableRow>
                      </TableHead>
                    )}
                    <TableBody>
                      {c.items.map((i) => (
                        <TableRow key={i.item}>
                          <TableCell sx={{ color: "text.secondary" }}>{i.item}</TableCell>
                          {c.key === "fields" ? (
                            <>
                              <TableCell>{i.expected}</TableCell>
                              <TableCell>{i.found ?? "—"}</TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell sx={{ whiteSpace: "pre-line" }}>{i.expected}</TableCell>
                              <TableCell sx={{ whiteSpace: "nowrap" }}>
                                <Chip size="small" variant="outlined" color={ITEM[i.status].color} label={ITEM[i.status].label} />
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {check.containers?.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Containers: {check.containers.map((c) => [c.containerNo, c.sealNo && `seal ${c.sealNo}`, c.packages != null && `${c.packages} pkgs`].filter(Boolean).join(" ")).join(" · ")}
        </Typography>
      )}
    </Paper>
  );
}
