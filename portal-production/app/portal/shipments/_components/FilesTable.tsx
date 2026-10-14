/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Trade documents table + the row actions shared with the Documents library:
// View (signed URL in a new tab), Add link, Unlink, Delete. Clicking a row
// views the file; secondary actions sit behind a click-anchored kebab.

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Menu, MenuItem, Radio, RadioGroup, Stack, TextField, Tooltip, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { toast } from "../_lib/toast";
import Table from "@/components/Table";
import type { FileFilters, TradeFile, TradeFileLink } from "../_lib/api";
import { useShipmentsApi } from "../_lib/api";
import { useContracts, useShipments, useTradeFiles, useTradeMutation } from "../_lib/hooks";
import { blLabel, fmtBytes, fmtDate, fmtDateTime } from "../_lib/format";
import { ConfirmDialog, EmptyState } from "./bits";
import FileUploadDialog, { type LinkTarget } from "./FileUploadDialog";

const linkLabel = (l: TradeFileLink) => (l.contractId ? `Contract ${l.contract?.contractNo ?? ""}` : `Shipment ${blLabel(l.shipment?.blNumber)}`);
const linkHref = (l: TradeFileLink) => (l.contractId ? `/portal/shipments/contracts/${l.contractId}` : `/portal/shipments/${l.shipmentId}`);

