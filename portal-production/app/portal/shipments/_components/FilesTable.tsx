/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Trade documents table + the row actions shared with the Documents library:
// View (the in-app viewer: PDF pages / image, with download), Add link,
// Unlink, Delete. Each row shows the file's first-page thumbnail (a type icon
// for Office / Outlook files); clicking the row or the thumbnail opens the
// viewer; secondary actions sit behind a click-anchored kebab.

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Menu, MenuItem, Radio, RadioGroup, Stack, TextField, Tooltip, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useTranslations } from "next-intl";
import { toast } from "../_lib/toast";
import Table from "@/components/Table";
import { linkTargetsOf, targetGroup, type FileFilters, type TradeFile, type TradeFileLink } from "../_lib/api";
import { useOrders, useShipments, useTradeFiles, useTradeMutation } from "../_lib/hooks";
import { fmtBytes, fmtDate, fmtDateTime } from "../_lib/format";
import { ConfirmDialog, EmptyState } from "./bits";
import FileUploadDialog, { type LinkTarget } from "./FileUploadDialog";
import { FileThumb, useFileViewer } from "./FilePreview";

type T = (key: string, values?: Record<string, string | number>) => string;
const linkLabel = (l: TradeFileLink, t: T) =>
  l.orderId
    ? t("linkOrder", { no: `#${l.order?.orderNo ?? ""}` })
    : l.contractId
      ? t("linkContract", { no: l.contract?.contractNo ?? "" })
      : t("linkShipment", { no: l.shipment?.order ? `#${l.shipment.order.orderNo}${l.shipment.seqNo ? `-${l.shipment.seqNo}` : ""}` : l.shipment?.blNumber || t("blPending") });
const linkHref = (l: TradeFileLink) => (l.orderId ? `/portal/shipments/orders/${l.orderId}` : l.contractId ? `/portal/shipments/contracts/${l.contractId}` : `/portal/shipments/${l.shipmentId}`);

export const LinkChips = ({ links, currentId }: { links: TradeFileLink[]; currentId?: string }) => {
  const t = useTranslations("orders.files");
  return links.length ? (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {links.map((l) => {
        const isCurrent = !!currentId && (l.orderId ?? l.contractId ?? l.shipmentId) === currentId;
        return (
          <Chip
            key={l.id}
            size="small"
            variant="outlined"
            color={l.orderId || l.contractId ? "primary" : "info"}
            label={linkLabel(l, t)}
            component={Link}
            href={linkHref(l)}
            clickable
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            // The record you're on is marked by a heavier outline + bold label
            // (a filled info chip is unreadable in the dark theme).
            sx={{ maxWidth: 220, ...(isCurrent ? { borderWidth: 2, fontWeight: 700 } : {}) }}
          />
        );
      })}
    </Stack>
  ) : (
    <Typography variant="caption" color="text.secondary">
      {t("notLinked")}
    </Typography>
  );
};

