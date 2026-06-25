"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import RecurringTemplateDialog from "./_components/RecurringTemplateDialog";
import PageTable from "@/components/PageTable";

type Template = {
  id: string;
  name: string;
  description?: string | null;
  reference?: string | null;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  nextRunDate: string;
  lastRunAt?: string | null;
  isActive: boolean;
  endDate?: string | null;
  lines: any[];
};

export default function RecurringPage() {
  const { request } = useAccountingApi();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  // PageTable-driven state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<Template[]>("/recurring-journals");
      setItems(res || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load recurring journals");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (t: Template) => {
    try {
      await request(`/recurring-journals/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      load();
    } catch (e: any) {
      toast.error(e?.message || "Toggle failed");
    }
  };

  const remove = async (t: Template) => {
    if (!confirm(`Delete template "${t.name}"? Past entries it created remain.`)) return;
    try {
      await request(`/recurring-journals/${t.id}`, { method: "DELETE" });
      toast.success("Deleted");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  };

  const runNow = async (t: Template) => {
    setRunningId(t.id);
    try {
      const res = await request<{ journalNumber: string }>(`/recurring-journals/${t.id}/run`, { method: "POST" });
      toast.success(`Posted draft ${res.journalNumber} — review in Audit Trail`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Run failed");
    } finally {
      setRunningId(null);
    }
  };

  const visible = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.reference || "").toLowerCase().includes(q),
    );
  }, [items, search]);

  useEffect(() => { setPage(1); }, [search]);

  const pageCount = Math.max(1, Math.ceil(visible.length / limit));
  const paged = useMemo(
    () => visible.slice((page - 1) * limit, page * limit),
    [visible, page, limit],
  );

  const columns = useMemo(() => [
    {
      accessorKey: "isActive",
      header: "Active",
      cell: ({ row }: any) => {
        const t: Template = row.original;
        return <Switch size="small" checked={t.isActive} onChange={() => toggleActive(t)} />;
      },
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }: any) => {
        const t: Template = row.original;
        const isDue = new Date(t.nextRunDate) <= new Date() && t.isActive;
        return (
          <Stack direction="row" gap={1} alignItems="center">
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{t.name}</Typography>
              {t.description && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>{t.description}</Typography>
              )}
            </Box>
            {isDue && <Chip size="small" label="Due" color="warning" variant="outlined" sx={{ fontSize: "0.65rem", height: 18 }} />}
          </Stack>
        );
      },
    },
    {
      accessorKey: "frequency",
      header: "Frequency",
      cell: ({ row }: any) => (
        <Chip size="small" variant="outlined" label={row.original.frequency} sx={{ fontSize: "0.7rem" }} />
      ),
    },
    {
      accessorKey: "nextRunDate",
      header: "Next run",
      cell: ({ row }: any) => (
        <Box sx={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
          {new Date(row.original.nextRunDate).toLocaleDateString()}
        </Box>
      ),
    },
    {
      accessorKey: "lastRunAt",
      header: "Last run",
      cell: ({ row }: any) => (
        <Box sx={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "text.secondary" }}>
          {row.original.lastRunAt ? new Date(row.original.lastRunAt).toLocaleDateString() : "—"}
        </Box>
      ),
    },
    {
      accessorKey: "lines",
      header: "Lines",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right" }}>
          {Array.isArray(row.original.lines) ? row.original.lines.length : 0}
        </Box>
      ),
    },
    {
      accessorKey: "actions",
      header: "Actions",
      cell: ({ row }: any) => {
        const t: Template = row.original;
        return (
          <Stack direction="row" gap={0.25} justifyContent="flex-end">
            <Tooltip title="Run now">
              <span>
                <IconButton
                  size="small"
                  onClick={() => runNow(t)}
                  disabled={runningId === t.id}
                >
                  {runningId === t.id ? (
                    <CircularProgress size={14} />
                  ) : (
                    <PlayArrowIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => { setEditing(t); setEditorOpen(true); }}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" onClick={() => remove(t)}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        );
      },
    },
  ], [runningId]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <PageTable
        columns={columns}
        data={paged}
        tableName="Recurring Journals"
        subTitle="Templates that auto-create DRAFT journal entries on a schedule. Drafts always need review before posting."
        buttonName="New Template"
        onAddClick={() => { setEditing(null); setEditorOpen(true); }}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        pageCount={pageCount}
        totalDocs={visible.length}
      />

      <RecurringTemplateDialog
        open={editorOpen}
        editing={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          load();
        }}
      />
    </Box>
  );
}
