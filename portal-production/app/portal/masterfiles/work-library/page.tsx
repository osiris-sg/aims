"use client";

// Master Files → Work Library (orgs on the ID quotation editor). The trade
// sections (A Hacking … J Miscellaneous) and the templatised quotation lines
// that the editor's ⌘K palette offers. Standard PageTable page.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { useIdQuoteApi } from "@/app/portal/sales/quotations/id/_lib/api";
import type { WorkItem, WorkSection } from "@/app/portal/sales/quotations/id/_lib/types";
import { UOM_OPTIONS } from "@/app/portal/sales/quotations/id/_lib/defaults";
import { money } from "@/app/portal/sales/quotations/id/_lib/math";

type Form = {
  code: string;
  name: string;
  workSectionId: string;
  descriptionTemplate: string;
  includes: string; // one per line
  uom: string;
  unitPrice: string;
  unitCost: string;
  pricingMode: string;
  accountCode: string;
};
const blank: Form = { code: "", name: "", workSectionId: "", descriptionTemplate: "", includes: "", uom: "nos", unitPrice: "", unitCost: "", pricingMode: "priced", accountCode: "" };

export default function WorkLibraryPage() {
  const api = useIdQuoteApi();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [sections, setSections] = useState<WorkSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<WorkItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sectionDialog, setSectionDialog] = useState(false);
  const [sectionForm, setSectionForm] = useState<{ id?: string; letter: string; title: string; defaultNotes: string }>({ letter: "", title: "", defaultNotes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, s] = await Promise.all([api.request<WorkItem[]>("/revenue-items?workOnly=true"), api.request<WorkSection[]>("/revenue-items/sections")]);
      setItems(i);
      setSections(s);
    } catch (e: any) {
      toast.error(e.message || "Failed to load work library");
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items
      .filter((w) => !filters.section || w.workSectionId === filters.section)
      .filter((w) => !term || `${w.code || ""} ${w.name} ${w.descriptionTemplate || ""}`.toLowerCase().includes(term));
  }, [items, search, filters]);
  const paged = useMemo(() => filtered.slice((page - 1) * limit, page * limit), [filtered, page, limit]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...blank, workSectionId: sections[0]?.id || "", accountCode: items[0]?.accountCode || "SS001" });
    setDialog(true);
  };
  const openEdit = (w: WorkItem) => {
    setEditing(w);
    setForm({
      code: w.code || "",
      name: w.name,
      workSectionId: w.workSectionId || "",
      descriptionTemplate: w.descriptionTemplate || "",
      includes: (w.includes || []).map((i) => i.text).join("\n"),
      uom: w.uom || "nos",
      unitPrice: w.unitPrice == null ? "" : String(w.unitPrice),
      unitCost: w.unitCost == null ? "" : String(w.unitCost),
      pricingMode: (w.pricingMode as string) || "priced",
      accountCode: w.accountCode,
    });
    setDialog(true);
  };
  const submit = async () => {
    if (!form.name.trim() || !form.workSectionId || !form.accountCode) {
      toast.error("Name, section and revenue account are required");
      return;
    }
    setSaving(true);
    const body = {
      code: form.code.trim() || undefined,
      name: form.name.trim(),
      type: "SERVICE",
      workSectionId: form.workSectionId,
      descriptionTemplate: form.descriptionTemplate.trim() || form.name.trim(),
      includes: form.includes.split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ text })),
      uom: form.uom || "nos",
      unitPrice: form.unitPrice === "" ? null : Number(form.unitPrice),
      unitCost: form.unitCost === "" ? null : Number(form.unitCost),
      pricingMode: form.pricingMode,
      accountCode: form.accountCode,
    };
    try {
      if (editing) await api.request(`/revenue-items/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api.request(`/revenue-items`, { method: "POST", body: JSON.stringify(body) });
      toast.success(editing ? "Work item updated" : "Work item added");
      setDialog(false);
      load();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.request(`/revenue-items/${toDelete.id}`, { method: "DELETE" });
      setToDelete(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  };
  const submitSection = async () => {
    if (!sectionForm.title.trim()) return;
    const body = { letter: sectionForm.letter.trim() || undefined, title: sectionForm.title.trim(), defaultNotes: sectionForm.defaultNotes.split("\n").map((t) => t.trim()).filter(Boolean) };
    try {
      if (sectionForm.id) await api.request(`/revenue-items/sections/${sectionForm.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api.request(`/revenue-items/sections`, { method: "POST", body: JSON.stringify(body) });
      setSectionDialog(false);
      load();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    }
  };

  const columns = useMemo(
    () => [
      { accessorKey: "code", header: "Code", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.original.code}</Typography> },
      {
        id: "section",
        header: "Section",
        cell: ({ row }: any) => <Chip size="small" variant="outlined" label={`${row.original.workSection?.letter || ""} ${row.original.workSection?.title || "—"}`.trim()} />,
      },
      {
        accessorKey: "descriptionTemplate",
        header: "Quotation line",
        cell: ({ row }: any) => (
          <Box>
            <Typography variant="body2" sx={{ maxWidth: 520 }}>
              {row.original.descriptionTemplate || row.original.name}
            </Typography>
            {row.original.includes?.length ? (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {row.original.includes.length} include{row.original.includes.length === 1 ? "" : "s"}
              </Typography>
            ) : null}
          </Box>
        ),
      },
      { accessorKey: "uom", header: "UOM", cell: ({ row }: any) => <Typography variant="body2">{row.original.uom || "nos"}</Typography> },
      {
        accessorKey: "unitPrice",
        header: "Unit price",
        cell: ({ row }: any) =>
          row.original.pricingMode && row.original.pricingMode !== "priced" ? (
            <Chip size="small" label={row.original.pricingMode === "inclusive" ? "Inclusive" : "Complimentary"} />
          ) : (
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{row.original.unitPrice == null ? "—" : `$${money(row.original.unitPrice)}`}</Typography>
          ),
      },
      { accessorKey: "unitCost", header: "Unit cost", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", color: "text.secondary" }}>{row.original.unitCost == null ? "—" : `$${money(row.original.unitCost)}`}</Typography> },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => (
          <Stack direction="row" justifyContent="flex-end">
            <IconButton size="small" onClick={() => openEdit(row.original)}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setToDelete(row.original)} sx={{ "&:hover": { color: "error.main" } }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ),
      },
    ],
    [],
  );

  return (
    <MainCard>
      <PageTable
        tableName="Work Library"
        subTitle="Trade sections and templatised quotation lines used by the quotation editor"
        columns={columns as any}
        data={paged}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={[{ type: "select", key: "section", label: "Section", options: [{ value: "", label: "All" }, ...sections.map((s) => ({ value: s.id, label: `${s.letter || ""} ${s.title}`.trim() }))] }]}
        pageCount={Math.max(1, Math.ceil(filtered.length / limit))}
        totalDocs={filtered.length}
        buttonName="New work item"
        onAddClick={openCreate}
        actionButtons={[
          <Button key="sections" variant="outlined" onClick={() => { setSectionForm({ letter: "", title: "", defaultNotes: "" }); setSectionDialog(true); }}>
            New section
          </Button>,
        ]}
        headerContent={
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75, mb: 1 }}>
            {sections.map((s) => (
              <Tooltip key={s.id} title={s.defaultNotes?.length ? `Notes: ${s.defaultNotes.join(" · ")}` : "Click to edit"}>
                <Chip
                  size="small"
                  label={`${s.letter || ""} · ${s.title} (${items.filter((w) => w.workSectionId === s.id).length})`}
                  onClick={() => {
                    setSectionForm({ id: s.id, letter: s.letter || "", title: s.title, defaultNotes: (s.defaultNotes || []).join("\n") });
                    setSectionDialog(true);
                  }}
                />
              </Tooltip>
            ))}
          </Stack>
        }
      />

      <Dialog open={dialog} onClose={() => setDialog(false)} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>{editing ? "Edit work item" : "New work item"}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={1.5}>
            <Grid item xs={12} md={3}>
              <TextField label="Code" size="small" fullWidth value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} helperText="blank = next in section" />
            </Grid>
            <Grid item xs={12} md={5}>
              <TextField select label="Section" size="small" fullWidth value={form.workSectionId} onChange={(e) => setForm({ ...form, workSectionId: e.target.value })}>
                {sections.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.letter} · {s.title}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField select label="Pricing" size="small" fullWidth value={form.pricingMode} onChange={(e) => setForm({ ...form, pricingMode: e.target.value })}>
                <MenuItem value="priced">Priced</MenuItem>
                <MenuItem value="inclusive">Inclusive</MenuItem>
                <MenuItem value="complimentary">Complimentary</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField label="Short name" size="small" fullWidth value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Quotation line (use {dims} for measurements)" size="small" fullWidth multiline minRows={2} value={form.descriptionTemplate} onChange={(e) => setForm({ ...form, descriptionTemplate: e.target.value })} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Default includes (one per line)" size="small" fullWidth multiline minRows={2} value={form.includes} onChange={(e) => setForm({ ...form, includes: e.target.value })} />
            </Grid>
            <Grid item xs={6} md={3}>
              <Autocomplete freeSolo size="small" options={UOM_OPTIONS} value={form.uom} onInputChange={(_, v) => setForm({ ...form, uom: v })} renderInput={(p) => <TextField {...p} label="UOM" />} />
            </Grid>
            <Grid item xs={6} md={3}>
              <TextField label="Unit price" size="small" fullWidth value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} inputProps={{ inputMode: "decimal" }} />
            </Grid>
            <Grid item xs={6} md={3}>
              <TextField label="Unit cost" size="small" fullWidth value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} inputProps={{ inputMode: "decimal" }} />
            </Grid>
            <Grid item xs={6} md={3}>
              <TextField label="Revenue account" size="small" fullWidth value={form.accountCode} onChange={(e) => setForm({ ...form, accountCode: e.target.value })} helperText="GL code, e.g. SS001" />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={saving} onClick={submit}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={sectionDialog} onClose={() => setSectionDialog(false)} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>{sectionForm.id ? "Edit section" : "New section"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5}>
              <TextField label="Letter" size="small" value={sectionForm.letter} onChange={(e) => setSectionForm({ ...sectionForm, letter: e.target.value.toUpperCase().slice(0, 2) })} sx={{ width: 90 }} />
              <TextField label="Title" size="small" fullWidth value={sectionForm.title} onChange={(e) => setSectionForm({ ...sectionForm, title: e.target.value })} />
            </Stack>
            <TextField label="Default notes (one per line, printed under the section header)" size="small" fullWidth multiline minRows={2} value={sectionForm.defaultNotes} onChange={(e) => setSectionForm({ ...sectionForm, defaultNotes: e.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          {sectionForm.id && (
            <Button
              color="error"
              sx={{ mr: "auto" }}
              onClick={async () => {
                try {
                  await api.request(`/revenue-items/sections/${sectionForm.id}`, { method: "DELETE" });
                  setSectionDialog(false);
                  load();
                } catch (e: any) {
                  toast.error(e.message || "Delete failed");
                }
              }}
            >
              Delete section
            </Button>
          )}
          <Button onClick={() => setSectionDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={submitSection}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <DeleteItemDialogNoConfirm open={!!toDelete} onCancel={() => setToDelete(null)} onConfirm={remove} loading={deleting} />
    </MainCard>
  );
}
