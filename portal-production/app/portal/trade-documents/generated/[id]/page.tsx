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
import { Alert, Box, Button, Chip, CircularProgress, Grid2, IconButton, Menu, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { toast } from "../../../shipments/_lib/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type IssuingEntity } from "@/app/portal/shipments/_lib/api";
import { SHIPMENT_KEYS, useDocTypeLabels, useGeneratedDoc, REFRESH_WAIT_MS } from "@/app/portal/shipments/_lib/hooks";
import { ConfirmDialog } from "@/app/portal/shipments/_components/bits";
import { useDebounced } from "@/app/portal/shipments/_components/useDebounced";
import TableDocForm from "../_forms/TableDocForm";
import InvoiceDocForm from "../_forms/InvoiceDocForm";
import { SgjpDocForm, SiDocForm } from "../_forms/LogisticsDocForms";
import SingleInvoiceForm from "../_forms/SingleInvoiceForm";
import PriceCheckPanel from "../../../shipments/_components/PriceCheckPanel";

type Kind = "table" | "invoice" | "single" | "sgjp" | "si";
const KIND: Record<string, Kind> = {
  CUSTOMER_PL: "table",
  CUSTOMER_COA: "table",
  INVOICE_1: "invoice",
  INVOICE_2: "invoice",
  INVOICE_SINGLE: "single",
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
  const recordHref = g?.shipmentId
    ? `/portal/shipments/${g.shipmentId}`
    : g?.orderId
      ? `/portal/shipments/orders/${g.orderId}`
      : g?.contractId
        ? `/portal/shipments/contracts/${g.contractId}?tab=steps`
        : "/portal/trade-documents";
  const backHref = (() => {
    const from = params?.get("from");
    return from && from.startsWith("/portal") ? from : recordHref;
  })();
  const where = g?.shipmentId ? "the shipment" : g?.orderId ? "the order" : "the contract";
  // 計量検収票 with Kato's body (a page of Vedanta's container PL) has no typed rows.
  const attachBody = g?.docType === "CUSTOMER_PL" && header?.bodyMode === "attach";

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
        {g.order && (
          <Typography variant="body2" color="text.secondary">
            Order #{g.order.orderNo}
          </Typography>
        )}
        {(g.covers?.length ?? 0) > 1 && <Chip size="small" variant="outlined" label={`Covers ${g.covers!.map((c) => c.ref).join(", ")}`} data-tour="invoice-covers-chip" />}
        {g.templateLabel && <Chip size="small" variant="outlined" label={g.templateLabel} />}
        <EntityPicker docId={g.id} docType={g.docType} entity={g.issuingEntity ?? null} disabled={isFinal} />
        {(g.docType === "INVOICE_2" || g.docType === "INVOICE_SINGLE") && header && (
          <TextField
            select
            size="small"
            label="Costs (AIMS only)"
            value={header.costsBasis ?? "ACTUAL"}
            disabled={isFinal}
            sx={{ minWidth: 150 }}
            onChange={(e) => editHeader({ costsBasis: e.target.value })}
            data-tour="invoice-costs-basis"
          >
            <MenuItem value="ACTUAL">actual</MenuItem>
            <MenuItem value="ESTIMATED">estimated</MenuItem>
          </TextField>
        )}
        <CreditStatus docId={g.id} docType={g.docType} />
        {g.docType === "INVOICE_1" && !isFinal && <ApplyCreditButton docId={g.id} />}
        {/* Editor only — never printed on the PDF. */}
        {g.formatConfirmed === false && (
          <Chip size="small" color="warning" label="format not yet confirmed" data-tour="format-not-confirmed-chip" title="Copied from the Kato layout — replaced when ADH sends this customer's own sample" />
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
          <Button variant="contained" color="success" onClick={() => setConfirm("finalize")} disabled={!!busy || (!rows.length && !attachBody)}>
            Finalize
          </Button>
        )}
      </Stack>

      <Grid2 container spacing={2}>
        <Grid2 size={{ xs: 12, lg: 7 }}>
          {(kind === "invoice" || kind === "single") && (
            <Box sx={{ mb: 2 }}>
              <PriceCheckPanel kind="generated" id={g.id} title="Invoice price check vs contract" />
            </Box>
          )}
          {kind === "invoice" ? (
            <InvoiceDocForm {...formProps} />
          ) : kind === "single" ? (
            <SingleInvoiceForm {...formProps} />
          ) : kind === "sgjp" ? (
            <SgjpDocForm {...formProps} />
          ) : kind === "si" ? (
            <SiDocForm {...formProps} />
          ) : (
            <TableDocForm {...formProps} />
          )}
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
          toast.success(kind === "invoice" || kind === "single" ? `Finalized — invoice ${f.number ?? ""} confirmed` : `Finalized — PDF stored on ${where}`);
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
        body={(kind === "invoice" || kind === "single") && g.documentId ? "The draft and its unconfirmed Sales invoice are removed." : "The draft is removed. Any supplier file it was created from stays on the shipment."}
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

const CUSTOMER_INVOICES = ["INVOICE_1", "INVOICE_2", "INVOICE_SINGLE"];
/** Who issues the document: ADH JP (customer invoices, PL / COA, SI) or ADH SG (SG→JP IV/PL); a customer invoice can't be ADH SG. */
function EntityPicker({ docId, docType, entity, disabled }: { docId: string; docType: string; entity: IssuingEntity | null; disabled: boolean }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const value = entity ?? (docType === "SGJP_IV_PL" ? "ADH_SG" : "ADH_JP");
  return (
    <TextField
      select
      size="small"
      label="Issued by"
      value={value}
      disabled={disabled || busy}
      sx={{ minWidth: 170 }}
      data-tour="generated-entity"
      onChange={async (e) => {
        setBusy(true);
        try {
          await api.updateGenerated(docId, { issuingEntity: e.target.value as IssuingEntity });
          await qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.generated });
        } catch (err: any) {
          toast.error(err?.message || "Could not change the entity");
        } finally {
          setBusy(false);
        }
      }}
    >
      <MenuItem value="ADH_JP">ADH JP (合同会社)</MenuItem>
      <MenuItem value="ADH_SG" disabled={CUSTOMER_INVOICES.includes(docType)}>
        ADH SG (Pte. Ltd.){CUSTOMER_INVOICES.includes(docType) ? " — not for customer invoices" : ""}
      </MenuItem>
    </TextField>
  );
}

