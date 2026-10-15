"use client";

// Org Settings → Shipping & documents → Email intake (read-only). The org's
// docs+{orgId}@ forwarding address with a copy button, and the emails received
// on it: date, from, subject, attachments. Store-only for now — each email is
// kept as its .eml plus attachments (click a row for the .eml, an attachment
// chip for that file); nothing is sorted into deals yet.

import React from "react";
import { Alert, Box, Button, Chip, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type IntakeEmail } from "../_lib/api";
import { toast } from "../_lib/toast";

const when = (e: IntakeEmail) => {
  const d = new Date(e.date ?? e.receivedAt);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function EmailIntakePanel() {
  const api = useShipmentsApi();
  const q = useQuery({ queryKey: ["email-intake"], queryFn: () => api.emailIntake(), refetchInterval: 30000 });
  const data = q.data;

  const copy = async () => {
    if (!data?.address) return;
    try {
      await navigator.clipboard.writeText(data.address);
      toast.success("Address copied");
    } catch {
      toast.error("Could not copy — select the address and copy it");
    }
  };

  const open = async (id: string, attachment?: number) => {
    // Open the tab inside the click (popup blockers), then point it at the signed link.
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await api.emailIntakeFile(id, attachment);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      toast.error((e as Error)?.message || "Could not open the file");
    }
  };

  if (q.isLoading) return <Typography variant="body2" color="text.secondary">Loading…</Typography>;
  if (q.isError) return <Alert severity="error">{(q.error as Error)?.message || "Could not load the email intake"}</Alert>;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="caption" color="text.secondary">
          Forward emails to
        </Typography>
        {data?.address ? (
          <Stack direction="row" spacing={1} alignItems="center" data-tour="email-intake-address">
            <Typography sx={{ fontFamily: "monospace", fontSize: 14, wordBreak: "break-all", userSelect: "all" }}>{data.address}</Typography>
            <Tooltip title="Copy address">
              <IconButton size="small" onClick={() => void copy()} aria-label="Copy address">
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : (
          <Alert severity="warning">No intake address: {data?.addressNote ?? "not configured"}.</Alert>
        )}
        {!data?.enabled && <Alert severity="info" sx={{ mt: 1 }}>Email intake is off for this organization — mail sent to the address is not kept.</Alert>}
      </Box>

      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Received emails
          </Typography>
          <Button size="small" startIcon={<RefreshIcon />} onClick={() => void q.refetch()} disabled={q.isFetching}>
            Refresh
          </Button>
        </Stack>
        {!data?.emails.length ? (
          <Typography variant="body2" color="text.secondary">
            Nothing received yet. Forward an email to the address above; it appears here within a minute.
          </Typography>
        ) : (
          <Table size="small" data-tour="email-intake-list">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 170 }}>Date</TableCell>
                <TableCell sx={{ width: 220 }}>From</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Attachments</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.emails.map((e) => (
                <TableRow
                  key={e.id}
                  hover
                  sx={{ cursor: e.hasEml ? "pointer" : "default" }}
                  onClick={() => e.hasEml && void open(e.id)}
                  title={e.hasEml ? "Open the email (.eml)" : e.reason ?? e.status}
                >
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{when(e)}</TableCell>
                  <TableCell sx={{ wordBreak: "break-all" }}>{e.from || "—"}</TableCell>
                  <TableCell>
                    {e.subject || <em>(no subject)</em>}
                    {e.status !== "STORED" && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        {e.status}
                        {e.reason ? ` · ${e.reason}` : ""}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5 }}>
                      {e.attachments.length
                        ? e.attachments.map((a) => (
                            <Chip
                              key={a.index}
                              size="small"
                              variant="outlined"
                              icon={<AttachFileIcon />}
                              label={a.name}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                void open(e.id, a.index);
                              }}
                            />
                          ))
                        : e.attachmentNames.length
                          ? e.attachmentNames.map((n, i) => <Chip key={i} size="small" variant="outlined" label={n} />)
                          : <Typography variant="caption" color="text.secondary">—</Typography>}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>
    </Stack>
  );
}
