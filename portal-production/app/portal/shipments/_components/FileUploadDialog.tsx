/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Upload one or more trade documents. Each file becomes its own TradeFile with
// the same doc type and link targets. Files are checked against the backend's
// size/type allow-list first and previewed (first page of a PDF, the image, or
// a type icon), then uploaded one by one with progress. A step row's drop zone
// opens it with the dropped files already in the list.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { TRADE_FILE_EXTENSIONS, TRADE_FILE_MAX_BYTES, type TradeFile } from "../_lib/api";
import { toast } from "../_lib/toast";
import { LocalPreview } from "./FilePreview";
import { useContracts, useDocTypes, useShipments, useTradeMutation } from "../_lib/hooks";
import { blLabel, fmtBytes } from "../_lib/format";

export type LinkTarget = { kind: "contract" | "shipment"; id: string; label: string };

type Row = { file: File; status: "ready" | "uploading" | "done" | "error"; pct: number; error?: string };

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
const precheck = (f: File): string | undefined => {
  if (!TRADE_FILE_EXTENSIONS.includes(extOf(f.name))) return `File type not allowed. Allowed: ${TRADE_FILE_EXTENSIONS.join(", ")}`;
  if (f.size > TRADE_FILE_MAX_BYTES) return "File is larger than 25 MB";
  if (f.size === 0) return "File is empty";
  return undefined;
};

