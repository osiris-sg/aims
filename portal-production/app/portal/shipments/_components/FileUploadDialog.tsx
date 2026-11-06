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
  Box,
  Button,
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
import { useTranslations } from "next-intl";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { linkTargetsOf, TRADE_FILE_EXTENSIONS, TRADE_FILE_MAX_BYTES, type TradeFile } from "../_lib/api";
import { toast } from "../_lib/toast";
import { LocalPreview } from "./FilePreview";
import { useOrders, useDocTypes, useShipments, useTradeMutation } from "../_lib/hooks";
import { fmtBytes } from "../_lib/format";
import LinkChecklist, { CiTotals, targetKey, tradeCheckItems } from "./LinkChecklist";

/** Round BG: payment proofs — the checklist lists the ticked shipments' CIs with their total. */
const PROOF_TYPES = ["CI_PAYMENT_PROOF", "PAYMENT_PROOF", "DEPOSIT_PROOF"];

export type LinkTarget = { kind: "contract" | "shipment" | "order" | "supplierOrder"; id: string; label: string };

type Row = { file: File; status: "ready" | "uploading" | "done" | "error"; pct: number; error?: string };

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
const precheck = (f: File, t: (key: string, values?: Record<string, string | number>) => string): string | undefined => {
  if (!TRADE_FILE_EXTENSIONS.includes(extOf(f.name))) return t("typeNotAllowed", { list: TRADE_FILE_EXTENSIONS.join(", ") });
  if (f.size > TRADE_FILE_MAX_BYTES) return t("tooLarge");
  if (f.size === 0) return t("empty");
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
  const t = useTranslations("orders.upload");
  const docTypes = useDocTypes();
  const orders = useOrders({ bucket: "pending", pageSize: 100 }, open);
  const shipments = useShipments({ status: "OPEN", pageSize: 100 }, open);
  const [docType, setDocType] = useState("");
  const [targets, setTargets] = useState<LinkTarget[]>([]);
  const [notes, setNotes] = useState("");
  const [proofAmount, setProofAmount] = useState("");
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
        ...linkTargetsOf(targets),
      },
      (pct) => setRows((rs) => rs.map((r, i) => (i === v.index ? { ...r, pct } : r))),
    ),
  );

  // Reset every time the dialog opens (targets/doc type depend on where it was opened).
  const defaultKey = defaultTargets.map((x) => x.id).join(",");
  useEffect(() => {
    if (!open) return;
    setDocType(presetDocType ?? "");
    setTargets(defaultTargets);
    setNotes("");
    setProofAmount("");
    setRows([]);
    if (initialFiles?.length) addFiles(initialFiles);
    setError(null);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetDocType, defaultKey]);

  // Round BG: one checklist (Orders / Shipments) instead of adding one chip at a time; the record it was opened from is pre-ticked.
  const items = useMemo(
    () => tradeCheckItems((orders.data?.items ?? []) as any[], (shipments.data?.items ?? []) as any[], [...defaultTargets, ...targets], t("blPending")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders.data, shipments.data, defaultKey, targets],
  );
  const keys = targets.map(targetKey);
  const setKeys = (ks: string[]) =>
    setTargets(
      ks.map((k) => {
        const [kind, id] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)] as [LinkTarget["kind"], string];
        const it = items.find((i) => i.key === k);
        return targets.find((x) => targetKey(x) === k) ?? { kind, id, label: it?.ref ?? id };
      }),
    );

  const activeDocTypes = (docTypes.data ?? []).filter((d) => d.isActive || d.code === docType);

  function addFiles(list: FileList | File[] | null) {
    if (!list) return;
    const added = Array.from(list).map<Row>((file) => {
      const err = precheck(file, t);
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
    if (!docType) return setError(t("chooseType"));
    if (!targets.length && !stepId) return setError(t("needLink"));
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
        setRows((rs) => rs.map((r, j) => (j === i ? { ...r, status: "error", error: e?.message || t("failed") } : r)));
      }
    }
    if (uploaded.length && onUploaded) {
      try {
        await onUploaded(uploaded);
      } catch (e: any) {
        toast.error(e?.message || t("oldNotRemoved"));
      }
    }
    setBusy(false);
    if (announceSteps) for (const label of [...new Set(completed)]) toast.success(t("stepComplete", { label }));
    const hadPrecheckErrors = rows.some((r) => r.status === "error");
    if (!failed && !hadPrecheckErrors) onClose();
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{title ?? t("title")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField select label={t("docType")} required size="small" value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy} helperText={docTypes.isError ? t("docTypesError") : undefined}>
            {activeDocTypes.map((d) => (
              <MenuItem key={d.code} value={d.code}>
                {d.label}
              </MenuItem>
            ))}
          </TextField>
          <LinkChecklist items={items} value={keys} onChange={setKeys} loading={orders.isLoading || shipments.isLoading} disabled={busy} label={t("linkTo")} />
          {PROOF_TYPES.includes(docType) && <CiTotals items={items} value={keys} proofAmount={proofAmount} onProofAmount={setProofAmount} />}
          <TextField label={t("notes")} size="small" multiline minRows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} />

          <Box>
            <input ref={inputRef} type="file" multiple hidden accept={TRADE_FILE_EXTENSIONS.map((e) => `.${e}`).join(",")} onChange={(e) => addFiles(e.target.files)} />
            <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => inputRef.current?.click()} disabled={busy}>
              {t("choose")}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
              {t("limits", { list: TRADE_FILE_EXTENSIONS.join(", ") })}
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
                      <IconButton size="small" edge="end" aria-label={t("remove")} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={busy}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    ) : r.status === "ready" ? (
                      <IconButton size="small" edge="end" aria-label={t("remove")} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={busy}>
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
                        <Typography variant="body2" sx={{ maxWidth: 360, wordBreak: "break-word" }}>
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
                        t("uploaded")
                      ) : (
                        t("ready")
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
            {t("progress", { done: doneCount, total: rows.length })}
          </Typography>
        )}
        <Button onClick={onClose} disabled={busy}>
          {doneCount > 0 ? t("close") : t("cancel")}
        </Button>
        <Button variant="contained" onClick={start} disabled={!canUpload}>
          {busy ? t("uploading") : pending.length > 1 ? t("uploadN", { n: pending.length }) : t("upload")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
