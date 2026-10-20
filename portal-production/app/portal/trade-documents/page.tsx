/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Trade Documents hub (top-level "Documents" for orgs whose DOCUMENTS module
// row points here — ADH Japan). One list of everything: uploaded trade files,
// in-app invoices linked to contracts / shipments, and in-app generated
// documents (Customer PL / COA). Looks like the Shipments pages (round L):
// underlined category tabs with counts (empty ones hidden, All always shown),
// search (doc ID / doc no. / B/L / order no. / file name), and the columns
// Doc ID · Type · Name / number · Order / shipment · B/L · Customer · Status ·
// Date. The Filter drawer narrows by doc type, contract, B/L, customer, source
// and date. A row opens the document's preview.

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Chip, IconButton, Menu, MenuItem, Stack, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { toast } from "../shipments/_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { useShipmentsApi, type HubRow, type TradeFile } from "@/app/portal/shipments/_lib/api";
import { useContracts, useCustomers, useDocTypes, useHub, useShipments, useTradeMutation } from "@/app/portal/shipments/_lib/hooks";
import { blLabel, documentHref, fmtDate, fmtDateTime } from "@/app/portal/shipments/_lib/format";
import { ConfirmDialog, EmptyState } from "@/app/portal/shipments/_components/bits";
import { AddLinkDialog, UnlinkDialog } from "@/app/portal/shipments/_components/FilesTable";
import FileUploadDialog from "@/app/portal/shipments/_components/FileUploadDialog";
import { useFileViewer } from "@/app/portal/shipments/_components/FilePreview";
import { useDebounced } from "@/app/portal/shipments/_components/useDebounced";
import { visibleTabs } from "@/app/portal/shipments/_lib/hub-tabs";

const HERE = "/portal/trade-documents";
const placeHref = (p: NonNullable<HubRow["place"]>) => (p.orderId ? `/portal/shipments/orders/${p.orderId}${p.shipmentId ? `?shipment=${p.shipmentId}` : ""}` : p.shipmentId ? `/portal/shipments/${p.shipmentId}` : null);
type DateRange = { startDate?: Date | string | null; endDate?: Date | string | null };
type Filters = { docType: string; contractId: string; shipmentId: string; customerId: string; source: string; entity: string; createdOn: DateRange };
const EMPTY: Filters = { docType: "", contractId: "", shipmentId: "", customerId: "", source: "", entity: "", createdOn: { startDate: null, endDate: null } };
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
    entity: filters.entity || undefined,
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
  const viewFile = (r: HubRow) => r.fileId && openViewer({ id: r.fileId, fileName: r.name, mimeType: r.mimeType ?? "", hasThumb: r.hasThumb, docRef: r.docRef });
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
      { type: "select", key: "entity", label: "Issued by", options: [{ value: "ADH_JP", label: "ADH JP (合同会社)" }, { value: "ADH_SG", label: "ADH SG (Pte. Ltd.)" }] },
      { type: "dateRange", key: "createdOn", label: "Date" },
    ],
    [docTypes.data, contracts.data, shipments.data, customers.data, category],
  );

  const items = hub.data?.items ?? [];
  // "Recipient" only when some row has one (SI → warehouse, SG→JP → ADH Japan).
  const showRecipient = items.some((r) => !!r.recipient);
  const columns = useMemo(
    () => [
      {
        id: "docRef",
        header: "Doc ID",
        cell: ({ row }: any) => (
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700, whiteSpace: "nowrap" }}>
            {row.original.docRef || "—"}
          </Typography>
        ),
      },
      {
        id: "docType",
        header: "Type",
        cell: ({ row }: any) => (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ whiteSpace: "nowrap" }}>
            <Typography variant="body2">{row.original.docTypeLabel}</Typography>
            {row.original.issuingEntity && (
              <Chip
                size="small"
                variant="outlined"
                color={row.original.issuingEntity === "ADH_SG" ? "info" : "secondary"}
                label={row.original.issuingEntity === "ADH_SG" ? "SG" : "JP"}
                sx={{ height: 18, fontSize: 10.5, "& .MuiChip-label": { px: 0.6 } }}
                data-tour="hub-entity-badge"
              />
            )}
          </Stack>
        ),
      },
      {
        id: "name",
        header: "Name / number",
        cell: ({ row }: any) => (
          <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word", whiteSpace: "normal", maxWidth: 260 }}>
            {row.original.name}
          </Typography>
        ),
      },
      {
        id: "place",
        header: "Order / shipment",
        cell: ({ row }: any) => {
          const p = row.original.place;
          const href = p ? placeHref(p) : null;
          if (p?.ref && href)
            return (
              <Link href={href} onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ fontWeight: 700, whiteSpace: "nowrap" }} data-tour="hub-order-link">
                {p.ref}
              </Link>
            );
          if (p?.contractNo) return <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>Contract {p.contractNo}</Typography>;
          return <Typography variant="body2" color="text.secondary">—</Typography>;
        },
      },
      { id: "bl", header: "B/L", cell: ({ row }: any) => <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>{row.original.place?.bl ?? "—"}</Typography> },
      { id: "customer", header: "Customer", cell: ({ row }: any) => row.original.customerName || "—" },
      ...(showRecipient ? [{ id: "recipient", header: "Recipient", cell: ({ row }: any) => row.original.recipient || "—" }] : []),
      {
        id: "status",
        header: "Status",
        cell: ({ row }: any) => {
          const st: string | null = row.original.status;
          if (!st) return <Typography variant="body2" color="text.secondary">—</Typography>;
          const final = st === "Final" || st === "Confirmed";
          return <Chip size="small" variant="outlined" color={final ? "success" : st === "Draft" ? "warning" : "default"} label={st === "Confirmed" ? "Final" : st} />;
        },
      },
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
    [showRecipient],
  );

  const counts = hub.data?.categoryCounts ?? {};
  const filtered = !!(q || category || Object.entries(filters).some(([k, v]) => (k === "createdOn" ? (v as DateRange)?.startDate || (v as DateRange)?.endDate : v)));
  const m = menu?.row;
  const pick = (fn: (r: HubRow) => void) => () => {
    const r = menu?.row;
    setMenu(null);
    if (r) fn(r);
  };

  const tabs = (
    <Tabs
      value={category}
      onChange={(_, v) => {
        setCategory(v);
        setFilters((f) => ({ ...f, docType: "" }));
        setPage(1);
      }}
      variant="scrollable"
      allowScrollButtonsMobile
      sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}
      data-tour="hub-tabs"
    >
      {visibleTabs(counts, hub.data?.allCount ?? 0, category).map((t) => (
        <Tab key={t.code || "all"} value={t.code} label={`${t.label}${hub.data ? ` (${t.count})` : ""}`} />
      ))}
    </Tabs>
  );

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }}>
      <PageTable
        tableName="Documents"
        subTitle="Every document across all orders"
        actionButtons={[
          <Button key="upload" variant="contained" startIcon={<UploadFileIcon />} onClick={() => setUploadOpen(true)}>
            Upload document
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
            {tabs}
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
