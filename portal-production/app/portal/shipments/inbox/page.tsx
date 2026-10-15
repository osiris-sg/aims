/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Shipments → Inbox: the emails the intake address received, after AI
// triage. Not-shipment mail is purged at triage and never shows here.
//   Suggested  — matched and planned, waiting for Accept (TRIAGE mode)
//   Unmatched  — no (or several) orders / shipments fit: assign one by hand
//   Processed  — done (AUTO, or accepted); every action can be undone
//   Unsure     — the AI couldn't tell; kept 14 days for review, then purged
// Row click opens the details (keys found, planned / done actions); actions
// are in the row's ⋮ menu.

import React, { useMemo, useState } from "react";
import { Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import CallMadeIcon from "@mui/icons-material/CallMade";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type InboxRow, type InboxTab } from "../_lib/api";
import { useOrders, useShipments, useTradeMutation } from "../_lib/hooks";
import { fmtDateTime } from "../_lib/format";
import { toast } from "../_lib/toast";
import { ConfirmDialog } from "../_components/bits";

const TABS: Array<{ value: InboxTab; label: string }> = [
  { value: "SUGGESTED", label: "Suggested" },
  { value: "UNMATCHED", label: "Unmatched" },
  { value: "PROCESSED", label: "Processed" },
  { value: "UNSURE", label: "Unsure" },
];

const actionText = (a: InboxRow["planned"][number]) =>
  a.kind === "file"
    ? `${a.status === "done" ? "Filed" : a.status === "undone" ? "Removed" : a.status === "skipped" ? "Skip" : "File"} ${a.filename ?? ""}${a.docType ? ` as ${a.docType}` : ""}${a.ownerKind ? ` on the ${a.ownerKind}` : ""}${a.reason ? ` — ${a.reason}` : ""}`
    : a.kind === "field"
      ? `${a.status === "done" ? "Filled" : "Fill"} ${a.field} = ${a.value}${a.reason ? ` — ${a.reason}` : ""}`
      : `${a.status === "done" ? "Ticked" : "Tick"} ${a.label ?? "sent"}${a.reason ? ` — ${a.reason}` : ""}`;

