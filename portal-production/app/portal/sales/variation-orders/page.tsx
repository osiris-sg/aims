"use client";

// Sales → Variation Order (guru 2026-09-29): every VO across projects in one
// list. VOs have no generic document template — a row opens its project with
// the VO sheet dialog (?vo=), which edits drafts and prints the firm's VO
// Excel layout. Tier-scoped server-side like the rest of the ID data.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Typography } from "@mui/material";
import moment from "moment";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import StatusChip from "@/components/StatusChip";
import { useIdQuoteApi } from "../quotations/id/_lib/api";
import { money } from "../quotations/id/_lib/math";

export default function VariationOrdersPage() {
  const router = useRouter();
  const api = useIdQuoteApi();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .request<{ docs: any[] }>(`/id-projects/vos`)
      .then((r) => setRows(r?.docs || []))
      .catch((e: any) => toast.error(e.message || "Failed to load variation orders"))
      .finally(() => setLoading(false));
  }, [api]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((v) => [v.name, v.projectName, v.contractNo, v.designer].some((x) => String(x || "").toLowerCase().includes(q)));
  }, [rows, search]);

  const columns = useMemo(
    () => [
      { id: "vo", header: "VO", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.original.name || "VO"}</Typography> },
      { id: "contract", header: "Contract", cell: ({ row }: any) => <Typography variant="body2">{row.original.contractNo || "—"}</Typography> },
      { id: "project", header: "Project", cell: ({ row }: any) => <Typography variant="body2">{row.original.projectName || "—"}</Typography> },
      { id: "designer", header: "Designer", cell: ({ row }: any) => <Typography variant="body2">{row.original.designer || "—"}</Typography> },
      { id: "adds", header: "Additions", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>S$ {money(row.original.additions)}</Typography> },
      { id: "rems", header: "Removals", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>(S$ {money(row.original.removals)})</Typography> },
      { id: "net", header: "Net (S$)", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right", fontWeight: 700 }}>{money(row.original.net)}</Typography> },
      { id: "status", header: "Status", cell: ({ row }: any) => <StatusChip status={row.original.status} /> },
      { id: "created", header: "Created", cell: ({ row }: any) => <Typography variant="body2">{moment(row.original.createdAt).format("DD MMM YYYY")}</Typography> },
    ],
    [],
  );

  return (
    <MainCard>
      <PageTable
        onRowClick={(v: any) => router.push(`/portal/sales/variation-orders/${v.id}`)}
        tableName="Variation Orders"
        subTitle="Changes after signing — a confirmed VO adds its net amount to the project's contract sum. New VOs are raised from the project page."
        columns={columns as any}
        data={filtered.slice((page - 1) * limit, page * limit)}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={{}}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={(v: string) => { setSearch(v); setPage(1); }}
        setFilters={() => {}}
        pageCount={Math.max(1, Math.ceil(filtered.length / limit))}
        totalDocs={filtered.length}
      />
    </MainCard>
  );
}
