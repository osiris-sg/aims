"use client";

// Bulk upload with AI sorting (a step with 2+ upload rows, e.g. step 3's
// shipping documents): the user drops many files at once; each is classified
// into one of the step's document types (file name + spreadsheet header +
// Claude for PDFs / images, nothing stored yet). A confirm table shows file ·
// first page · detected type · confidence, with a dropdown to change the type
// or Skip; low-confidence rows are flagged. On confirm every file is uploaded
// for the step, the primary file of each type first (the required row shows
// it; extras land under Optional), and the step completes by itself when all
// its required documents are in.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useQueryClient } from "@tanstack/react-query";
import { linkTargetsOf, useShipmentsApi, type FileClassification, type TradeStep } from "../_lib/api";
import { SHIPMENT_KEYS, useDocTypeLabels } from "../_lib/hooks";
import { toast } from "../_lib/toast";
import { LocalPreview } from "./FilePreview";
import type { LinkTarget } from "./FileUploadDialog";

const LOW = 0.7;
const SKIP = "__skip";

type Row = { file: File; status: "reading" | "ready" | "error" | "uploading" | "done"; result?: FileClassification; choice: string; error?: string };

/** The types a step's files can be sorted into: its upload rows (not the documents made in-app) + optional + Other. */
export function bulkDocTypes(step: TradeStep, isCreated: (docType: string) => boolean): string[] {
  return [...new Set([...step.requiredDocTypes.filter((d) => !isCreated(d)), ...(step.optionalDocTypes ?? []), "OTHER"])];
}

export default function BulkDropDialog({
  files,
  step,
  owner,
  docTypes,
  onClose,
}: {
  files: File[] | null;
  step: TradeStep | null;
  owner: LinkTarget;
  docTypes: string[];
  onClose: () => void;
}) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const label = useDocTypeLabels();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Classify every dropped file (3 at a time).
  useEffect(() => {
    if (!files?.length) return setRows([]);
    let live = true;
    setError(null);
    const start: Row[] = files.map((file) => ({ file, status: "reading", choice: "OTHER" }));
    setRows(start);
    let next = 0;
    const work = async () => {
      while (live && next < files.length) {
        const i = next++;
        try {
          const r = await api.classifyFile(files[i], docTypes);
          if (live) setRows((rs) => rs.map((x, j) => (j === i ? { ...x, status: "ready", result: r, choice: r.docType } : x)));
        } catch (e) {
          if (live) setRows((rs) => rs.map((x, j) => (j === i ? { ...x, status: "ready", choice: "OTHER", error: (e as Error)?.message || "Could not read it" } : x)));
        }
      }
    };
    void Promise.all([work(), work(), work()]);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const reading = rows.some((r) => r.status === "reading");
  const toUpload = rows.filter((r) => r.choice !== SKIP && r.status !== "done");

  const confirm = async () => {
    if (!step) return;
    setBusy(true);
    setError(null);
    // Primary file of each type first, so the required row shows it; extras go under Optional.
    const order = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.choice !== SKIP && r.status !== "done")
      .sort((a, b) => Number(!!b.r.result?.primary && b.r.choice === b.r.result?.docType) - Number(!!a.r.result?.primary && a.r.choice === a.r.result?.docType));
    const completed: string[] = [];
    let failed = 0;
    for (const { r, i } of order) {
      setRows((rs) => rs.map((x, j) => (j === i ? { ...x, status: "uploading" } : x)));
      try {
        const f = await api.uploadFile({
          file: r.file,
          docType: r.choice,
          stepId: step.id,
          ...linkTargetsOf([owner]),
        });
        completed.push(...(f.completedSteps ?? []));
        setRows((rs) => rs.map((x, j) => (j === i ? { ...x, status: "done" } : x)));
      } catch (e) {
        failed++;
        setRows((rs) => rs.map((x, j) => (j === i ? { ...x, status: "error", error: (e as Error)?.message || "Upload failed" } : x)));
      }
    }
    // Refresh in the background; never wait on it (see useTradeMutation).
    for (const k of [SHIPMENT_KEYS.contracts, SHIPMENT_KEYS.shipments, SHIPMENT_KEYS.files, SHIPMENT_KEYS.hub]) void qc.invalidateQueries({ queryKey: k });
    setBusy(false);
    if (failed) setError(`${failed} file(s) could not be uploaded — see the rows marked in red.`);
    else {
      toast.success(`${order.length} document${order.length === 1 ? "" : "s"} attached${completed.length ? ` — step ${[...new Set(completed)].join(", ")} complete` : ""}`);
      onClose();
    }
  };

  const open = !!files?.length;
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Sort {files?.length ?? 0} document{files?.length === 1 ? "" : "s"}
        <Typography variant="body2" color="text.secondary">
          Each file is read and matched to a document of this step. Check the types, change any that are wrong, then attach them.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Table size="small" data-tour="bulk-drop-table">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 64 }} />
              <TableCell>File</TableCell>
              <TableCell sx={{ width: 260 }}>Document type</TableCell>
              <TableCell sx={{ width: 120 }}>Confidence</TableCell>
              <TableCell sx={{ width: 90 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => {
              const low = !!r.result && r.result.confidence < LOW;
              return (
                <TableRow key={`${r.file.name}-${i}`} sx={low ? { bgcolor: "rgba(237,108,2,0.08)" } : undefined}>
                  <TableCell>
                    <LocalPreview file={r.file} width={44} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
                      {r.file.name}
                    </Typography>
                    <Typography variant="caption" color={r.error ? "error" : "text.secondary"}>
                      {r.error ?? (r.result ? [r.result.variant, r.result.reason].filter(Boolean).join(" · ") : "Reading…")}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      fullWidth
                      value={r.choice}
                      disabled={busy || r.status === "reading" || r.status === "done"}
                      onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, choice: String(e.target.value) } : x)))}
                    >
                      {docTypes.map((d) => (
                        <MenuItem key={d} value={d}>
                          {label(d)}
                          {(step?.optionalDocTypes ?? []).includes(d) && !step?.requiredDocTypes.includes(d) ? " (optional)" : ""}
                        </MenuItem>
                      ))}
                      <MenuItem value={SKIP}>
                        <em>Skip — don&apos;t attach</em>
                      </MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {r.status === "reading" ? (
                      <CircularProgress size={18} />
                    ) : r.result ? (
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Chip size="small" variant="outlined" color={low ? "warning" : "success"} label={`${Math.round(r.result.confidence * 100)}%`} />
                        {low && (
                          <Tooltip title="Low confidence — check the type">
                            <WarningAmberIcon fontSize="small" color="warning" />
                          </Tooltip>
                        )}
                      </Stack>
                    ) : (
                      <Chip size="small" variant="outlined" color="warning" label="?" />
                    )}
                  </TableCell>
                  <TableCell>
                    {r.status === "uploading" ? (
                      <CircularProgress size={18} />
                    ) : r.status === "done" ? (
                      <Chip size="small" color="success" label="Attached" />
                    ) : r.status === "error" ? (
                      <Chip size="small" color="error" label="Failed" />
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {reading && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Reading the documents (about 5–10 s each)…
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void confirm()} disabled={busy || reading || !toUpload.length}>
          {busy ? "Attaching…" : `Attach ${toUpload.length} document${toUpload.length === 1 ? "" : "s"}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
