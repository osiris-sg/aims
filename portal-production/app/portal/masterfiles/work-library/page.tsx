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
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useClientSort } from "@/components/clientSort";
import { kebabColumn } from "@/components/RowKebab";
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

/** Contractor price-list upload: pick the PDF/photo → AI parses it into
 *  proposed work items (unit COSTS) → review/edit/untick → add to the library. */
function ImportPricelistDialog({ open, sections, api, onClose, onDone }: { open: boolean; sections: WorkSection[]; api: ReturnType<typeof useIdQuoteApi>; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ dataUri: string; name: string } | null>(null);
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [conditions, setConditions] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<{ checked: boolean; name: string; uom: string; unitCost: string; unitPrice: string; section: string; descriptionTemplate: string | null; includes: string[]; currentCost?: number | null }>>([]);
  const [existing, setExisting] = useState<{ count: number; priceChanges: Array<{ name: string; from: number | null; to: number }>; added: number; unchanged: number; missing: string[]; missingCount: number } | null>(null);
  const [mode, setMode] = useState<"add" | "update">("add");
  const [retireMissing, setRetireMissing] = useState(false);
  const sectionTitles = useMemo(() => sections.map((s) => s.title), [sections]);

  const reset = () => { setFile(null); setSupplier(""); setRows([]); setConditions([]); setExisting(null); setMode("add"); setRetireMissing(false); };
  const pick = (f: File | null) => {
    if (!f) return;
    if (!/pdf|image\//.test(f.type)) { toast.error("Upload the price list as a PDF or a photo"); return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ dataUri: String(reader.result), name: f.name });
    reader.readAsDataURL(f);
  };

  const parse = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const r = await api.request<{ supplierName: string | null; trade: string | null; conditions: string[]; items: any[]; existing: any }>(`/revenue-items/import-pricelist`, {
        method: "POST",
        body: JSON.stringify({ file: file.dataUri, filename: file.name, supplierName: supplier.trim() || undefined }),
      });
      if (!supplier.trim() && r.supplierName) setSupplier(r.supplierName);
      setConditions(r.conditions || []);
      setExisting(r.existing || null);
      setMode(r.existing?.count ? "update" : "add");
      setRetireMissing(false);
      setRows(
        (r.items || []).map((i: any) => ({
          checked: true,
          name: i.name,
          uom: i.uom || "lot",
          unitCost: i.unitCost == null ? "" : String(i.unitCost),
          unitPrice: "",
          section: i.section || "",
          descriptionTemplate: i.descriptionTemplate || null,
          includes: i.includes || [],
          currentCost: i.currentCost ?? null,
        })),
      );
      toast.success(`${r.items.length} priced item${r.items.length === 1 ? "" : "s"} found — review and add`);
    } catch (e: any) {
      toast.error(e.message || "Could not read that price list");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    const selected = rows.filter((r) => r.checked && r.name.trim());
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      const r = await api.request<{ created: number; updated: number; retired: number; newSections: string[] }>(`/revenue-items/import-pricelist/apply`, {
        method: "POST",
        body: JSON.stringify({
          supplierName: supplier.trim() || null,
          mode,
          retireMissing: mode === "update" && retireMissing,
          items: selected.map((x) => ({
            name: x.name.trim(),
            uom: x.uom || "lot",
            unitCost: x.unitCost === "" ? null : Number(x.unitCost),
            unitPrice: x.unitPrice === "" ? null : Number(x.unitPrice),
            section: x.section || "Miscellaneous",
            descriptionTemplate: x.descriptionTemplate,
            includes: x.includes,
          })),
        }),
      });
      toast.success(
        [r.updated ? `${r.updated} updated` : null, r.created ? `${r.created} added` : null, r.retired ? `${r.retired} retired` : null].filter(Boolean).join(" · ") +
          (r.newSections.length ? ` · new section${r.newSections.length === 1 ? "" : "s"}: ${r.newSections.join(", ")}` : ""),
      );
      reset();
      onClose();
      onDone();
    } catch (e: any) {
      toast.error(e.message || "Failed to add items");
    } finally {
      setBusy(false);
    }
  };

  const setRow = (idx: number, patch: any) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const allChecked = rows.length > 0 && rows.every((r) => r.checked);

  return (
    <Dialog open={open} onClose={() => { if (!busy) { reset(); onClose(); } }} maxWidth="lg" fullWidth>
      <DialogTitle>Upload contractor price list</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, mt: 0.5, flexWrap: "wrap", rowGap: 1 }}>
          <Button variant="outlined" component="label" disabled={busy} sx={{ textTransform: "none", flexShrink: 0 }}>
            {file ? file.name : "Choose PDF / photo"}
            <input hidden type="file" accept="application/pdf,image/*" onChange={(e) => pick(e.target.files?.[0] || null)} />
          </Button>
          <TextField size="small" label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Auto-detected from the list" sx={{ minWidth: 220 }} />
          <Button variant="contained" onClick={parse} disabled={!file || busy} sx={{ textTransform: "none" }}>
            {busy && !rows.length ? "Reading…" : "Read price list"}
          </Button>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Prices land as unit COSTS — set selling prices later, or per quotation.
          </Typography>
        </Stack>
        {conditions.length > 0 && (
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
            Conditions on the list: {conditions.join(" · ")}
          </Typography>
        )}
        {existing && (
          <Box sx={{ border: 1, borderColor: "warning.main", borderRadius: 1.5, p: 1.25, mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.25 }}>
              {supplier || "This supplier"} already has {existing.count} item{existing.count === 1 ? "" : "s"} in the library — this looks like an updated list.
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.75 }}>
              {existing.priceChanges.length} price change{existing.priceChanges.length === 1 ? "" : "s"} · {existing.added} new · {existing.unchanged} unchanged · {existing.missingCount} no longer on the list
              {existing.priceChanges.length > 0 && (
                <> — e.g. {existing.priceChanges.slice(0, 3).map((c) => `${c.name}: $${c.from ?? "—"} → $${c.to}`).join("; ")}{existing.priceChanges.length > 3 ? "; …" : ""}</>
              )}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
                <ToggleButton value="update" sx={{ textTransform: "none" }}>Update existing (recommended)</ToggleButton>
                <ToggleButton value="add" sx={{ textTransform: "none" }}>Add as new items</ToggleButton>
              </ToggleButtonGroup>
              {mode === "update" && existing.missingCount > 0 && (
                <Tooltip title={`Deactivate: ${existing.missing.slice(0, 10).join(", ")}${existing.missingCount > 10 ? ", …" : ""}`}>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <input type="checkbox" checked={retireMissing} onChange={(e) => setRetireMissing(e.target.checked)} id="retire-missing" />
                    <Typography component="label" htmlFor="retire-missing" variant="caption">
                      Retire the {existing.missingCount} item{existing.missingCount === 1 ? "" : "s"} missing from this list
                    </Typography>
                  </Stack>
                </Tooltip>
              )}
            </Stack>
          </Box>
        )}
        {rows.length > 0 && (
          <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 1.5 }}>
            <Box component="table" sx={{ width: "100%", minWidth: 900, borderCollapse: "collapse", "& th, & td": { p: 0.75, borderBottom: 1, borderColor: "divider", textAlign: "left", fontSize: 13 } }}>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" checked={allChecked} onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, checked: e.target.checked })))} />
                  </th>
                  <th>Work item</th>
                  <th style={{ width: 110 }}>Section</th>
                  <th style={{ width: 80 }}>UOM</th>
                  <th style={{ width: 100 }}>Unit cost $</th>
                  <th style={{ width: 100 }}>Unit price $</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ opacity: r.checked ? 1 : 0.45 }}>
                    <td>
                      <input type="checkbox" checked={r.checked} onChange={(e) => setRow(i, { checked: e.target.checked })} />
                    </td>
                    <td>
                      <TextField size="small" fullWidth variant="standard" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                      {r.includes.length > 0 && (
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          {r.includes.length} include{r.includes.length === 1 ? "" : "s"}
                        </Typography>
                      )}
                    </td>
                    <td>
                      <Autocomplete
                        size="small"
                        freeSolo
                        options={sectionTitles}
                        value={r.section}
                        onInputChange={(_, v) => setRow(i, { section: v })}
                        renderInput={(p) => <TextField {...p} variant="standard" />}
                      />
                    </td>
                    <td>
                      <TextField size="small" variant="standard" select value={UOM_OPTIONS.includes(r.uom) ? r.uom : ""} onChange={(e) => setRow(i, { uom: e.target.value })} SelectProps={{ displayEmpty: true }}>
                        {!UOM_OPTIONS.includes(r.uom) && r.uom && <MenuItem value="">{r.uom}</MenuItem>}
                        {UOM_OPTIONS.map((u) => (
                          <MenuItem key={u} value={u}>{u}</MenuItem>
                        ))}
                      </TextField>
                    </td>
                    <td>
                      <TextField size="small" variant="standard" type="number" value={r.unitCost} onChange={(e) => setRow(i, { unitCost: e.target.value })} inputProps={{ step: "0.01" }} />
                      {r.currentCost != null && Number(r.unitCost) !== r.currentCost && (
                        <Typography variant="caption" sx={{ color: "warning.main", display: "block" }}>
                          now ${money(r.currentCost)}
                        </Typography>
                      )}
                    </td>
                    <td>
                      <TextField size="small" variant="standard" type="number" value={r.unitPrice} onChange={(e) => setRow(i, { unitPrice: e.target.value })} placeholder="later" inputProps={{ step: "0.01" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { reset(); onClose(); }} disabled={busy} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button variant="contained" onClick={apply} disabled={busy || !rows.some((r) => r.checked)} sx={{ textTransform: "none" }}>
          {busy && rows.length ? "Adding…" : `Add ${rows.filter((r) => r.checked).length} item${rows.filter((r) => r.checked).length === 1 ? "" : "s"}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

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
  const [importOpen, setImportOpen] = useState(false);
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
  // Sort the WHOLE filtered list before slicing — the table itself is in
  // manualSorting mode, so header arrows drive this hook.
  const { sorted, sorting, sortingProps } = useClientSort(filtered, {
    section: (w: any) => `${w.workSection?.letter || ""} ${w.workSection?.title || ""}`.trim(),
    descriptionTemplate: (w: any) => w.descriptionTemplate || w.name,
  });

  // Sort changes restart at page 1 (declared after the hook — TDZ).
  useEffect(() => {
    setPage(1);
  }, [sorting]);

  const paged = useMemo(() => sorted.slice((page - 1) * limit, page * limit), [sorted, page, limit]);

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
      {
        accessorKey: "unitCost",
        header: "Unit cost",
        cell: ({ row }: any) => (
          <Box>
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", color: "text.secondary" }}>{row.original.unitCost == null ? "—" : `$${money(row.original.unitCost)}`}</Typography>
            {row.original.supplierName && (
              <Typography variant="caption" sx={{ color: "text.disabled", display: "block", maxWidth: 140 }} noWrap>
                {row.original.supplierName}
              </Typography>
            )}
          </Box>
        ),
      },
      kebabColumn((row: any) => [
        { label: "Edit", onClick: () => openEdit(row) },
        { label: "Delete", destructive: true, onClick: () => setToDelete(row) },
      ]),
    ],
    [],
  );

  return (
    <MainCard>
      <PageTable
        onRowClick={(r: any) => openEdit(r)}
        tableName="Work Library"
        subTitle="Trade sections and templatised quotation lines used by the quotation editor"
        columns={columns as any}
        data={paged}
        {...sortingProps}
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
          <Button key="import" variant="outlined" onClick={() => setImportOpen(true)} data-tour="work-library-import">
            Upload price list
          </Button>,
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

      <ImportPricelistDialog open={importOpen} sections={sections} api={api} onClose={() => setImportOpen(false)} onDone={load} />
    </MainCard>
  );
}
