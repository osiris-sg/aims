"use client";

// CRM › Contacts — everyone this org has messaged on WhatsApp, with the
// best-known name and a per-number AI auto-reply permission:
//   Approved → AI may auto-reply (subject to the global policy)
//   Blocked  → AI never auto-replies; it still drafts a suggestion for review
//   Default  → follows the org's global agent setting

import { Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { Chat } from "@mui/icons-material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import PageTable from "@/components/PageTable";
import { useWhatsAppApi } from "../_lib/api";

interface Contact {
  waId: string;
  name: string | null;
  lastMessageAt: string | null;
  agentAutoReply: "APPROVED" | "BLOCKED" | null;
}

export default function CrmContactsPage() {
  const { request } = useWhatsAppApi();

  const [rows, setRows] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await request<Contact[]>("/whatsapp/contacts");
      setRows(Array.isArray(list) ? list : []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const setPermission = useCallback(
    async (waId: string, permission: "APPROVED" | "BLOCKED" | null) => {
      setBusy(waId);
      // optimistic
      setRows((prev) => prev.map((r) => (r.waId === waId ? { ...r, agentAutoReply: permission } : r)));
      try {
        await request(`/whatsapp/contacts/${waId}/agent-permission`, {
          method: "POST",
          body: JSON.stringify({ permission }),
        });
      } catch (e: any) {
        toast.error(e.message || "Update failed");
        await load();
      } finally {
        setBusy(null);
      }
    },
    [request, load],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.waId.includes(q.replace(/\D/g, "")) || (r.name || "").toLowerCase().includes(q));
  }, [rows, search]);

  const paged = useMemo(() => visible.slice((page - 1) * limit, page * limit), [visible, page, limit]);
  const pageCount = Math.max(1, Math.ceil(visible.length / limit));

  const columns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Contact",
        cell: ({ row }: any) => {
          const c: Contact = row.original;
          return (
            <Box>
              <Typography variant="body2">{c.name || c.waId}</Typography>
              {c.name && (
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {c.waId}
                </Typography>
              )}
            </Box>
          );
        },
      },
      {
        accessorKey: "lastMessageAt",
        header: "Last message",
        cell: ({ row }: any) =>
          row.original.lastMessageAt ? (
            <Box sx={{ whiteSpace: "nowrap" }}>{new Date(row.original.lastMessageAt).toLocaleString()}</Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        accessorKey: "agentAutoReply",
        header: "AI auto-reply",
        cell: ({ row }: any) => {
          const c: Contact = row.original;
          return (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={c.agentAutoReply ?? "DEFAULT"}
              disabled={busy === c.waId}
              onChange={(_, v) => {
                if (v === null) return;
                setPermission(c.waId, v === "DEFAULT" ? null : v);
              }}
            >
              <ToggleButton value="APPROVED" color="success">
                Approve
              </ToggleButton>
              <ToggleButton value="DEFAULT">Default</ToggleButton>
              <ToggleButton value="BLOCKED" color="error">
                Block
              </ToggleButton>
            </ToggleButtonGroup>
          );
        },
      },
    ],
    [busy, setPermission],
  );

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <Chat color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Contacts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Everyone you&apos;ve messaged on WhatsApp. Control whether the AI may auto-reply per number.
          </Typography>
        </Box>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Chip size="small" color="success" variant="outlined" label="Approve = AI may auto-reply" />
        <Chip size="small" variant="outlined" label="Default = follows global agent setting" />
        <Chip size="small" color="error" variant="outlined" label="Block = AI never auto-replies (still drafts for review)" />
        <Button size="small" onClick={load}>
          Refresh
        </Button>
      </Stack>

      <PageTable
        columns={columns}
        data={paged}
        tableName="Contacts"
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
    </Box>
  );
}
