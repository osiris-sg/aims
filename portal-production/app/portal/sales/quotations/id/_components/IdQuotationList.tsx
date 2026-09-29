"use client";

// Sales → Quotation list for orgs on the interior-design quotation editor.
// Server-paginated PageTable over QUOTATION documents; each row shows what an
// ID firm cares about (client, site, designer, grand total, margin) and opens
// the ID editor at /portal/sales/quotations/id/[id].

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Chip, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import moment from "moment";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { kebabColumn } from "@/components/RowKebab";
import StatusChip from "@/components/StatusChip";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import type { FilterField } from "@/components/FilterDrawer";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { useIdQuoteApi } from "../_lib/api";
import { defaultQuote, normalizeQuote } from "../_lib/defaults";
import { money, pct, quoteTotals } from "../_lib/math";

const QUOTATION_TYPES = ["QUOTATION", "QO", "QO1", "QO2", "QT"];
const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "confirmed", label: "Confirmed" },
];

export default function IdQuotationList() {
  const router = useRouter();
  const api = useIdQuoteApi();
  const { organization } = useOrganization();
  const { userId } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({ status: "", createdOn: { startDate: null, endDate: null } });
  const [creating, setCreating] = useState(false);
  // Quotations | Variation orders switch (guru 2026-09-29): VOs get their own
  // Sales listing; a row opens the project's VO sheet dialog via ?vo=.
  const [view, setView] = useState<"quotes" | "vos">("quotes");
  const [voRows, setVoRows] = useState<any[]>([]);
  const [voLoading, setVoLoading] = useState(false);
  const [voPage, setVoPage] = useState(1);
  const [voLimit, setVoLimit] = useState(10);
  const [voSearch, setVoSearch] = useState("");
  const [toDelete, setToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listQuotations({
        page,
        limit,
        search,
        documentTypes: QUOTATION_TYPES,
        status: filters.status || undefined,
        createdOn: filters.createdOn,
        sortBy: "createdAt",
        sortDir: "desc",
      });
      const docs: any[] = res?.docs || res?.documents || res?.data || (Array.isArray(res) ? res : []);
      setRows(docs);
      setTotal(res?.total ?? res?.totalDocs ?? docs.length);
    } catch (e: any) {
      toast.error(e.message || "Failed to load quotations");
    } finally {
      setLoading(false);
    }
  }, [api, page, limit, search, filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (view !== "vos") return;
    setVoLoading(true);
    api
      .request<{ docs: any[] }>(`/id-projects/vos`)
      .then((r) => setVoRows(r?.docs || []))
      .catch((e: any) => toast.error(e.message || "Failed to load variation orders"))
      .finally(() => setVoLoading(false));
  }, [view, api]);

  const voFiltered = useMemo(() => {
    const q = voSearch.trim().toLowerCase();
    if (!q) return voRows;
    return voRows.filter((v) => [v.name, v.projectName, v.contractNo, v.designer].some((x) => String(x || "").toLowerCase().includes(q)));
  }, [voRows, voSearch]);

  const voColumns = useMemo(
    () => [
      { id: "vo", header: "VO", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.original.name || "VO"}</Typography> },
      { id: "contract", header: "Contract", cell: ({ row }: any) => <Typography variant="body2">{row.original.contractNo || "—"}</Typography> },
      {
        id: "project",
        header: "Project",
        cell: ({ row }: any) => <Typography variant="body2">{row.original.projectName || "—"}</Typography>,
      },
      { id: "designer", header: "Designer", cell: ({ row }: any) => <Typography variant="body2">{row.original.designer || "—"}</Typography> },
      { id: "adds", header: "Additions", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>S$ {money(row.original.additions)}</Typography> },
      { id: "rems", header: "Removals", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>(S$ {money(row.original.removals)})</Typography> },
      { id: "net", header: "Net (S$)", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right", fontWeight: 700 }}>{money(row.original.net)}</Typography> },
      { id: "status", header: "Status", cell: ({ row }: any) => <StatusChip status={row.original.status} /> },
      { id: "created", header: "Created", cell: ({ row }: any) => <Typography variant="body2">{moment(row.original.createdAt).format("DD MMM YYYY")}</Typography> },
    ],
    [],
  );

  const handleCreate = async () => {
    if (!organization?.id) return;
    setCreating(true);
    try {
      const q = defaultQuote();
      // The creator starts as the designer-of-record so designer-scoped users
      // can see their own drafts; the Designer picker can reassign it.
      q.header.designerUserId = userId || null;
      const doc = await api.createQuotation(organization.id, q);
      router.push(`/portal/sales/quotations/id/${doc.id}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to create quotation");
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteDocument(toDelete.id);
      toast.success("Quotation deleted");
      setToDelete(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Contract No.",
        cell: ({ row }: any) => (
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {row.original.name || "Draft"}
          </Typography>
        ),
      },
      {
        id: "client",
        header: "Client",
        cell: ({ row }: any) => {
          const q = row.original.config?.quote;
          const name = q?.header?.clientName || row.original.config?.customer?.name || row.original.config?.customerName || "—";
          const addr = q?.header?.address || "";
          return (
            <Box>
              <Typography variant="body2">{name}</Typography>
              {addr && (
                <Typography variant="caption" sx={{ color: "text.secondary", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 280 }}>
                  {addr}
                </Typography>
              )}
            </Box>
          );
        },
      },
      {
        id: "designer",
        header: "Designer",
        cell: ({ row }: any) => <Typography variant="body2">{row.original.config?.quote?.header?.designer || "—"}</Typography>,
      },
      {
        id: "grand",
        header: "Grand Total",
        cell: ({ row }: any) => {
          const q = row.original.config?.quote;
          if (!q) return <Typography variant="body2">—</Typography>;
          const t = quoteTotals(normalizeQuote(q));
          return (
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
              S$ {money(t.grand)}
            </Typography>
          );
        },
      },
      {
        id: "margin",
        header: "Margin",
        cell: ({ row }: any) => {
          const q = row.original.config?.quote;
          if (!q) return null;
          const nq = normalizeQuote(q);
          const t = quoteTotals(nq);
          if (t.marginPct == null) return <Typography variant="caption" sx={{ color: "text.disabled" }}>no cost</Typography>;
          const low = t.breach;
          return <Chip size="small" label={pct(t.marginPct)} color={low ? "warning" : "success"} variant="outlined" />;
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }: any) => <StatusChip status={row.original.status} />,
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }: any) => <Typography variant="body2">{moment(row.original.createdAt).format("DD MMM YYYY")}</Typography>,
      },
      kebabColumn((d: any) => [
        { label: "Open", onClick: () => router.push(`/portal/sales/quotations/id/${d.id}`) },
        ...(["draft", "unconfirmed"].includes(d.status)
          ? [{ label: "Delete", destructive: true, onClick: () => setToDelete(d) }]
          : []),
      ]),
    ],
    [router],
  );

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "dateRange", key: "createdOn", label: "Created On" },
      { type: "select", key: "status", label: "Status", options: STATUS_OPTIONS },
    ],
    [],
  );

  return (
    <MainCard>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1.5 }}>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} data-tour="sales-vo-toggle">
          <ToggleButton value="quotes" sx={{ px: 1.5, textTransform: "none" }}>Quotations</ToggleButton>
          <ToggleButton value="vos" sx={{ px: 1.5, textTransform: "none" }}>Variation orders</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {view === "vos" ? (
        <PageTable
          onRowClick={(v: any) => v.projectId && router.push(`/portal/projects/${v.projectId}?vo=${v.id}`)}
          tableName="Variation orders"
          subTitle="Confirmed VOs add their net amount to the project's contract sum"
          columns={voColumns as any}
          data={voFiltered.slice((voPage - 1) * voLimit, voPage * voLimit)}
          loading={voLoading}
          page={voPage}
          limit={voLimit}
          search={voSearch}
          filters={{}}
          setPage={setVoPage}
          setLimit={setVoLimit}
          setSearch={(v: string) => { setVoSearch(v); setVoPage(1); }}
          setFilters={() => {}}
          pageCount={Math.max(1, Math.ceil(voFiltered.length / voLimit))}
          totalDocs={voFiltered.length}
        />
      ) : (
      <PageTable
        onRowClick={(d: any) => router.push(`/portal/sales/quotations/id/${d.id}`)}
        tableName="Quotations"
        subTitle="Letter of Intent & Appointment for Renovation Works"
        columns={columns as any}
        data={rows}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={filterConfig}
        pageCount={Math.max(1, Math.ceil(total / limit))}
        totalDocs={total}
        buttonName={creating ? "Creating…" : "New Quotation"}
        buttonDisabled={creating}
        onAddClick={handleCreate}
      />
      )}
      <DeleteItemDialogNoConfirm open={!!toDelete} onCancel={() => setToDelete(null)} onConfirm={handleDelete} loading={deleting} />
    </MainCard>
  );
}