/** Row menu + dialogs for trade files. Render `dialogs` once next to the table. */
export function useFileActions(currentId?: string) {
  const t = useTranslations("orders.files");
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; file: TradeFile } | null>(null);
  const [addFor, setAddFor] = useState<TradeFile | null>(null);
  const [unlinkFor, setUnlinkFor] = useState<TradeFile | null>(null);
  const [deleteFor, setDeleteFor] = useState<TradeFile | null>(null);

  const removeLink = useTradeMutation((a, v: { fileId: string; linkId: string }) => a.removeLink(v.fileId, v.linkId));
  const deleteFile = useTradeMutation((a, id: string) => a.deleteFile(id));
  // B/L drafts: (re-)read with AI and check against the linked shipment's contract.
  const extractBl = useTradeMutation((a, v: { fileId: string; shipmentId?: string }) => a.extractBlDraft(v));
  const recheck = async (f: TradeFile) => {
    const shipmentId = f.links.find((l) => l.shipmentId === currentId)?.shipmentId ?? f.links.find((l) => l.shipmentId)?.shipmentId ?? undefined;
    const tid = toast.info(t("reading", { name: f.fileName }), { autoClose: false });
    try {
      const x = await extractBl.mutateAsync({ fileId: f.id, shipmentId });
      toast.dismiss(tid);
      if (x.status !== "DONE") toast.error(x.error || t("blReadError"));
      else if (!shipmentId) toast.success(t("blReadNoShipment"));
      else toast.success(x.issueCount ? t("blIssues", { n: x.issueCount }) : t("blAllOk"));
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || t("blReadError"));
    }
  };

  const { open: openViewer, viewer } = useFileViewer();
  const view = (f: Pick<TradeFile, "id" | "fileName" | "mimeType" | "hasThumb">) => openViewer({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, hasThumb: f.hasThumb });

  const openMenu = (e: React.MouseEvent, file: TradeFile) => {
    e.stopPropagation();
    setMenu({ pos: { left: e.clientX, top: e.clientY }, file });
  };

  const kebab = (f: TradeFile) => (
    <IconButton size="small" aria-label={t("fileActions")} onClick={(e) => openMenu(e, f)}>
      <MoreVertIcon fontSize="small" />
    </IconButton>
  );

  const pick = (fn: (f: TradeFile) => void) => () => {
    const f = menu?.file;
    setMenu(null);
    if (f) fn(f);
  };

  const dialogs = (
    <>
      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)} onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={pick(view)}>{t("view")}</MenuItem>
        {menu?.file.docType === "BL_DRAFT" && <MenuItem onClick={pick((f) => void recheck(f))}>{t("recheck")}</MenuItem>}
        <MenuItem onClick={pick(setAddFor)}>{t("addLink")}</MenuItem>
        <MenuItem onClick={pick(setUnlinkFor)} disabled={!menu?.file.links.length}>
          {t("unlink")}
        </MenuItem>
        <MenuItem onClick={pick(setDeleteFor)} sx={{ color: "error.main" }}>
          {t("delete")}
        </MenuItem>
      </Menu>
      <AddLinkDialog file={addFor} onClose={() => setAddFor(null)} />
      {viewer}
      <UnlinkDialog
        file={unlinkFor}
        currentId={currentId}
        onClose={() => setUnlinkFor(null)}
        onConfirm={async (linkId) => {
          await removeLink.mutateAsync({ fileId: unlinkFor!.id, linkId });
          toast.success(t("linkRemoved"));
        }}
      />
      <ConfirmDialog
        open={!!deleteFor}
        title={t("deleteTitle", { name: deleteFor?.fileName ?? "" })}
        body={t("deleteBody")}
        confirmLabel={t("delete")}
        destructive
        onClose={() => setDeleteFor(null)}
        onConfirm={async () => {
          await deleteFile.mutateAsync(deleteFor!.id);
          toast.success(t("deleted"));
        }}
      />
    </>
  );

  const columns = useMemo(
    () => [
      {
        id: "preview",
        header: "",
        enableSorting: false,
        cell: ({ row }: any) => <FileThumb file={row.original} width={40} onOpen={(f) => view({ ...row.original, ...f })} />,
      },
      {
        id: "docRef",
        header: t("docId"),
        cell: ({ row }: any) => (
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap" }}>
            {row.original.docRef || "—"}
          </Typography>
        ),
      },
      { id: "docType", header: t("docType"), cell: ({ row }: any) => <Chip size="small" variant="outlined" label={row.original.docTypeLabel} /> },
      {
        id: "fileName",
        header: t("fileName"),
        cell: ({ row }: any) => (
          <Box sx={{ maxWidth: 320 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word", whiteSpace: "normal" }}>
              {row.original.fileName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {fmtBytes(row.original.sizeBytes)}
              {row.original.notes ? ` · ${row.original.notes}` : ""}
            </Typography>
          </Box>
        ),
      },
      { id: "links", header: t("linkedTo"), cell: ({ row }: any) => <LinkChips links={row.original.links} currentId={currentId} /> },
      { id: "uploadedBy", header: t("uploadedBy"), cell: ({ row }: any) => row.original.uploadedByName || "—" },
      {
        id: "uploadedAt",
        header: t("uploadedAt"),
        cell: ({ row }: any) => (
          <Tooltip title={fmtDateTime(row.original.createdAt)}>
            <span>{fmtDate(row.original.createdAt)}</span>
          </Tooltip>
        ),
      },
      { id: "actions", header: "", enableSorting: false, cell: ({ row }: any) => <Box onClick={(e) => e.stopPropagation()}>{kebab(row.original)}</Box> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentId, t],
  );

  return { columns, dialogs, view };
}

/** Files linked to one contract or shipment, with an Upload button. */
export default function FilesTable({ filter, currentId, uploadTargets, canUpload = true }: { filter: FileFilters; currentId: string; uploadTargets: LinkTarget[]; canUpload?: boolean }) {
  const t = useTranslations("orders.files");
  const [page, setPage] = useState(1);
  const q = useTradeFiles({ ...filter, page, pageSize: 50 });
  const { columns, dialogs, view } = useFileActions(currentId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const items = q.data?.items ?? [];

  const uploadButton = (
    <Tooltip title={canUpload ? "" : t("reopenToAdd")}>
      <span>
        <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => setUploadOpen(true)} disabled={!canUpload}>
          {t("upload")}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {q.data ? t("fileCount", { n: q.data.total }) : ""}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {uploadButton}
      </Stack>
      {q.isError && <Alert severity="error" sx={{ mb: 2 }}>{(q.error as Error)?.message || t("loadError")}</Alert>}
      {!q.isLoading && !items.length ? (
        <EmptyState title={t("empty")} action={canUpload ? uploadButton : undefined} />
      ) : (
        <Box sx={{ border: "1px solid var(--table-grid)", borderRadius: "8px", overflowX: "auto", bgcolor: "background.paper" }}>
          <Table columns={columns} data={items} loading={q.isLoading} onRowClick={(f: TradeFile) => view(f)} isNoSelectionColumn />
        </Box>
      )}
      {q.data && q.data.totalPages > 1 && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("previous")}
          </Button>
          <Typography variant="body2" sx={{ alignSelf: "center" }}>
            {page} / {q.data.totalPages}
          </Typography>
          <Button size="small" disabled={page >= q.data.totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("next")}
          </Button>
        </Stack>
      )}
      {dialogs}
      <FileUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} defaultTargets={uploadTargets} />
    </Box>
  );
}