export default function FileUploadDialog({
  open,
  onClose,
  defaultTargets = [],
  docType: presetDocType,
  stepId,
  replacesFileId,
  initialFiles,
  onUploaded,
  announceSteps = true,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-selected link targets (normally the record the dialog was opened from). */
  defaultTargets?: LinkTarget[];
  docType?: string;
  /** Uploading for a step: the file is tagged with it (and linked to its record). */
  stepId?: string;
  /** Replace: the file this upload replaces (the new file keeps its document ID). */
  replacesFileId?: string;
  stepTitle?: string;
  /** Files dropped on a step row: listed (and previewed) as soon as the dialog opens. */
  initialFiles?: File[] | null;
  /** After every file uploaded: e.g. Replace removes the old one. */
  onUploaded?: (files: TradeFile[]) => void | Promise<void>;
  /** Toast "Step N complete" for steps the upload completed (the deal page announces them itself). */
  announceSteps?: boolean;
  title?: string;
}) {
  const docTypes = useDocTypes();
  const contracts = useContracts({ status: "OPEN", pageSize: 100 }, open);
  const shipments = useShipments({ status: "OPEN", pageSize: 100 }, open);
  const [docType, setDocType] = useState("");
  const [targets, setTargets] = useState<LinkTarget[]>([]);
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useTradeMutation((api, v: { row: Row; index: number }) =>
    api.uploadFile(
      {
        file: v.row.file,
        docType,
        notes,
        stepId,
        replacesFileId,
        contractIds: targets.filter((t) => t.kind === "contract").map((t) => t.id),
        shipmentIds: targets.filter((t) => t.kind === "shipment").map((t) => t.id),
      },
      (pct) => setRows((rs) => rs.map((r, i) => (i === v.index ? { ...r, pct } : r))),
    ),
  );

  // Reset every time the dialog opens (targets/doc type depend on where it was opened).
  const defaultKey = defaultTargets.map((t) => t.id).join(",");
  useEffect(() => {
    if (!open) return;
    setDocType(presetDocType ?? "");
    setTargets(defaultTargets);
    setNotes("");
    setRows([]);
    if (initialFiles?.length) addFiles(initialFiles);
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetDocType, defaultKey]);

  const options: LinkTarget[] = useMemo(() => {
    const out: LinkTarget[] = [
      ...(contracts.data?.items ?? []).map((c) => ({ kind: "contract" as const, id: c.id, label: `Contract ${c.contractNo}` })),
      ...(shipments.data?.items ?? []).map((s) => ({ kind: "shipment" as const, id: s.id, label: `Shipment ${blLabel(s.blNumber)}${s.contractNo ? ` · ${s.contractNo}` : ""}` })),
    ];
    // Keep defaults selectable even if they're not in the first page of results.
    defaultTargets.forEach((d) => {
      if (!out.some((o) => o.id === d.id)) out.unshift(d);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts.data, shipments.data, defaultKey]);

  const activeDocTypes = (docTypes.data ?? []).filter((d) => d.isActive || d.code === docType);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const added = Array.from(list).map<Row>((file) => {
      const err = precheck(file);
      return err ? { file, status: "error", pct: 0, error: err } : { file, status: "ready", pct: 0 };
    });
    setRows((rs) => [...rs.filter((r) => r.status !== "done"), ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }

  const pending = rows.filter((r) => r.status === "ready");
  const doneCount = rows.filter((r) => r.status === "done").length;
  const canUpload = !!docType && pending.length > 0 && !busy && (targets.length > 0 || !!stepId);

  const start = async () => {
    setError(null);
    if (!docType) return setError("Choose a document type");
    if (!targets.length && !stepId) return setError("Link the file to at least one contract or shipment");
    setBusy(true);
    let failed = 0;
    const uploaded: TradeFile[] = [];
    const completed: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status !== "ready") continue;
      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, status: "uploading", pct: 0 } : r)));
      try {
        const f = await upload.mutateAsync({ row, index: i });
        uploaded.push(f);
        completed.push(...(f.completedSteps ?? []));
        setRows((rs) => rs.map((r, j) => (j === i ? { ...r, status: "done", pct: 100 } : r)));
      } catch (e: any) {
        failed++;
        setRows((rs) => rs.map((r, j) => (j === i ? { ...r, status: "error", error: e?.message || "Upload failed" } : r)));
      }
    }
    if (uploaded.length && onUploaded) {
      try {
        await onUploaded(uploaded);
      } catch (e: any) {
        toast.error(e?.message || "Uploaded, but the old file could not be removed");
      }
    }
    setBusy(false);
    if (announceSteps) for (const label of [...new Set(completed)]) toast.success(`Step ${label} complete`);
    const hadPrecheckErrors = rows.some((r) => r.status === "error");
    if (!failed && !hadPrecheckErrors) onClose();
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{title ?? "Upload documents"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField select label="Document type" required size="small" value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy} helperText={docTypes.isError ? "Could not load document types" : undefined}>
            {activeDocTypes.map((d) => (
              <MenuItem key={d.code} value={d.code}>
                {d.label}
              </MenuItem>
            ))}
          </TextField>
          <Autocomplete
            multiple
            options={options}
            value={targets}
            onChange={(_, v) => setTargets(v)}
            groupBy={(o) => (o.kind === "contract" ? "Contracts" : "Shipments")}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={contracts.isLoading || shipments.isLoading}
            disabled={busy}
            renderTags={(value, getTagProps) => value.map((o, i) => <Chip size="small" label={o.label} {...getTagProps({ index: i })} key={o.id} />)}
            renderInput={(p) => <TextField {...p} label="Link to" size="small" />}
          />
          <TextField label="Notes" size="small" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />

          <Box>
            <input ref={inputRef} type="file" multiple hidden accept={TRADE_FILE_EXTENSIONS.map((e) => `.${e}`).join(",")} onChange={(e) => addFiles(e.target.files)} />
            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose files
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
              Up to 25 MB each · {TRADE_FILE_EXTENSIONS.join(", ")}
            </Typography>
          </Box>

          {rows.length > 0 && (
            <List dense disablePadding sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
              {rows.map((r, i) => (
                <ListItem
                  key={`${r.file.name}-${i}`}
                  divider={i < rows.length - 1}
                  secondaryAction={
                    r.status === "done" ? (
                      <CheckCircleIcon color="success" fontSize="small" />
                    ) : r.status === "error" ? (
                      <IconButton size="small" edge="end" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={busy}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    ) : r.status === "ready" ? (
                      <IconButton size="small" edge="end" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={busy}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    ) : null
                  }
                >
                  <Box sx={{ mr: 1.5, py: 0.5 }}>
                    <LocalPreview file={r.file} width={72} />
                  </Box>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        {r.status === "error" && <ErrorOutlineIcon color="error" fontSize="small" />}
                        <Typography variant="body2" noWrap sx={{ maxWidth: 360 }}>
                          {r.file.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {fmtBytes(r.file.size)}
                        </Typography>
                      </Stack>
                    }
                    secondary={
                      r.status === "uploading" ? (
                        <LinearProgress variant={r.pct > 0 && r.pct < 100 ? "determinate" : "indeterminate"} value={r.pct} sx={{ mt: 0.75 }} />
                      ) : r.status === "error" ? (
                        <Typography variant="caption" color="error">
                          {r.error}
                        </Typography>
                      ) : r.status === "done" ? (
                        "Uploaded"
                      ) : (
                        "Ready"
                      )
                    }
                    secondaryTypographyProps={{ component: "div" }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {doneCount > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mr: "auto", ml: 2 }}>
            {doneCount} of {rows.length} uploaded
          </Typography>
        )}
        <Button onClick={onClose} disabled={busy}>
          {doneCount > 0 ? "Close" : "Cancel"}
        </Button>
        <Button variant="contained" onClick={start} disabled={!canUpload}>
          {busy ? "Uploading…" : pending.length > 1 ? `Upload ${pending.length} files` : "Upload"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
