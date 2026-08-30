"use client";

// Projects list for interior-design orgs: what the owners track per job —
// client + site, designer, stage, contract sum, collected/outstanding, margin.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { toast } from "react-toastify";
import { STAGE_LABEL, fmtDate, money, pct, useIdProjectApi } from "./api";

const STAGE_COLOR: Record<string, "default" | "primary" | "info" | "warning" | "success"> = {
  signed: "primary",
  design: "info",
  works: "warning",
  carpentry: "warning",
  handover: "info",
  completed: "success",
};

export default function IdProjectList() {
  const router = useRouter();
  const api = useIdProjectApi();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({ stage: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.list({ page, limit, search, stage: filters.stage || undefined });
      setRows(r.docs || []);
      setTotal(r.total || 0);
    } catch (e: any) {
      toast.error(e.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [api, page, limit, search, filters]);
  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(
    () => [
      {
        id: "project",
        header: "Project",
        cell: ({ row }: any) => (
          <Box sx={{ minWidth: 220 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {row.original.clientName || row.original.name}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>
              {row.original.address || "—"}
            </Typography>
          </Box>
        ),
      },
      { id: "contractNo", header: "Contract", cell: ({ row }: any) => <Typography variant="body2">{row.original.contractNo || "—"}</Typography> },
      { id: "designer", header: "Designer", cell: ({ row }: any) => <Typography variant="body2">{row.original.designer || "—"}</Typography> },
      {
        id: "stage",
        header: "Stage",
        cell: ({ row }: any) => {
          const s = row.original.stage;
          return s ? <Chip size="small" variant="outlined" color={STAGE_COLOR[s] || "default"} label={STAGE_LABEL[s] || s} /> : <Typography variant="caption" sx={{ color: "text.disabled" }}>—</Typography>;
        },
      },
      { id: "contract", header: "Contract (S$)", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{money(row.original.contractTotal)}</Typography> },
      { id: "collected", header: "Collected", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right", color: "success.main" }}>{money(row.original.collected)}</Typography> },
      { id: "outstanding", header: "Outstanding", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right", color: row.original.outstanding > 0 ? "warning.main" : "text.secondary" }}>{money(row.original.outstanding)}</Typography> },
      {
        id: "margin",
        header: "Margin",
        cell: ({ row }: any) => {
          const m = row.original.marginPct;
          if (m == null) return <Typography variant="caption" sx={{ color: "text.disabled" }}>—</Typography>;
          return <Chip size="small" variant="outlined" color={m < 15 ? "warning" : "success"} label={pct(m)} />;
        },
      },
      {
        id: "next",
        header: "Next payment",
        cell: ({ row }: any) => (
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.original.nextMilestoneLabel || "—"}
          </Typography>
        ),
      },
      { id: "started", header: "Started", cell: ({ row }: any) => <Typography variant="body2">{fmtDate(row.original.startDate || row.original.createdAt)}</Typography> },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => (
          <Stack direction="row" justifyContent="flex-end">
            <Tooltip title="Open project">
              <IconButton size="small" onClick={() => router.push(`/portal/projects/${row.original.id}`)} sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    [router],
  );

  const filterConfig: FilterField[] = useMemo(
    () => [{ type: "select", key: "stage", label: "Stage", options: [{ value: "", label: "All" }, ...Object.entries(STAGE_LABEL).map(([value, label]) => ({ value, label }))] }],
    [],
  );

  return (
    <MainCard>
      <PageTable
        tableName="Projects"
        subTitle="Every signed quotation becomes a project — costing, payments and profit live here"
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
      />
    </MainCard>
  );
}
