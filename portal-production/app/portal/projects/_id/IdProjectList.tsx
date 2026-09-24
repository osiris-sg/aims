"use client";

// Projects list for interior-design orgs: what the owners track per job —
// client + site, designer, stage, contract sum, collected/outstanding, margin.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { kebabColumn } from "@/components/RowKebab";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
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
  // Management ("Director") only — designers can't delete projects; the
  // backend enforces the same (designer-only callers 404).
  const { userRoles } = useUserPermissions();
  const canDelete = !(userRoles.length > 0 && userRoles.every((r: any) => r?.name === "Designer"));
  const [toDelete, setToDelete] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({ stage: "", designerUserId: "" });
  // Funnel counts for the quick-filter buttons (server-computed, scope-aware).
  const [stageCounts, setStageCounts] = useState<{ none: number; signed: number; ongoing: number; completed: number } | null>(null);
  // New project (CIEL 09-01): projects start BEFORE the quotation — from an
  // assigned lead, a referral, or the designer's own client.
  const [createOpen, setCreateOpen] = useState(false);
  // Dashboard's "Create project" deep-links here with ?new=1 → open the dialog.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams?.get("new") === "1") setCreateOpen(true);
  }, [searchParams]);
  const [creating, setCreating] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [designers, setDesigners] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({ source: "lead", leadId: "", clientName: "", address: "", designerUserId: "" });
  useEffect(() => {
    if (!createOpen) return;
    api.listLeads().then(setLeads).catch(() => setLeads([]));
  }, [createOpen, api]);
  // Designer list loads up-front: it feeds both the Filter drawer's Designer
  // select and the create dialog.
  useEffect(() => {
    api.listOrgUsers().then(setDesigners).catch(() => {});
  }, [api]);
  const createProject = async () => {
    setCreating(true);
    try {
      const designer = designers.find((d) => d.id === form.designerUserId);
      const r = await api.createProject({
        source: form.source,
        leadId: form.source === "lead" ? form.leadId || null : null,
        clientName: form.clientName || undefined,
        address: form.address || null,
        designerUserId: form.designerUserId || null,
        designer: designer?.name || null,
      });
      toast.success(`Project "${r.name}" created`);
      router.push(`/portal/projects/${r.projectId}`);
    } catch (e: any) {
      toast.error(e.message || "Could not create the project");
      setCreating(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.list({ page, limit, search, stage: filters.stage || undefined, designerUserId: filters.designerUserId || undefined });
      setRows(r.docs || []);
      setTotal(r.total || 0);
      if (r.stageCounts) setStageCounts(r.stageCounts);
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
          // No hard minWidth: the shared Table renders wrap-cells with
          // overflow visible, so a fixed 220px box SPILLED under the next
          // column when the column came out narrower (guru 2026-09-13).
          // Long names wrap inside the cell instead.
          <Box sx={{ maxWidth: 320 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: "normal", wordBreak: "break-word" }}>
              {row.original.clientName || row.original.name}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", whiteSpace: "normal", wordBreak: "break-word" }}>
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
          return s ? <Chip size="small" variant="outlined" color={STAGE_COLOR[s] || "default"} label={STAGE_LABEL[s] || s} /> : <Chip size="small" variant="outlined" label="Not signed" sx={{ color: "text.secondary" }} />;
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
      ...(canDelete
        ? [
            kebabColumn((r: any) => [
              { label: "Open", onClick: () => router.push(`/portal/projects/${r.id}`) },
              { label: "Delete project", destructive: true, onClick: () => setToDelete(r) },
            ]),
          ]
        : []),
    ],
    [canDelete, router],
  );

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "stage", label: "Stage", options: [{ value: "", label: "All" }, { value: "none", label: "Not signed" }, ...Object.entries(STAGE_LABEL).map(([value, label]) => ({ value, label }))] },
      { type: "select", key: "designerUserId", label: "Designer", options: [{ value: "", label: "All designers" }, ...designers.map((d) => ({ value: d.id, label: d.name }))] },
    ],
    [designers],
  );

  // Funnel quick-filters (guru 2026-09-24): one tap per bucket, tap again to
  // clear. "Not signed" = converted lead, quotation still pending.
  const FUNNEL: Array<{ value: string; label: string; count: number | null }> = [
    { value: "none", label: "Not signed", count: stageCounts?.none ?? null },
    { value: "signed", label: "Signed", count: stageCounts?.signed ?? null },
    { value: "ongoing", label: "Ongoing", count: stageCounts?.ongoing ?? null },
    { value: "completed", label: "Completed", count: stageCounts?.completed ?? null },
  ];

  return (
    <MainCard>
      {/* Stage funnel — quick filters (New-project button removed 2026-09-24:
          projects are born from leads/quotations; the dialog stays for the
          Dashboard's Create-project deep link ?new=1). */}
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1.5 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filters.stage || null}
          onChange={(_, v) => {
            setPage(1);
            setFilters({ ...filters, stage: v || "" });
          }}
          data-tour="projects-funnel"
        >
          {FUNNEL.map((f) => (
            <ToggleButton key={f.value} value={f.value} sx={{ px: 1.5, textTransform: "none" }}>
              {f.label}
              {f.count != null && (
                <Chip size="small" label={f.count} sx={{ ml: 0.75, height: 18, fontSize: 11, pointerEvents: "none" }} />
              )}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      <PageTable
        onRowClick={(r: any) => router.push(`/portal/projects/${r.id}`)}
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
          <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField select size="small" label="Source" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} helperText="Where this client came from">
              <MenuItem value="lead">From a lead</MenuItem>
              <MenuItem value="referral">Referral</MenuItem>
              <MenuItem value="self">Own client</MenuItem>
            </TextField>
            {form.source === "lead" ? (
              <TextField select size="small" label="Lead" value={form.leadId} onChange={(e) => setForm((f) => ({ ...f, leadId: e.target.value }))} helperText={leads.length ? "Converts the lead — client and designer carry over" : "No open leads (unqualified / engaging)"}>
                {leads.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                    {l.assignedToName ? ` · ${l.assignedToName}` : ""}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <>
                <TextField size="small" label="Client name" value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
                <TextField size="small" label="Site address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} multiline minRows={2} />
              </>
            )}
            <TextField select size="small" label="Designer in charge" value={form.designerUserId} onChange={(e) => setForm((f) => ({ ...f, designerUserId: e.target.value }))}>
              <MenuItem value="">—</MenuItem>
              {designers.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={createProject} disabled={creating || (form.source === "lead" ? !form.leadId : !form.clientName.trim())} sx={{ textTransform: "none" }}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
      <DeleteItemDialogNoConfirm
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        loading={deleting}
        onConfirm={async () => {
          if (!toDelete) return;
          setDeleting(true);
          try {
            await api.request(`/id-projects/${toDelete.id}`, { method: "DELETE" });
            toast.success(`Project deleted — its quotation and lead were kept and unlinked`);
            setToDelete(null);
            load();
          } catch (e: any) {
            toast.error(e.message || "Delete failed");
          } finally {
            setDeleting(false);
          }
        }}
      />
    </MainCard>
  );
}
