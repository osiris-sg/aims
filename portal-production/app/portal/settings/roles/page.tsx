"use client";

// Org Settings > Roles (Custom access, enableCustomAccess; WCT group 2026-11-19). Admin / superadmin
// make custom roles: a name and, per tab, No access / View / Edit. The built-in roles are listed
// read-only with their access per tab. A custom role shows in Add / Edit User next to the built-in
// ones. The API (src/access) checks the setting and the caller, and enforces the access.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MainCard from "@/components/MainCard";
import PageTable, { DEFAULT_PAGE_SIZE } from "@/components/PageTable";
import { request } from "@/helpers/request";
import { failureText, replyBody, requestFailed } from "@/helpers/requestOutcome";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { accessSummary, noAccess, readTabAccess, type TabAccessMap } from "@/helpers/customAccess";
import AccessGrid from "./_components/AccessGrid";

type Row = { id: string; name: string; label?: string; tabs: TabAccessMap; users: number; builtIn: boolean };
type Editing = { id: string | null; name: string; tabs: TabAccessMap; builtIn: boolean };

export default function RolesPage() {
  const { getToken } = useAuth();
  const { isCustomAccessEnabled, isLoading } = useOrganizationFeatures();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: Row } | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [filters, setFilters] = useState<any>({});

  const call = useCallback(
    async (path: string, method: string, body: any = {}) => {
      const token = await getToken();
      return request({ path, method, ownError: true }, body, token ?? undefined);
    },
    [getToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const res = await call("/access/roles", "GET");
    if (requestFailed(res)) {
      setError(failureText(res, "Could not load the roles"));
      setRows([]);
    } else {
      const body: any = replyBody(res) || {};
      const custom: Row[] = (body.roles || []).map((r: any) => ({ id: r.id, name: r.name, tabs: readTabAccess(r.tabs), users: r.users ?? 0, builtIn: false }));
      const presets: Row[] = (body.presets || []).map((r: any) => ({ id: r.id, name: r.name, label: r.label, tabs: readTabAccess(r.tabs), users: r.users ?? 0, builtIn: true }));
      setRows([...custom, ...presets]);
      setError(null);
    }
    setLoading(false);
  }, [call]);

  useEffect(() => {
    if (isCustomAccessEnabled) void load();
  }, [isCustomAccessEnabled, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => (r.label || r.name).toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const save = async () => {
    if (!editing || editing.builtIn) return;
    setSaving(true);
    setDialogError(null);
    const body = { name: editing.name, tabs: editing.tabs };
    const res = editing.id ? await call(`/access/roles/${editing.id}`, "PATCH", body) : await call("/access/roles", "POST", body);
    setSaving(false);
    if (requestFailed(res)) {
      setDialogError(failureText(res, "Could not save the role"));
      return;
    }
    setEditing(null);
    void load();
  };

  const remove = async () => {
    if (!toDelete) return;
    const res = await call(`/access/roles/${toDelete.id}`, "DELETE");
    if (requestFailed(res)) {
      setError(failureText(res, "Could not delete the role"));
    } else {
      void load();
    }
    setToDelete(null);
  };

  const columns: any[] = [
    {
      accessorKey: "name",
      header: "Role",
      size: 18,
      cell: ({ row }: any) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {row.original.label || row.original.name}
          </Typography>
          {row.original.builtIn && <Chip size="small" variant="outlined" label="Built-in" />}
        </Box>
      ),
    },
    { accessorKey: "tabs", header: "Access", size: 60, cell: ({ row }: any) => <Typography variant="body2">{accessSummary(row.original.tabs)}</Typography> },
    { accessorKey: "users", header: "Users", size: 8, cell: ({ row }: any) => row.original.users },
    {
      accessorKey: "action",
      header: "",
      size: 4,
      enableSorting: false,
      cell: ({ row }: any) =>
        row.original.builtIn ? null : (
          <IconButton
            size="small"
            aria-label="Row actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original });
            }}
            sx={{ color: "text.secondary" }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        ),
    },
  ];

  if (!isLoading && !isCustomAccessEnabled) {
    return (
      <MainCard>
        <Alert severity="info">Roles are not available for this organisation.</Alert>
      </MainCard>
    );
  }

  return (
    <MainCard>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <PageTable
        onRowClick={(r: Row) => {
          setDialogError(null);
          setEditing({ id: r.id, name: r.label || r.name, tabs: r.tabs, builtIn: r.builtIn });
        }}
        columns={columns}
        data={filtered}
        tableName="Roles"
        actionButtons={[
          <Button
            key="add"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setDialogError(null);
              setEditing({ id: null, name: "", tabs: noAccess(), builtIn: false });
            }}
          >
            Add role
          </Button>,
        ]}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={[]}
        clientPaging
        pageCount={1}
        totalDocs={filtered.length}
        noSelectionColumn
      />

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu?.pos}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            setToDelete(menu?.row ?? null);
            setMenu(null);
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <Dialog open={!!editing} onClose={() => !saving && setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing?.builtIn ? editing.name : editing?.id ? "Edit role" : "Add role"}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          {dialogError && <Alert severity="error">{dialogError}</Alert>}
          {!editing?.builtIn && (
            <TextField label="Role name" size="small" fullWidth value={editing?.name ?? ""} onChange={(e) => editing && setEditing({ ...editing, name: e.target.value })} inputProps={{ maxLength: 40 }} />
          )}
          {editing && <AccessGrid value={editing.tabs} readOnly={editing.builtIn} onChange={(tabs) => setEditing({ ...editing, tabs })} />}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditing(null)} disabled={saving}>
            {editing?.builtIn ? "Close" : "Cancel"}
          </Button>
          {!editing?.builtIn && (
            <Button variant="contained" onClick={save} disabled={saving || !editing?.name.trim()}>
              {saving ? "Saving" : "Save"}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)}>
        <DialogTitle>Delete role {toDelete?.name}?</DialogTitle>
        <DialogActions>
          <Button color="inherit" onClick={() => setToDelete(null)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={remove}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
