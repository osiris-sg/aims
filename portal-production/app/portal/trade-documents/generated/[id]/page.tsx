/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Editor for an in-app trade document. One shell for every template — the
// form is chosen by document type (Customer PL / COA table, ADH 請求書,
// SG→JP invoice & packing list, shipping instructions) — with a live preview
// rendered by the same server template as the PDF.
// Save draft keeps it editable; Download PDF works any time (a draft carries a
// same layout as the final document, no watermark); Finalize renders the PDF, stores it on the record
// (which ticks the step; invoices also create + confirm the Sales invoice) and
// locks it; "Edit again" unlocks it (refused while a done step still needs it).

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, Chip, CircularProgress, Grid2, IconButton, Paper, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { toast } from "../../../shipments/_lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi } from "@/app/portal/shipments/_lib/api";
import { SHIPMENT_KEYS, useDocTypeLabels, useGeneratedDoc, REFRESH_WAIT_MS } from "@/app/portal/shipments/_lib/hooks";
import { ConfirmDialog } from "@/app/portal/shipments/_components/bits";
import { useDebounced } from "@/app/portal/shipments/_components/useDebounced";
import TableDocForm from "../_forms/TableDocForm";
import InvoiceDocForm from "../_forms/InvoiceDocForm";
import { SgjpDocForm, SiDocForm } from "../_forms/LogisticsDocForms";

type Kind = "table" | "invoice" | "sgjp" | "si";
const KIND: Record<string, Kind> = {
  CUSTOMER_PL: "table",
  CUSTOMER_COA: "table",
  INVOICE_1: "invoice",
  INVOICE_2: "invoice",
  SGJP_IV_PL: "sgjp",
  SHIPPING_INSTRUCTIONS: "si",
};