export default function InboxPage() {
  const api = useShipmentsApi();
  const [tab, setTab] = useState<InboxTab>("SUGGESTED");
  const q = useQuery({ queryKey: ["trade-inbox", tab], queryFn: () => api.inbox(tab), refetchInterval: 30000 });
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: InboxRow } | null>(null);
  const [open, setOpen] = useState<InboxRow | null>(null);
  const [assign, setAssign] = useState<InboxRow | null>(null);
  const [confirm, setConfirm] = useState<{ row: InboxRow; act: "undo" | "dismiss" } | null>(null);
  const act = useTradeMutation((a, v: { id: string; act: "accept" | "undo" | "dismiss" | "retriage" }): Promise<unknown> =>
    v.act === "accept" ? a.inboxAccept(v.id) : v.act === "undo" ? a.inboxUndo(v.id) : v.act === "dismiss" ? a.inboxDismiss(v.id) : a.inboxRetriage(v.id),
  );
  const run = async (row: InboxRow, what: "accept" | "undo" | "dismiss" | "retriage") => {
    try {
      await act.mutateAsync({ id: row.id, act: what });
      toast.success(what === "accept" ? "Done — documents filed" : what === "undo" ? "Undone — back to Suggested" : what === "dismiss" ? "Removed (not shipment mail)" : "Triaged again");
      await q.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Could not do that");
    }
  };
  const rows = q.data?.items ?? [];
  const counts = q.data?.counts;

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>
        Inbox
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Emails sent to the intake address, sorted by AI. Mail that isn&apos;t about a shipment is deleted at once; nothing an email says is followed — only its documents and numbers are used.
      </Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} variant="scrollable" allowScrollButtonsMobile data-tour="inbox-tabs">
        {TABS.map((t) => (
          <Tab key={t.value} value={t.value} label={`${t.label}${counts ? ` (${counts[t.value] ?? 0})` : ""}`} sx={{ textTransform: "none" }} />
        ))}
      </Tabs>
      {q.isError ? (
        <Alert severity="error">{(q.error as Error)?.message || "Could not load the inbox"}</Alert>
      ) : q.isLoading ? (
        <CircularProgress />
      ) : !rows.length ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            Nothing here.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <Table size="small" data-tour="inbox-table">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Dir.</TableCell>
                <TableCell>With</TableCell>
                <TableCell>Subject</TableCell>
                <TableCell>Matched</TableCell>
                <TableCell>Actions</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const list = r.done.length ? r.done : r.planned;
                const doing = list.filter((a) => a.status === "planned" || a.status === "done");
                return (
                  <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpen(r)}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.date)}</TableCell>
                    <TableCell>{r.direction === "OUT" ? <CallMadeIcon fontSize="small" titleAccess="Sent" /> : <CallReceivedIcon fontSize="small" titleAccess="Received" />}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={r.counterparty ?? "—"} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 360 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={r.subject ?? ""}>
                        {r.subject || "(no subject)"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {r.from}
                        {r.attachments.length ? ` · ${r.attachments.length} attachment(s)` : ""}
                      </Typography>
                    </TableCell>
                    <TableCell>{r.matched ? <Chip size="small" color="primary" variant="outlined" label={`${r.matched}${r.matchedBy ? ` · ${r.matchedBy}` : ""}`} /> : "—"}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{doing.length ? `${doing.length} ${r.done.length ? "done" : "planned"}` : "—"}</Typography>
                      {r.inboxState === "UNSURE" && r.purgeAfter && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          purged {fmtDateTime(r.purgeAfter)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      {r.canUndo && (
                        <Button size="small" onClick={() => setConfirm({ row: r, act: "undo" })} data-tour="inbox-undo">
                          Undo
                        </Button>
                      )}
                      {r.inboxState === "SUGGESTED" && (
                        <Button size="small" variant="contained" disabled={act.isPending} onClick={() => void run(r, "accept")}>
                          Accept
                        </Button>
                      )}
                      <IconButton size="small" aria-label="Email actions" onClick={(e) => setMenu({ pos: { left: e.clientX, top: e.clientY }, row: r })}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setOpen(menu!.row);
            setMenu(null);
          }}
        >
          Details
        </MenuItem>
        {menu && !menu.row.canUndo && (
          <MenuItem
            onClick={() => {
              setAssign(menu!.row);
              setMenu(null);
            }}
          >
            Assign to order / shipment…
          </MenuItem>
        )}
        {menu && !menu.row.canUndo && (
          <MenuItem
            onClick={() => {
              const r = menu!.row;
              setMenu(null);
              void run(r, "retriage");
            }}
          >
            Triage again
          </MenuItem>
        )}
        {menu && !menu.row.canUndo && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              setConfirm({ row: menu!.row, act: "dismiss" });
              setMenu(null);
            }}
          >
            Not shipment mail — delete
          </MenuItem>
        )}
      </Menu>

      <Dialog open={!!open} onClose={() => setOpen(null)} maxWidth="md" fullWidth>
        <DialogTitle>{open?.subject || "(no subject)"}</DialogTitle>
        <DialogContent dividers>
          {open && (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                {open.direction === "OUT" ? "Sent" : "Received"} · {open.counterparty} · {open.from} · {fmtDateTime(open.date)}
              </Typography>
              {open.error && <Alert severity="warning">AI triage: {open.error}</Alert>}
              <Box>
                <Typography variant="overline" color="text.secondary">
                  Keys found
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {Object.entries(open.keys ?? {})
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <Chip key={k} size="small" variant="outlined" label={`${k}: ${v}`} />
                    ))}
                  {!Object.values(open.keys ?? {}).some(Boolean) && <Typography variant="body2">None</Typography>}
                </Stack>
              </Box>
              <Box>
                <Typography variant="overline" color="text.secondary">
                  Attachments
                </Typography>
                {open.attachments.map((a) => (
                  <Typography key={a.index} variant="body2">
                    {a.name} {a.docType ? <Chip size="small" label={a.docType} sx={{ ml: 1 }} /> : null}
                  </Typography>
                ))}
                {!open.attachments.length && <Typography variant="body2">None</Typography>}
              </Box>
              <Box>
                <Typography variant="overline" color="text.secondary">
                  {open.done.length ? "Done" : "Planned"} {open.matched ? `on ${open.matched}` : ""}
                </Typography>
                {(open.done.length ? open.done : open.planned).map((a, i) => (
                  <Typography key={i} variant="body2" color={a.status === "skipped" ? "text.secondary" : undefined}>
                    • {actionText(a)}
                  </Typography>
                ))}
                {!(open.done.length ? open.done : open.planned).length && <Typography variant="body2">Nothing to do for this email.</Typography>}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <AssignDialog
        row={assign}
        onClose={() => setAssign(null)}
        onAssigned={async () => {
          setAssign(null);
          await q.refetch();
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.act === "undo" ? "Undo what this email did?" : "Delete this email (not shipment mail)?"}
        body={
          confirm?.act === "undo"
            ? "Its files are removed (steps they completed are reopened), the fields it filled are cleared and its sub-tasks unticked. The email goes back to Suggested."
            : "The stored email and its attachments are deleted; only a fingerprint of its Message-ID is kept so it isn't stored again."
        }
        confirmLabel={confirm?.act === "undo" ? "Undo" : "Delete"}
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => run(confirm!.row, confirm!.act)}
      />
    </Box>
  );
}

function AssignDialog({ row, onClose, onAssigned }: { row: InboxRow | null; onClose: () => void; onAssigned: () => void }) {
  const orders = useOrders({ bucket: "pending", pageSize: 100 }, !!row);
  const ships = useShipments({ status: "OPEN", pageSize: 100 }, !!row);
  const options = useMemo(
    () => [
      ...(ships.data?.items ?? []).map((s) => ({ kind: "shipment" as const, id: s.id, label: `${s.ref || "Shipment"} · B/L ${s.blNumber || "pending"}${s.customerName ? ` · ${s.customerName}` : ""}` })),
      ...(orders.data?.items ?? []).map((o) => ({ kind: "order" as const, id: o.id, label: `Order ${o.label} · ${o.customerName ?? ""} · ${o.productLabel}` })),
    ],
    [orders.data, ships.data],
  );
  const [pick, setPick] = useState<(typeof options)[number] | null>(null);
  const save = useTradeMutation((a, v: { id: string; body: { orderId?: string; shipmentId?: string } }) => a.inboxAssign(v.id, v.body));
  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Assign “{row?.subject ?? ""}”</DialogTitle>
      <DialogContent dividers>
        <Autocomplete
          options={options}
          value={pick}
          onChange={(_, v) => setPick(v)}
          groupBy={(o) => (o.kind === "shipment" ? "Shipments" : "Orders")}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(p) => <TextField {...p} label="Order or shipment" size="small" />}
        />
        <Typography variant="caption" color="text.secondary">
          Its documents are then filed there (in AUTO mode right away; otherwise as a suggestion to accept).
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!pick || save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({ id: row!.id, body: pick!.kind === "shipment" ? { shipmentId: pick!.id } : { orderId: pick!.id } });
              toast.success("Assigned");
              onAssigned();
            } catch (e: any) {
              toast.error(e?.message || "Could not assign");
            }
          }}
        >
          Assign
        </Button>
      </DialogActions>
    </Dialog>
  );
}
