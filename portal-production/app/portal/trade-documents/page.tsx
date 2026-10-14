/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Trade Documents hub (top-level "Documents" for orgs whose DOCUMENTS module
// row points here — ADH Japan). One list of everything: uploaded trade files,
// in-app invoices linked to contracts / shipments, and in-app generated
// documents (Customer PL / COA). Category chips across the top; the Filter
// drawer narrows by doc type, contract, B/L, customer, source and date.

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Chip, IconButton, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { toast } from "../shipments/_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { useShipmentsApi, type HubRow, type TradeFile } from "@/app/portal/shipments/_lib/api";
import { useContracts, useCustomers, useDocTypes, useHub, useShipments, useTradeMutation } from "@/app/portal/shipments/_lib/hooks";
import { blLabel, categoryLabel, DOC_CATEGORIES, documentHref, fmtDate, fmtDateTime } from "@/app/portal/shipments/_lib/format";
import { ConfirmDialog, EmptyState } from "@/app/portal/shipments/_components/bits";
import { AddLinkDialog, UnlinkDialog } from "@/app/portal/shipments/_components/FilesTable";
import FileUploadDialog from "@/app/portal/shipments/_components/FileUploadDialog";
import { FileThumb, FileTypeIcon, useFileViewer } from "@/app/portal/shipments/_components/FilePreview";
import { useDebounced } from "@/app/portal/shipments/_components/useDebounced";

const HERE = "/portal/trade-documents";
type DateRange = { startDate?: Date | string | null; endDate?: Date | string | null };
type Filters = { docType: string; contractId: string; shipmentId: string; customerId: string; source: string; createdOn: DateRange };
const EMPTY: Filters = { docType: "", contractId: "", shipmentId: "", customerId: "", source: "", createdOn: { startDate: null, endDate: null } };
const dayIso = (d?: Date | string | null, end = false) => {
  if (!d) return undefined;
  const x = new Date(d);
  x.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return x.toISOString();
};

/** HubRow → the TradeFile shape the shared Add link / Unlink dialogs take. */
const asTradeFile = (r: HubRow): TradeFile =>
  ({
    id: r.fileId ?? r.id,
    fileName: r.name,
    links: r.links
      .filter((l) => l.linkId)
      .map((l) => ({ id: l.linkId!, contractId: l.contractId, shipmentId: l.shipmentId, stepId: null, createdAt: r.date, contract: l.contractNo ? { contractNo: l.contractNo } : null, shipment: l.shipmentId ? { blNumber: l.blNumber } : null })),
  }) as any;

export default function TradeDocumentsHubPage() {
  const router = useRouter();
  const api = useShipmentsApi();
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const q = useDebounced(search);
  const hub = useHub({
    page,
    pageSize: limit,
    q: q || undefined,
    category: category || undefined,
    docType: filters.docType || undefined,
    contractId: filters.contractId || undefined,
    shipmentId: filters.shipmentId || undefined,
    customerId: filters.customerId || undefined,
    source: filters.source || undefined,
    from: dayIso(filters.createdOn?.startDate),
    to: dayIso(filters.createdOn?.endDate, true),
  });
  const docTypes = useDocTypes();
  const contracts = useContracts({ pageSize: 100 });
  const shipments = useShipments({ pageSize: 100 });
  const customers = useCustomers();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: HubRow } | null>(null);
  const [addFor, setAddFor] = useState<HubRow | null>(null);
  const [unlinkFor, setUnlinkFor] = useState<HubRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<HubRow | null>(null);
  const removeFileLink = useTradeMutation((a, v: { fileId: string; linkId: string }) => a.removeLink(v.fileId, v.linkId));
  const unlinkInvoice = useTradeMutation((a, linkId: string) => a.unlinkDocument(linkId));
  const deleteFile = useTradeMutation((a, id: string) => a.deleteFile(id));
  // B/L draft files: (re-)read with AI and check against the linked shipment's contract.
  const extractBl = useTradeMutation((a, v: { fileId: string; shipmentId?: string }) => a.extractBlDraft(v));
  const recheckBl = async (r: HubRow) => {
    if (!r.fileId) return;
    const shipmentId = r.links.find((l) => l.shipmentId)?.shipmentId ?? undefined;
    const t = toast.info(`Reading ${r.name}…`, { autoClose: false });
    try {
      const x = await extractBl.mutateAsync({ fileId: r.fileId, shipmentId });
      toast.dismiss(t);
      if (x.status !== "DONE") toast.error(x.error || "Could not read the B/L draft");
      else if (!shipmentId) toast.success("B/L draft read — link it to a shipment to check it against the contract");
      else toast.success(x.issueCount ? `B/L check: ${x.issueCount} issue${x.issueCount === 1 ? "" : "s"} — see the shipment's B/L draft step` : "B/L check: all ✓");
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(e?.message || "Could not read the B/L draft");
    }
  };
  const deleteGenerated = useTradeMutation((a, id: string) => a.deleteGenerated(id));

  // Files open in the in-app viewer (PDF pages / image, with download).
  const { open: openViewer, viewer } = useFileViewer();
  const viewFile = (r: HubRow) => r.fileId && openViewer({ id: r.fileId, fileName: r.name, mimeType: r.mimeType ?? "", hasThumb: r.hasThumb });
  const open = (r: HubRow) => {
    if (r.kind === "file" && r.fileId) return viewFile(r);
    if (r.kind === "invoice" && r.document) return router.push(documentHref(r.document, HERE));
    if (r.kind === "generated") return router.push(`/portal/trade-documents/generated/${r.id}?from=${encodeURIComponent(HERE)}`);
  };

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "docType", label: "Document type", options: (docTypes.data ?? []).filter((d) => !category || d.category === category).map((d) => ({ value: d.code, label: d.label })) },
      { type: "select", key: "contractId", label: "Contract", options: (contracts.data?.items ?? []).map((c) => ({ value: c.id, label: c.contractNo })) },
      { type: "select", key: "shipmentId", label: "B/L", options: (shipments.data?.items ?? []).map((s) => ({ value: s.id, label: `${blLabel(s.blNumber)}${s.contractNo ? ` · ${s.contractNo}` : ""}` })) },
      { type: "select", key: "customerId", label: "Customer", options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
      { type: "select", key: "source", label: "Source", options: [{ value: "UPLOADED", label: "Uploaded" }, { value: "IN_APP", label: "Created in-app" }] },
      { type: "dateRange", key: "createdOn", label: "Date" },
    ],
    [docTypes.data, contracts.data, shipments.data, customers.data, category],
  );

  const statusChip = (r: HubRow) => {
    if (!r.status) return <Typography variant="caption" color="text.secondary">—</Typography>;
    const color = r.status === "Confirmed" || r.status === "Final" ? "success" : r.status === "Draft" ? "warning" : "error";
    return <Chip size="small" variant="outlined" color={color as any} label={r.status} />;
  };

  const columns = useMemo(
    () => [
      {
        id: "preview",
        header: "",
        enableSorting: false,
        cell: ({ row }: any) => {
          const r: HubRow = row.original;
          return r.fileId ? (
            <FileThumb file={{ id: r.fileId, fileName: r.name, mimeType: r.mimeType ?? "", hasThumb: r.hasThumb }} width={40} onOpen={() => viewFile(r)} />
          ) : (
            <Box sx={{ width: 40, display: "flex", justifyContent: "center" }}>
              <FileTypeIcon fileName={r.name} mimeType={r.kind === "invoice" ? "application/pdf" : undefined} size={22} />
            </Box>
          );
        },
      },
      { id: "category", header: "Category", cell: ({ row }: any) => <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>{categoryLabel(row.original.category)}</Typography> },
      { id: "docType", header: "Doc type", cell: ({ row }: any) => <Chip size="small" variant="outlined" label={row.original.docTypeLabel} /> },
      {
        id: "name",
        header: "Name / number",
        cell: ({ row }: any) => (
          <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word", whiteSpace: "normal", maxWidth: 260 }}>
            {row.original.name}
          </Typography>
        ),
      },
      { id: "source", header: "Source", cell: ({ row }: any) => <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>{row.original.source === "IN_APP" ? "Created in-app" : "Uploaded"}</Typography> },
      { id: "status", header: "Status", cell: ({ row }: any) => statusChip(row.original) },
      {
        id: "links",
        header: "Linked to",
        cell: ({ row }: any) =>
          row.original.links.length ? (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {row.original.links.map((l: any, i: number) => (
                <Chip
                  key={i}
                  size="small"
                  variant="outlined"
                  color={l.contractId ? "primary" : "info"}
                  label={l.contractId ? `Contract ${l.contractNo ?? ""}` : `B/L ${blLabel(l.blNumber)}`}
                  component={Link}
                  href={l.contractId ? `/portal/shipments/contracts/${l.contractId}` : `/portal/shipments/${l.shipmentId}`}
                  clickable
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                />
              ))}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">Not linked</Typography>
          ),
      },
      { id: "customer", header: "Customer", cell: ({ row }: any) => row.original.customerName || "—" },
      { id: "recipient", header: "Recipient", cell: ({ row }: any) => row.original.recipient || "—" },
      { id: "createdBy", header: "Created by", cell: ({ row }: any) => row.original.createdBy || "—" },
      {
        id: "date",
        header: "Date",
        cell: ({ row }: any) => (
          <Tooltip title={fmtDateTime(row.original.date)}>
            <span>{fmtDate(row.original.date)}</span>
          </Tooltip>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }: any) => (
          <IconButton
            size="small"
            aria-label="Document actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original });
            }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        ),
      },
    ],
    [],
  );

  const items = hub.data?.items ?? [];
  const counts = hub.data?.categoryCounts ?? {};
  const filtered = !!(q || category || Object.entries(filters).some(([k, v]) => (k === "createdOn" ? (v as DateRange)?.startDate || (v as DateRange)?.endDate : v)));
  const m = menu?.row;
  const pick = (fn: (r: HubRow) => void) => () => {
    const r = menu?.row;
    setMenu(null);
    if (r) fn(r);
  };

  const categoryChips = (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Chip label={`All${hub.data ? ` (${hub.data.allCount})` : ""}`} color={!category ? "primary" : "default"} variant={!category ? "filled" : "outlined"} onClick={() => { setCategory(""); setPage(1); }} />
      {DOC_CATEGORIES.map((c) => (
        <Chip
          key={c.code}
          label={`${c.label}${counts[c.code] ? ` (${counts[c.code]})` : ""}`}
          color={category === c.code ? "primary" : "default"}
          variant={category === c.code ? "filled" : "outlined"}
          onClick={() => {
            setCategory(c.code);
            setFilters((f) => ({ ...f, docType: "" }));
            setPage(1);
          }}
        />
      ))}
    </Stack>
  );

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }}>
      <PageTable
        tableName="Documents"
        actionButtons={[
          <Button key="upload" variant="contained" startIcon={<UploadFileIcon />} onClick={() => setUploadOpen(true)}>
            Upload documents
          </Button>,
        ]}
        columns={columns}
        data={items}
        loading={hub.isLoading}
        page={page}
        limit={limit}
        search={search}
        setPage={setPage}
        setLimit={(l) => {
          setLimit(l);
          setPage(1);
        }}
        setSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        filters={filters}
        setFilters={(f) => {
          setFilters({ ...EMPTY, ...f, createdOn: f.createdOn ?? EMPTY.createdOn });
          setPage(1);
        }}
        filterConfig={filterConfig}
        pageCount={hub.data?.totalPages ?? 1}
        totalDocs={hub.data?.total}
        onRowClick={(r: HubRow) => open(r)}
        noSelectionColumn
        manualSorting
        hideTable={!hub.isLoading && !hub.isError && !items.length}
        headerContent={
          <Stack spacing={2}>
            {categoryChips}
            {hub.isError ? (
              <Alert severity="error">{(hub.error as Error)?.message || "Could not load documents"}</Alert>
            ) : !hub.isLoading && !items.length ? (
              filtered ? (
                <EmptyState title="No documents match these filters" />
              ) : (
                <EmptyState
                  title="No documents yet"
                  action={
                    <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => setUploadOpen(true)}>
                      Upload documents
                    </Button>
                  }
                />
              )
            ) : null}
          </Stack>
        }
      />

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        {m?.kind === "file" && [
          <MenuItem key="view" onClick={pick((r) => viewFile(r))}>View</MenuItem>,
          ...(m.docType === "BL_DRAFT" ? [<MenuItem key="extract" onClick={pick((r) => void recheckBl(r))}>Extract / re-check</MenuItem>] : []),
          <MenuItem key="add" onClick={pick(setAddFor)}>Add link</MenuItem>,
          <MenuItem key="unlink" onClick={pick(setUnlinkFor)} disabled={!m.links.length}>Unlink</MenuItem>,
          <MenuItem key="delete" onClick={pick(setDeleteFor)} sx={{ color: "error.main" }}>Delete</MenuItem>,
        ]}
        {m?.kind === "invoice" && [
          <MenuItem key="open" onClick={pick(open)} disabled={!m.document}>Open invoice</MenuItem>,
          <MenuItem key="unlink" onClick={pick(setUnlinkFor)}>Unlink</MenuItem>,
        ]}
        {m?.kind === "generated" && [
          <MenuItem key="open" onClick={pick(open)}>Open</MenuItem>,
          <MenuItem key="pdf" onClick={pick((r) => viewFile(r))} disabled={!m.fileId}>View PDF</MenuItem>,
          <MenuItem
            key="download"
            onClick={pick((r) =>
              void api.downloadGeneratedPdf(r.id).catch((e: any) => toast.error(e?.message || "Could not download the PDF")),
            )}
          >
            {m.status === "Final" ? "Download PDF" : "Download draft PDF"}
          </MenuItem>,
          <MenuItem key="delete" onClick={pick(setDeleteFor)} disabled={m.status === "Final"} sx={{ color: "error.main" }}>
            Delete draft
          </MenuItem>,
        ]}
      </Menu>

      <AddLinkDialog file={addFor ? asTradeFile(addFor) : null} onClose={() => setAddFor(null)} />
      <UnlinkDialog
        file={unlinkFor ? asTradeFile(unlinkFor) : null}
        onClose={() => setUnlinkFor(null)}
        onConfirm={async (linkId) => {
          if (unlinkFor?.kind === "invoice") await unlinkInvoice.mutateAsync(linkId);
          else await removeFileLink.mutateAsync({ fileId: unlinkFor!.fileId!, linkId });
          toast.success("Link removed");
        }}
      />
      <ConfirmDialog
        open={!!deleteFor}
        title={`Delete “${deleteFor?.name ?? ""}”?`}
        body={deleteFor?.kind === "generated" ? "The draft is removed. The supplier file it came from stays." : "The file is removed from storage and from every contract and shipment it is linked to. This can't be undone."}
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleteFor(null)}
        onConfirm={async () => {
          if (deleteFor!.kind === "generated") await deleteGenerated.mutateAsync(deleteFor!.id);
          else await deleteFile.mutateAsync(deleteFor!.fileId!);
          toast.success("Deleted");
        }}
      />
      <FileUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
      {viewer}
    </Box>
  );
}