export default function GeneratedDocEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const label = useDocTypeLabels();
  const q = useGeneratedDoc(id);
  const [header, setHeader] = useState<any>(null);
  const [columns, setColumns] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"finalize" | "revert" | "delete" | null>(null);
  const [html, setHtml] = useState<string>("");

  // Load once per document (and again after finalize / edit-again).
  const loadedKey = q.data ? `${q.data.id}:${q.data.status}:${q.data.updatedAt}` : "";
  useEffect(() => {
    if (!q.data) return;
    setHeader(q.data.header);
    setColumns(q.data.columns ?? []);
    setRows(q.data.rows ?? []);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);

  const g = q.data;
  const kind: Kind = (g && KIND[g.docType]) || "table";
  const isFinal = g?.status === "FINAL";
  const recordHref = g?.shipmentId ? `/portal/shipments/${g.shipmentId}?tab=steps` : g?.contractId ? `/portal/shipments/contracts/${g.contractId}?tab=steps` : "/portal/trade-documents";
  const backHref = (() => {
    const from = params?.get("from");
    return from && from.startsWith("/portal") ? from : recordHref;
  })();
  const where = g?.shipmentId ? "the shipment" : "the contract";

  // Live preview: debounced, rendered server-side by the PDF template.
  const previewInput = useDebounced(useMemo(() => (header && g ? { docType: g.docType, header, columns, rows, draft: !isFinal } : null), [header, columns, rows, g, isFinal]), 500);
  useEffect(() => {
    if (!previewInput) return;
    let cancelled = false;
    api
      .previewGenerated(previewInput)
      .then((r) => !cancelled && setHtml(r.html))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [previewInput, api]);

  // Every form edit goes through these: nothing changes once final, and the draft becomes dirty.
  const editHeader = (patch: any) => {
    if (isFinal) return;
    setHeader((h: any) => (h ? { ...h, ...patch } : h));
    setDirty(true);
  };
  const editRows = (fn: (rs: any[]) => any[]) => {
    if (isFinal) return;
    setRows(fn);
    setDirty(true);
  };
  const editColumns = (fn: (cs: any[]) => any[]) => {
    if (isFinal) return;
    setColumns(fn);
    setDirty(true);
  };

  const refresh = async () => {
    const all = Promise.all([
      qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.generated }),
      qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.shipments }),
      qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.contracts }),
      qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.hub }),
      qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.files }),
    ]).catch(() => undefined);
    // Never hold a dialog on "Working…" for a slow / paused refetch (same cap as useTradeMutation).
    await Promise.race([all, new Promise((r) => setTimeout(r, REFRESH_WAIT_MS))]);
  };
  const persist = async () => {
    if (!g || !header || !dirty) return;
    await api.updateGenerated(g.id, { header, columns, rows });
    setDirty(false);
  };
  const save = async () => {
    setBusy("save");
    try {
      await persist();
      toast.success("Draft saved");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    } finally {
      setBusy(null);
    }
  };
  /** Download PDF: saves pending edits first so the draft PDF matches the screen. */
  const download = async () => {
    if (!g) return;
    setBusy("download");
    try {
      await persist();
      const name = await api.downloadGeneratedPdf(g.id);
      toast.success(`Downloaded ${name}`);
    } catch (e: any) {
      toast.error(e?.message || "Could not download the PDF");
    } finally {
      setBusy(null);
    }
  };
  /** Preview: the rendered page full-size in a new tab. */
  const openPreview = () => {
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  if (q.isLoading || (!header && !q.isError)) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (q.isError || !g || !header) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{(q.error as Error)?.message || "Document not found"}</Alert>
      </Box>
    );
  }

  const formProps = { doc: g, header, rows, columns, disabled: isFinal, setHeader: editHeader, setRows: editRows, setColumns: editColumns };
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2, flexWrap: { xs: "wrap", md: "nowrap" }, rowGap: 1 }}>
        <IconButton size="small" aria-label="Back" onClick={() => router.push(backHref)}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {label(g.docType)}
        </Typography>
        <Chip size="small" variant="outlined" color={isFinal ? "success" : "warning"} label={isFinal ? `Final · ${g.number ?? ""}` : "Draft"} />
        {g.shipment?.blNumber && (
          <Typography variant="body2" color="text.secondary">
            B/L {g.shipment.blNumber}
          </Typography>
        )}
        {g.contract?.contractNo && (
          <Typography variant="body2" color="text.secondary">
            Contract {g.contract.contractNo}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {!isFinal && (
          <Button color="error" onClick={() => setConfirm("delete")} disabled={!!busy}>
            Delete draft
          </Button>
        )}
        {!isFinal && (
          <Button variant="outlined" onClick={save} disabled={!!busy || !dirty}>
            {busy === "save" ? "Saving…" : dirty ? "Save draft" : "Saved"}
          </Button>
        )}
        <Button variant="outlined" startIcon={<OpenInNewIcon />} onClick={openPreview} disabled={!html}>
          Preview
        </Button>
        <Button variant="outlined" startIcon={busy === "download" ? <CircularProgress size={14} /> : <DownloadIcon />} onClick={download} disabled={!!busy}>
          {isFinal ? "Download PDF" : "Download draft PDF"}
        </Button>
        {isFinal ? (
          <Button variant="contained" onClick={() => setConfirm("revert")} disabled={!!busy}>
            Edit again
          </Button>
        ) : (
          <Button variant="contained" color="success" onClick={() => setConfirm("finalize")} disabled={!!busy || !rows.length}>
            Finalize
          </Button>
        )}
      </Stack>

      <Grid2 container spacing={2}>
        <Grid2 size={{ xs: 12, lg: 7 }}>
          {kind === "invoice" ? <InvoiceDocForm {...formProps} /> : kind === "sgjp" ? <SgjpDocForm {...formProps} /> : kind === "si" ? <SiDocForm {...formProps} /> : <TableDocForm {...formProps} />}
        </Grid2>

        <Grid2 size={{ xs: 12, lg: 5 }}>
          <Paper variant="outlined" sx={{ p: 1, position: { lg: "sticky" }, top: { lg: 16 } }}>
            <Typography variant="subtitle2" sx={{ px: 1, pb: 1 }}>
              Preview{isFinal ? "" : " (draft)"}
            </Typography>
            {/* White page in both themes: it is a print preview. */}
            <Box component="iframe" title="Document preview" srcDoc={html} sx={{ width: "100%", height: { xs: 520, lg: "calc(100vh - 200px)" }, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }} />
          </Paper>
        </Grid2>
      </Grid2>

      <ConfirmDialog
        open={confirm === "finalize"}
        title={`Finalize ${label(g.docType)}?`}
        confirmLabel="Finalize"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await persist();
          const f = await api.finalizeGenerated(g.id);
          toast.success(kind === "invoice" ? `Finalized — invoice ${f.number ?? ""} confirmed` : `Finalized — PDF stored on ${where}`);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={confirm === "revert"}
        title="Edit again?"
        confirmLabel="Edit again"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await api.revertGenerated(g.id);
          toast.success("Back to draft");
          await refresh();
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="Delete this draft?"
        body={kind === "invoice" && g.documentId ? "The draft and its unconfirmed Sales invoice are removed." : "The draft is removed. Any supplier file it was created from stays on the shipment."}
        confirmLabel="Delete"
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await api.deleteGenerated(g.id);
          toast.success("Draft deleted");
          await refresh();
          router.push(backHref);
        }}
      />
    </Box>
  );
}
