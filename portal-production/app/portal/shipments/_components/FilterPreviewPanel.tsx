"use client";

// The sender filter's preview (what it kept / would drop, from-domain + subject
// 60 only — never bodies or addresses). Round P: lives in Org Settings →
// Shipping → Email filter (it left the Inbox, which now shows only
// Unprocessed / Processed mail).

import React, { useState } from "react";
import { Alert, Box, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type FilterPreview } from "../_lib/api";
import { fmtDateTime } from "../_lib/format";
import { toast } from "../_lib/toast";
import { Button } from "@mui/material";

/** Round Q: the accept rate (moved from the Inbox) and the emails hidden as obvious non-shipment mail, with Unhide. */
export function EmailFilterExtras() {
  const api = useShipmentsApi();
  const stats = useQuery({ queryKey: ["trade-inbox", "stats"], queryFn: () => api.inboxStats(30), staleTime: 60_000 });
  const hidden = useQuery({ queryKey: ["trade-inbox", "hidden"], queryFn: () => api.inboxHidden(), staleTime: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const unhide = async (id: string) => {
    setBusy(id);
    try {
      await api.inboxUnhide(id);
      toast.success("Back in the inbox");
      await hidden.refetch();
    } catch (e) {
      toast.error((e as Error)?.message || "Could not unhide");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Box sx={{ mt: 3 }}>
      {stats.data && (stats.data.reviewed > 0 || stats.data.AUTO > 0) && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} data-tour="inbox-accept-rate">
          Last {stats.data.days} days: {stats.data.acceptedAsIsPct ?? "—"}% accepted as-is · auto {stats.data.AUTO} · changed {stats.data.CHANGED} · rejected {stats.data.REJECTED}
        </Typography>
      )}
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Hidden ({hidden.data?.length ?? 0})
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        Calendar responses, meeting invites, auto-replies and newsletters are kept but left out of the inbox. Unhide brings one back.
      </Typography>
      {hidden.isLoading ? (
        <CircularProgress size={18} />
      ) : !hidden.data?.length ? (
        <Typography variant="body2" color="text.secondary">
          Nothing hidden.
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small" data-tour="settings-hidden-emails">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>From domain</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Why</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {hidden.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.date)}</TableCell>
                  <TableCell>{r.fromDomain}</TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {r.subject || "(no subject)"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {r.reason ?? "—"}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" disabled={busy === r.id} onClick={() => void unhide(r.id)}>
                      Unhide
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}

export default /** What the sender filter kept / would drop (SHADOW): from-domain + subject (60) only — never bodies or addresses. */
function FilterPreviewPanel() {
  const api = useShipmentsApi();
  const [show, setShow] = useState<"DROP" | "KEEP" | "ALL">("DROP");
  const q = useQuery({ queryKey: ["trade-inbox", "filter-preview"], queryFn: () => api.inboxFilterPreview(30), staleTime: 60_000 });
  const d: FilterPreview | undefined = q.data;
  const items = (d?.items ?? []).filter((r) => show === "ALL" || r.filterVerdict === show);
  const falseDrops = (d?.items ?? []).filter((r) => r.falseDrop).length;
  if (q.isError) return <Alert severity="error">{(q.error as Error)?.message || "Could not load the filter preview"}</Alert>;
  if (q.isLoading) return <CircularProgress />;
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        The sender filter in its trial run (Settings → Shipping → Email filter): every email is still kept; this shows what it would drop once switched to Enforce. Last {d?.days ?? 30} days: <b>kept {d?.kept ?? 0}</b> · <b>would drop {d?.dropped ?? 0}</b>
        {falseDrops ? ` · ${falseDrops} of them shipment / unsure mail — add the sender to the allow-list before enforcing` : ""}.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        {(["DROP", "KEEP", "ALL"] as const).map((k) => (
          <Chip key={k} label={k === "DROP" ? "Would drop" : k === "KEEP" ? "Kept" : "All"} color={show === k ? "primary" : "default"} variant={show === k ? "filled" : "outlined"} onClick={() => setShow(k)} />
        ))}
      </Stack>
      {!items.length ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {d && d.kept + d.dropped === 0 ? "No email judged yet — the filter is off, or nothing arrived since it was switched on." : "Nothing here."}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small" data-tour="settings-filter-preview">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>From domain</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Filter</TableCell>
                <TableCell>Why</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.date)}</TableCell>
                  <TableCell>{r.fromDomain}</TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                      {r.subject || "(no subject)"}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Chip size="small" variant="outlined" color={r.filterVerdict === "KEEP" ? "success" : "default"} label={r.filterVerdict === "KEEP" ? "Kept" : "Would drop"} />
                    {r.falseDrop && <Chip size="small" color="error" variant="outlined" label="false drop" title={`Triage said ${r.verdict}`} sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {r.reason ?? "—"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}