/** A credit note (negative Invoice #2) and where its credit went; an Invoice #1 and the credits it uses. */
function CreditStatus({ docId, docType }: { docId: string; docType: string }) {
  const api = useShipmentsApi();
  const q = useQuery({ queryKey: [...SHIPMENT_KEYS.generated, "credits", "doc", docId], queryFn: () => api.credits({ forDocId: docId }), enabled: docType === "INVOICE_2" || docType === "INVOICE_1" });
  const mine = (q.data ?? []).filter((c) => c.sourceDocId === docId);
  const used = (q.data ?? []).filter((c) => c.usedByDocId === docId);
  if (!mine.length && !used.length) return null;
  return (
    <>
      {mine.map((c) => (
        <Chip
          key={c.id}
          size="small"
          color={c.status === "OPEN" ? "warning" : c.status === "USED" ? "success" : "default"}
          label={`CREDIT NOTE · ${c.status === "OPEN" ? "open credit" : c.status === "USED" ? `used on ${c.usedByNumber ?? "Invoice #1"}` : "void"} · US$${c.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          data-tour="credit-note-chip"
        />
      ))}
      {used.map((c) => (
        <Chip key={c.id} size="small" variant="outlined" color="success" label={`Applies credit ${c.sourceNumber ?? ""} (US$${c.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })})`} />
      ))}
    </>
  );
}

/** Invoice #1: offset an open credit of the same customer ("前回差額充当 (Invoice no.)"). */
function ApplyCreditButton({ docId }: { docId: string }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...SHIPMENT_KEYS.generated, "credits", "open", docId], queryFn: () => api.credits({ forDocId: docId, status: "OPEN" }) });
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const open = q.data ?? [];
  if (!open.length) return null;
  return (
    <>
      <Button size="small" variant="outlined" color="warning" onClick={(e) => setMenu({ left: e.clientX, top: e.clientY })} data-tour="apply-open-credit">
        Apply open credit ({open.length})
      </Button>
      <Menu anchorReference="anchorPosition" anchorPosition={menu ?? undefined} open={!!menu} onClose={() => setMenu(null)}>
        {open.map((c) => (
          <MenuItem
            key={c.id}
            onClick={async () => {
              setMenu(null);
              try {
                await api.applyCredit(docId, c.id);
                await qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.generated });
                toast.success(`Credit ${c.sourceNumber ?? ""} applied — 前回差額充当 line added`);
              } catch (e: any) {
                toast.error(e?.message || "Could not apply the credit");
              }
            }}
          >
            {c.sourceNumber ?? "Credit note"} · US${c.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