export function AddLinkDialog({ file, onClose }: { file: TradeFile | null; onClose: () => void }) {
  const t = useTranslations("orders.files");
  const open = !!file;
  const orders = useOrders({ bucket: "pending", pageSize: 100 }, open);
  const shipments = useShipments({ status: "OPEN", pageSize: 100 }, open);
  const [targets, setTargets] = useState<LinkTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = useTradeMutation((a, v: { id: string; targets: LinkTarget[] }) => a.addLinks(v.id, linkTargetsOf(v.targets)));

  const linked = new Set((file?.links ?? []).map((l) => l.orderId ?? l.contractId ?? l.shipmentId));
  const options: LinkTarget[] = [
    ...(orders.data?.items ?? []).map((o) => ({ kind: "order" as const, id: o.id, label: `${t("linkOrder", { no: o.label })}${o.customerName ? ` · ${o.customerName}` : ""}` })),
    ...(shipments.data?.items ?? []).map((s) => ({ kind: "shipment" as const, id: s.id, label: `${t("linkShipment", { no: s.ref || s.blNumber || t("blPending") })}${s.blNumber && s.ref ? ` · B/L ${s.blNumber}` : ""}` })),
  ].filter((o) => !linked.has(o.id));

  const close = () => {
    if (add.isPending) return;
    setTargets([]);
    setError(null);
    onClose();
  };
  const submit = async () => {
    setError(null);
    try {
      await add.mutateAsync({ id: file!.id, targets });
      toast.success(t("linksAdded"));
      setTargets([]);
      onClose();
    } catch (e: any) {
      setError(e?.message || t("addLinksError"));
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{t("linkTitle", { name: file?.fileName ?? "" })}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Autocomplete
          multiple
          options={options}
          value={targets}
          onChange={(_, v) => setTargets(v)}
          groupBy={(o) => targetGroup(o.kind)}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          loading={orders.isLoading || shipments.isLoading}
          renderInput={(p) => <TextField {...p} label={t("alsoLinkTo")} size="small" sx={{ mt: 1 }} />}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={add.isPending}>
          {t("cancel")}
        </Button>
        <Button variant="contained" onClick={submit} disabled={!targets.length || add.isPending}>
          {add.isPending ? t("linking") : t("addLinks")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function UnlinkDialog({ file, currentId, onClose, onConfirm }: { file: TradeFile | null; currentId?: string; onClose: () => void; onConfirm: (linkId: string) => Promise<void> }) {
  const t = useTranslations("orders.files");
  const [linkId, setLinkId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const links = file?.links ?? [];
  // Default to the record the user is on, else the only link.
  const fallback = links.find((l) => (l.orderId ?? l.contractId ?? l.shipmentId) === currentId)?.id ?? (links.length === 1 ? links[0].id : "");
  const selected = linkId || fallback;

  const close = () => {
    if (busy) return;
    setLinkId("");
    setError(null);
    onClose();
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected);
      setLinkId("");
      onClose();
    } catch (e: any) {
      setError(e?.message || t("removeLinkError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!file} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{t("unlinkTitle", { name: file?.fileName ?? "" })}</DialogTitle>
      <DialogContent>
        <RadioGroup value={selected} onChange={(e) => setLinkId(e.target.value)}>
          {links.map((l) => (
            <FormControlLabel key={l.id} value={l.id} control={<Radio size="small" />} label={linkLabel(l, t)} />
          ))}
        </RadioGroup>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button variant="contained" color="error" onClick={submit} disabled={!selected || busy}>
          {busy ? t("removing") : t("unlink")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