export const LinkChips = ({ links, currentId }: { links: TradeFileLink[]; currentId?: string }) =>
  links.length ? (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {links.map((l) => {
        const isCurrent = !!currentId && (l.contractId ?? l.shipmentId) === currentId;
        return (
          <Chip
            key={l.id}
            size="small"
            variant="outlined"
            color={l.contractId ? "primary" : "info"}
            label={linkLabel(l)}
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
      Not linked
    </Typography>
  );

/** Row menu + dialogs for trade files. Render `dialogs` once next to the table. */
export function useFileActions(currentId?: string) {
  const api = useShipmentsApi();
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
    const t = toast.info(`Reading ${f.fileName}…`, { autoClose: false });
    try {
      const x = await extractBl.mutateAsync({ fileId: f.id, shipmentId });
      toast.dismiss(t);
      if (x.status !== "DONE") toast.error(x.error || "Could not read the B/L draft");
      else if (!shipmentId) toast.success("B/L draft read — link it to a shipment to check it against the contract");
      else toast.success(x.issueCount ? `B/L check: ${x.issueCount} issue${x.issueCount === 1 ? "" : "s"} — see the shipment's B/L draft step` : "B/L check: all ✓");
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(e?.message || "Could not read the B/L draft");
    }
  };

  const view = async (f: TradeFile) => {
    // Open the tab synchronously so the popup blocker allows it, then point it at the signed URL.
    const tab = typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      const r = await api.fileUrl(f.id);
      if (tab) tab.location.href = r.url;
      else window.open(r.url, "_blank", "noopener");
    } catch (e: any) {
      tab?.close();
      toast.error(e?.message || "Could not open the file");
    }
  };

  const openMenu = (e: React.MouseEvent, file: TradeFile) => {
    e.stopPropagation();
    setMenu({ pos: { left: e.clientX, top: e.clientY }, file });
  };

  const kebab = (f: TradeFile) => (
    <IconButton size="small" aria-label="File actions" onClick={(e) => openMenu(e, f)}>
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
        <MenuItem onClick={pick(view)}>View</MenuItem>
        {menu?.file.docType === "BL_DRAFT" && <MenuItem onClick={pick((f) => void recheck(f))}>Extract / re-check</MenuItem>}
        <MenuItem onClick={pick(setAddFor)}>Add link</MenuItem>
        <MenuItem onClick={pick(setUnlinkFor)} disabled={!menu?.file.links.length}>
          Unlink
        </MenuItem>
        <MenuItem onClick={pick(setDeleteFor)} sx={{ color: "error.main" }}>
          Delete
        </MenuItem>
      </Menu>
      <AddLinkDialog file={addFor} onClose={() => setAddFor(null)} />
      <UnlinkDialog
        file={unlinkFor}
        currentId={currentId}
        onClose={() => setUnlinkFor(null)}
        onConfirm={async (linkId) => {
          await removeLink.mutateAsync({ fileId: unlinkFor!.id, linkId });
          toast.success("Link removed");
        }}
      />
      <ConfirmDialog
        open={!!deleteFor}
        title={`Delete “${deleteFor?.fileName ?? ""}”?`}
        body="The file is removed from storage and from every contract and shipment it is linked to. This can't be undone."
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleteFor(null)}
        onConfirm={async () => {
          await deleteFile.mutateAsync(deleteFor!.id);
          toast.success("File deleted");
        }}
      />
    </>
  );

  const columns = useMemo(
    () => [
      { id: "docType", header: "Document type", cell: ({ row }: any) => <Chip size="small" variant="outlined" label={row.original.docTypeLabel} /> },
      {
        id: "fileName",
        header: "File name",
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
      { id: "links", header: "Linked to", cell: ({ row }: any) => <LinkChips links={row.original.links} currentId={currentId} /> },
      { id: "uploadedBy", header: "Uploaded by", cell: ({ row }: any) => row.original.uploadedByName || "—" },
      {
        id: "uploadedAt",
        header: "Uploaded at",
        cell: ({ row }: any) => (
          <Tooltip title={fmtDateTime(row.original.createdAt)}>
            <span>{fmtDate(row.original.createdAt)}</span>
          </Tooltip>
        ),
      },
      { id: "actions", header: "", enableSorting: false, cell: ({ row }: any) => <Box onClick={(e) => e.stopPropagation()}>{kebab(row.original)}</Box> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentId],
  );

  return { columns, dialogs, view };
}

/** Files linked to one contract or shipment, with an Upload button. */
export default function FilesTable({ filter, currentId, uploadTargets, canUpload = true }: { filter: FileFilters; currentId: string; uploadTargets: LinkTarget[]; canUpload?: boolean }) {
  const [page, setPage] = useState(1);
  const q = useTradeFiles({ ...filter, page, pageSize: 50 });
  const { columns, dialogs, view } = useFileActions(currentId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const items = q.data?.items ?? [];

  const uploadButton = (
    <Tooltip title={canUpload ? "" : "Reopen this record to add documents"}>
      <span>
        <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => setUploadOpen(true)} disabled={!canUpload}>
          Upload
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {q.data ? `${q.data.total} file${q.data.total === 1 ? "" : "s"}` : ""}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {uploadButton}
      </Stack>
      {q.isError && <Alert severity="error" sx={{ mb: 2 }}>{(q.error as Error)?.message || "Could not load files"}</Alert>}
      {!q.isLoading && !items.length ? (
        <EmptyState title="No documents yet" action={canUpload ? uploadButton : undefined} />
      ) : (
        <Box sx={{ border: "1px solid var(--table-grid)", borderRadius: "8px", overflowX: "auto", bgcolor: "background.paper" }}>
          <Table columns={columns} data={items} loading={q.isLoading} onRowClick={(f: TradeFile) => view(f)} isNoSelectionColumn />
        </Box>
      )}
      {q.data && q.data.totalPages > 1 && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Typography variant="body2" sx={{ alignSelf: "center" }}>
            {page} / {q.data.totalPages}
          </Typography>
          <Button size="small" disabled={page >= q.data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </Stack>
      )}
      {dialogs}
      <FileUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} defaultTargets={uploadTargets} />
    </Box>
  );
}

export function AddLinkDialog({ file, onClose }: { file: TradeFile | null; onClose: () => void }) {
  const open = !!file;
  const contracts = useContracts({ status: "OPEN", pageSize: 100 }, open);
  const shipments = useShipments({ status: "OPEN", pageSize: 100 }, open);
  const [targets, setTargets] = useState<LinkTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const add = useTradeMutation((a, v: { id: string; contractIds: string[]; shipmentIds: string[] }) => a.addLinks(v.id, { contractIds: v.contractIds, shipmentIds: v.shipmentIds }));

  const linked = new Set((file?.links ?? []).map((l) => l.contractId ?? l.shipmentId));
  const options: LinkTarget[] = [
    ...(contracts.data?.items ?? []).map((c) => ({ kind: "contract" as const, id: c.id, label: `Contract ${c.contractNo}` })),
    ...(shipments.data?.items ?? []).map((s) => ({ kind: "shipment" as const, id: s.id, label: `Shipment ${blLabel(s.blNumber)}${s.contractNo ? ` · ${s.contractNo}` : ""}` })),
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
      await add.mutateAsync({
        id: file!.id,
        contractIds: targets.filter((t) => t.kind === "contract").map((t) => t.id),
        shipmentIds: targets.filter((t) => t.kind === "shipment").map((t) => t.id),
      });
      toast.success("Links added");
      setTargets([]);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not add the links");
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Link “{file?.fileName}”</DialogTitle>
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
          groupBy={(o) => (o.kind === "contract" ? "Contracts" : "Shipments")}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          loading={contracts.isLoading || shipments.isLoading}
          renderInput={(p) => <TextField {...p} label="Also link to" size="small" sx={{ mt: 1 }} />}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={add.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={!targets.length || add.isPending}>
          {add.isPending ? "Linking…" : "Add links"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function UnlinkDialog({ file, currentId, onClose, onConfirm }: { file: TradeFile | null; currentId?: string; onClose: () => void; onConfirm: (linkId: string) => Promise<void> }) {
  const [linkId, setLinkId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const links = file?.links ?? [];
  // Default to the record the user is on, else the only link.
  const fallback = links.find((l) => (l.contractId ?? l.shipmentId) === currentId)?.id ?? (links.length === 1 ? links[0].id : "");
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
      setError(e?.message || "Could not remove the link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!file} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>Unlink “{file?.fileName}”</DialogTitle>
      <DialogContent>
        <RadioGroup value={selected} onChange={(e) => setLinkId(e.target.value)}>
          {links.map((l) => (
            <FormControlLabel key={l.id} value={l.id} control={<Radio size="small" />} label={linkLabel(l)} />
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
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={submit} disabled={!selected || busy}>
          {busy ? "Removing…" : "Unlink"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
