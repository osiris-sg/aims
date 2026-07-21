"use client";

// Master Files → Services tab. Standard PageTable page (same shell as the
// Customers / Suppliers / Products tabs) over the RevenueItem services list.
// The GL account mapping is intentionally NOT shown in the table — it's set in
// the add/edit dialog (required for invoice-line self-coding) and managed in
// Accounting Setup → Revenue Items.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import GLAccountSelect from "@/components/GLAccountSelect";

type Service = {
  id: string;
  code?: string | null;
  name: string;
  unitPrice?: number | null;
  accountCode: string;
  accountName?: string | null;
  isActive: boolean;
};

const blankForm = { code: "", name: "", unitPrice: "" as string | number, accountCode: "" };

export default function MasterFilesServices() {
  const { getToken } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

  // Same authed fetch as the accounting-setup page — MUST carry X-Active-Org-Id
  // so admin "Viewing as <org>" scopes to the right org.
  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      const headers: Record<string, string> = {
        ...(init?.headers as Record<string, string> | undefined),
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }
      return fetch(`${apiBase}${path}`, { ...init, headers });
    },
    [apiBase, getToken]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [svcRes, accRes] = await Promise.all([
        authedFetch("/revenue-items?type=SERVICE"),
        authedFetch("/accounting/accounts"),
      ]);
      if (svcRes.ok) {
        const json = await svcRes.json();
        const list = json?.data ?? json;
        setServices(Array.isArray(list) ? list : []);
      }
      if (accRes.ok) {
        const json = await accRes.json();
        const list = json?.data ?? json;
        setAccounts(Array.isArray(list) ? list : []);
      }
    } catch (e) {
      console.error("[MasterFiles/Services] load failed", e);
      toast.error("Failed to load services");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);
  useEffect(() => { load(); }, [load]);

  // Grouped GL picker options for the dialog (Revenue → Expense recovery →
  // Other) — same grouping as Accounting Setup → Revenue Items.
  const groupedAccounts = useMemo(() => {
    const sort = (xs: any[]) => xs.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const active = (accounts || []).filter((a) => a.isActive !== false);
    const revenue = sort(active.filter((a) => ["SALES", "INCOME"].includes(a.accountType)));
    const expense = sort(active.filter((a) => ["EXPENSE", "PURCHASE"].includes(a.accountType)));
    const other = sort(active.filter((a) => !["SALES", "INCOME", "EXPENSE", "PURCHASE"].includes(a.accountType)));
    return [
      { label: "Revenue", accounts: revenue },
      { label: "Expense recovery (credits the expense)", accounts: expense },
      { label: "Other / contra accounts", accounts: other },
    ].filter((g) => g.accounts.length);
  }, [accounts]);

  // Client-side search + pagination (service lists are small). Filter the full
  // set, then slice one page so the pager works across all rows.
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return services;
    return services.filter((it) =>
      [it.code, it.name].some((v) => String(v ?? "").toLowerCase().includes(s))
    );
  }, [services, search]);
  const paged = useMemo(() => filtered.slice((page - 1) * limit, page * limit), [filtered, page, limit]);
  useEffect(() => { setPage(1); }, [search, limit]);

  const openNew = () => { setEditing(null); setForm(blankForm); setDialogOpen(true); };
  const openEdit = (it: Service) => {
    setEditing(it);
    setForm({ code: it.code ?? "", name: it.name, unitPrice: it.unitPrice ?? "", accountCode: it.accountCode });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.warn("Name is required"); return; }
    if (!form.accountCode) { toast.warn("Pick a GL account"); return; }
    setSaving(true);
    try {
      const payload = {
        code: String(form.code || "").trim() || null,
        name: form.name.trim(),
        type: "SERVICE",
        unitPrice: form.unitPrice === "" ? null : parseFloat(String(form.unitPrice)),
        accountCode: form.accountCode,
      };
      const res = editing
        ? await authedFetch(`/revenue-items/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await authedFetch("/revenue-items", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      toast.success(editing ? "Service updated" : "Service added");
      setDialogOpen(false);
      load();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!serviceToDelete) return;
    setDeleting(true);
    try {
      const res = await authedFetch(`/revenue-items/${serviceToDelete.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Service deleted");
      setServiceToDelete(null);
      load();
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      id: "code",
      accessorKey: "code",
      header: "Service Code",
      cell: (info: any) => info.getValue() || "-",
    },
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "unitPrice",
      accessorKey: "unitPrice",
      header: "Unit Price",
      cell: (info: any) => {
        const v = info.getValue();
        return v == null || v === "" ? "-" : Number(v).toFixed(2);
      },
    },
    {
      id: "isActive",
      accessorKey: "isActive",
      header: "Status",
      cell: (info: any) => (
        <Chip size="small" label={info.getValue() === false ? "Inactive" : "Active"} color={info.getValue() === false ? "default" : "success"} variant="outlined" />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: (info: any) => {
        const svc = info.row.original as Service;
        return (
          <Box display="flex" gap={1}>
            <IconButton
              onClick={() => openEdit(svc)}
              sx={{ color: "text.secondary", "&:hover": { color: "info.main" } }}
            >
              <EditIcon />
            </IconButton>
            <IconButton
              onClick={() => setServiceToDelete(svc)}
              sx={{ color: "text.secondary", "&:hover": { color: "error.main" } }}
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        );
      },
    },
  ];

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={paged}
        tableName="Services List"
        subTitle="All services for this organization"
        buttonName="Add Service"
        onAddClick={openNew}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        pageCount={Math.max(1, Math.ceil(filtered.length / limit))}
        totalDocs={filtered.length}
      />

      <DeleteItemDialogNoConfirm
        open={!!serviceToDelete}
        onCancel={() => setServiceToDelete(null)}
        onConfirm={handleDelete}
        loading={deleting}
      />

      {/* Add / edit dialog — GL account lives here (required for posting), not in the table */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "Edit Service" : "Add Service"}</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label="Service code (optional)"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
            <TextField
              size="small"
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <TextField
              size="small"
              label="Unit price (optional)"
              type="number"
              value={form.unitPrice}
              onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
            />
            <GLAccountSelect
              label="GL account"
              value={form.accountCode}
              accounts={groupedAccounts}
              onChange={(code) => setForm((f) => ({ ...f, accountCode: code }))}
              helperText="Invoice lines for this service credit this account"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
