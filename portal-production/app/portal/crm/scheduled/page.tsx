"use client";

// CRM › Scheduled — queue free-text WhatsApp messages to a number for a
// future time. A backend scheduler delivers them (checked every minute).
// Free-text delivery follows WhatsApp's 24h customer-service window rule.

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { Cancel, Schedule } from "@mui/icons-material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import PageTable from "@/components/PageTable";
import ContactSelect from "../_components/ContactSelect";
import { useWhatsAppApi } from "../_lib/api";

interface ScheduledMessage {
  id: string;
  to: string;
  body: string;
  scheduledAt: string;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";
  error: string | null;
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM_DAYS";
  recurEvery: number | null;
  recurUntil: string | null;
  recurCount: number;
  createdAt: string;
}

const recurrenceLabel = (r: ScheduledMessage): string => {
  switch (r.recurrence) {
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return "Weekly";
    case "MONTHLY":
      return "Monthly";
    case "CUSTOM_DAYS":
      return `Every ${r.recurEvery} days`;
    default:
      return "Once";
  }
};

const statusColor = (s: ScheduledMessage["status"]): "warning" | "info" | "success" | "error" | "default" => {
  switch (s) {
    case "PENDING":
      return "warning";
    case "SENDING":
      return "info";
    case "SENT":
      return "success";
    case "FAILED":
      return "error";
    default:
      return "default";
  }
};

export default function CrmScheduledPage() {
  const { request } = useWhatsAppApi();

  const [rows, setRows] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState("");
  const [recurrence, setRecurrence] = useState("NONE");
  const [recurEvery, setRecurEvery] = useState("7");
  const [recurUntil, setRecurUntil] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await request<ScheduledMessage[]>("/whatsapp/schedule");
      setRows(Array.isArray(list) ? list : []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load scheduled messages");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    if (!to.trim() || !body.trim() || !when) {
      toast.error("Recipient, message and time are all required");
      return;
    }
    setSaving(true);
    try {
      await request("/whatsapp/schedule", {
        method: "POST",
        body: JSON.stringify({
          to,
          body,
          scheduledAt: new Date(when).toISOString(),
          recurrence,
          recurEvery: recurrence === "CUSTOM_DAYS" ? Number(recurEvery) : undefined,
          recurUntil: recurrence !== "NONE" && recurUntil ? new Date(recurUntil).toISOString() : null,
        }),
      });
      toast.success(recurrence === "NONE" ? "Message scheduled" : "Recurring message scheduled");
      setDialogOpen(false);
      setTo("");
      setBody("");
      setWhen("");
      setRecurrence("NONE");
      setRecurUntil("");
      await load();
    } catch (e: any) {
      toast.error(e.message || "Scheduling failed");
    } finally {
      setSaving(false);
    }
  }, [request, to, body, when, load]);

  const cancel = useCallback(
    async (id: string) => {
      try {
        await request(`/whatsapp/schedule/${id}/cancel`, { method: "POST" });
        await load();
      } catch (e: any) {
        toast.error(e.message || "Cancel failed");
      }
    },
    [request, load],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.to.includes(q) || r.body.toLowerCase().includes(q));
  }, [rows, search]);

  const paged = useMemo(() => visible.slice((page - 1) * limit, page * limit), [visible, page, limit]);
  const pageCount = Math.max(1, Math.ceil(visible.length / limit));

  const columns = useMemo(
    () => [
      {
        accessorKey: "scheduledAt",
        header: "Next send",
        cell: ({ row }: any) => (
          <Box sx={{ whiteSpace: "nowrap" }}>{new Date(row.original.scheduledAt).toLocaleString()}</Box>
        ),
      },
      {
        accessorKey: "recurrence",
        header: "Repeats",
        cell: ({ row }: any) => {
          const r: ScheduledMessage = row.original;
          const label = recurrenceLabel(r);
          return (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Chip
                size="small"
                label={label}
                variant="outlined"
                color={r.recurrence === "NONE" ? "default" : "primary"}
              />
              {r.recurCount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  ×{r.recurCount} sent
                </Typography>
              )}
            </Stack>
          );
        },
      },
      {
        accessorKey: "to",
        header: "Recipient",
        cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums" }}>{row.original.to}</Box>,
      },
      {
        accessorKey: "body",
        header: "Message",
        cell: ({ row }: any) => (
          <Box sx={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.original.body}
          </Box>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }: any) => {
          const r: ScheduledMessage = row.original;
          return (
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" label={r.status} color={statusColor(r.status)} variant="outlined" />
              {r.error && (
                <Tooltip title={r.error}>
                  <Typography variant="caption" color="error" sx={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.error}
                  </Typography>
                </Tooltip>
              )}
            </Stack>
          );
        },
      },
      {
        accessorKey: "actions",
        header: "",
        cell: ({ row }: any) =>
          row.original.status === "PENDING" ? (
            <Button size="small" color="warning" startIcon={<Cancel />} onClick={() => cancel(row.original.id)}>
              Cancel
            </Button>
          ) : null,
      },
    ],
    [cancel],
  );

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <Schedule color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Scheduled messages
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Queue a WhatsApp message to send at a future time. Checked every minute.
          </Typography>
        </Box>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Free-text messages only reach recipients who have messaged this number within 24 hours of the send time
        (WhatsApp&apos;s rule). For reminders to anyone at any time, an approved template will be needed once the
        account review clears.
      </Alert>

      <PageTable
        columns={columns}
        data={paged}
        tableName="Scheduled messages"
        buttonName="Schedule message"
        onAddClick={() => setDialogOpen(true)}
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Schedule a message</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <ContactSelect label="Recipient (with country code)" value={to} onChange={setTo} />
            <TextField
              label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              multiline
              minRows={3}
            />
            <TextField
              label={recurrence === "NONE" ? "Send at" : "First send at"}
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              select
              label="Repeat"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              size="small"
            >
              <MenuItem value="NONE">Once (no repeat)</MenuItem>
              <MenuItem value="DAILY">Daily</MenuItem>
              <MenuItem value="WEEKLY">Weekly</MenuItem>
              <MenuItem value="MONTHLY">Monthly</MenuItem>
              <MenuItem value="CUSTOM_DAYS">Custom — every N days</MenuItem>
            </TextField>
            {recurrence === "CUSTOM_DAYS" && (
              <TextField
                label="Every N days"
                type="number"
                value={recurEvery}
                onChange={(e) => setRecurEvery(e.target.value)}
                size="small"
                inputProps={{ min: 1 }}
              />
            )}
            {recurrence !== "NONE" && (
              <TextField
                label="Repeat until (optional)"
                type="datetime-local"
                value={recurUntil}
                onChange={(e) => setRecurUntil(e.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
                helperText="Leave blank to repeat indefinitely — cancel any time to stop."
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={saving} onClick={create}>
            Schedule
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
