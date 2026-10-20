/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Shipments → Inbox: the emails the intake address received, after AI
// triage. Not-shipment mail is purged at triage and never shows here.
//   Suggested  — matched and planned, waiting for Accept (TRIAGE mode)
//   Unmatched  — no (or several) orders / shipments fit: assign one by hand
//   Processed  — done (AUTO, or accepted); every action can be undone
//   Unsure     — the AI couldn't tell; kept 14 days for review, then purged
//   Filter preview — what the sender filter (SHADOW) kept / would drop, from-domain + subject only
// Row click opens the details (keys found, planned / done actions); actions
// are in the row's ⋮ menu.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CallReceivedIcon from "@mui/icons-material/CallReceived";
import CallMadeIcon from "@mui/icons-material/CallMade";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type FilterPreview, type InboxRow, type InboxTab } from "../_lib/api";
import { useOrders, useShipments, useTradeMutation } from "../_lib/hooks";
import { fmtDateTime } from "../_lib/format";
import { toast } from "../_lib/toast";
import { ConfirmDialog } from "../_components/bits";
import { acceptedText } from "../_lib/inbox-text";

const TABS: Array<{ value: InboxTab; label: string }> = [
  { value: "SUGGESTED", label: "Suggested" },
  { value: "UNMATCHED", label: "Unmatched" },
  { value: "PROCESSED", label: "Processed" },
  { value: "UNSURE", label: "Unsure" },
];

const actionText = (a: InboxRow["planned"][number]) =>
  a.kind === "file"
    ? `${a.status === "done" ? "Filed" : a.status === "undone" ? "Removed" : a.status === "skipped" ? "Skip" : "File"} ${a.filename ?? ""}${a.docType ? ` as ${a.docType}` : ""}${a.ownerKind ? ` on the ${a.ownerKind === "supplierOrder" ? "supplier order (old)" : a.ownerKind}` : ""}${a.reason ? ` — ${a.reason}` : ""}`
    : a.kind === "field"
      ? `${a.status === "done" ? "Filled" : "Fill"} ${a.field} = ${a.value}${a.reason ? ` — ${a.reason}` : ""}`
      : `${a.status === "done" ? "Ticked" : "Tick"} ${a.label ?? "sent"}${a.reason ? ` — ${a.reason}` : ""}`;

export default function InboxPage() {
  const api = useShipmentsApi();
  const [tab, setTab] = useState<InboxTab | "FILTER">("SUGGESTED");
  const listTab: InboxTab = tab === "FILTER" ? "SUGGESTED" : tab;
  const q = useQuery({ queryKey: ["trade-inbox", listTab], queryFn: () => api.inbox(listTab), refetchInterval: 30000 });
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: InboxRow } | null>(null);
  const [open, setOpen] = useState<InboxRow | null>(null);
  const [assign, setAssign] = useState<InboxRow | null>(null);
  const [confirm, setConfirm] = useState<{ row: InboxRow; act: "undo" | "dismiss" } | null>(null);
  const act = useTradeMutation((a, v: { id: string; act: "accept" | "undo" | "dismiss" | "retriage" | "ignore" }): Promise<unknown> =>
    v.act === "accept" ? a.inboxAccept(v.id) : v.act === "undo" ? a.inboxUndo(v.id) : v.act === "dismiss" ? a.inboxDismiss(v.id) : v.act === "ignore" ? a.inboxIgnore(v.id) : a.inboxRetriage(v.id),
  );
  const stats = useQuery({ queryKey: ["trade-inbox", "stats"], queryFn: () => api.inboxStats(30), staleTime: 60_000 });
  // The tab label carries the filter's real counts (round M) — same query as the tab itself.
  const preview = useQuery({ queryKey: ["trade-inbox", "filter-preview"], queryFn: () => api.inboxFilterPreview(30), staleTime: 60_000 });
  const run = async (row: InboxRow, what: "accept" | "undo" | "dismiss" | "retriage" | "ignore") => {
    try {
      const res = (await act.mutateAsync({ id: row.id, act: what })) as InboxRow | undefined;
      toast.success(
        what === "accept" ? acceptedText(res ?? row) : what === "undo" ? "Undone — back to Suggested" : what === "dismiss" ? "Removed (not shipment mail)" : what === "ignore" ? "Ignored — kept, nothing filed" : "Triaged again",
      );
      await Promise.all([q.refetch(), stats.refetch()]);
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
      {stats.data && (stats.data.reviewed > 0 || stats.data.AUTO > 0) && (
        // How we decide when to widen auto: accepted as suggested vs changed / rejected, and what applied by itself.
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }} data-tour="inbox-accept-rate">
          Last {stats.data.days} days: {stats.data.acceptedAsIsPct ?? "—"}% accepted as-is · auto {stats.data.AUTO} · changed {stats.data.CHANGED} · rejected {stats.data.REJECTED}
        </Typography>
      )}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} variant="scrollable" allowScrollButtonsMobile data-tour="inbox-tabs">
        {TABS.map((t) => (
          <Tab key={t.value} value={t.value} label={`${t.label}${counts ? ` (${counts[t.value] ?? 0})` : ""}`} sx={{ textTransform: "none" }} />
        ))}
        <Tab
          value="FILTER"
          label={`Filter preview${preview.data ? ` (kept ${preview.data.kept} · would drop ${preview.data.dropped})` : ""}`}
          sx={{ textTransform: "none" }}
          data-tour="inbox-filter-preview"
        />
      </Tabs>
      {tab === "FILTER" ? (
        <FilterPreviewTab />
      ) : q.isError ? (
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
                    <TableCell>
                      {r.review?.outcome === "AUTO" && r.autoLabel ? (
                        <Chip size="small" color="success" variant="outlined" label={`Auto · ${r.autoLabel}`} title={r.matched ?? ""} sx={{ mr: 0.5 }} data-tour="inbox-auto" />
                      ) : null}
                      {r.matched ? (
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={`${r.matched}${r.confidence === "thread" ? " · thread" : r.confidence === "cues" ? " · subject only" : r.matchedBy && r.matchedBy !== "manual" ? ` · ${r.matchedBy}` : ""}`}
                          title={(r.blocked ?? []).join("\n")}
                        />
                      ) : (r.multiOrderIds?.length ?? 0) > 1 ? (
                        <Chip size="small" color="warning" variant="outlined" label={`${r.multiOrderIds!.length} orders — pick`} />
                      ) : (
                        "—"
                      )}
                      {!!r.check?.length && (
                        <Chip size="small" color="warning" variant="outlined" label="check" title={`The subject disagrees with this match: ${r.check.join("; ")}`} sx={{ ml: 0.5 }} data-tour="inbox-check" />
                      )}
                    </TableCell>
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
                      {!r.canUndo && r.inboxState !== "PROCESSED" && (
                        <Button size="small" onClick={() => setAssign(r)} data-tour="inbox-change-order">
                          Change order…
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
            Change order…
          </MenuItem>
        )}
        {menu && !menu.row.canUndo && menu.row.inboxState !== "PROCESSED" && (
          <MenuItem
            onClick={() => {
              const r = menu!.row;
              setMenu(null);
              void run(r, "ignore");
            }}
          >
            Ignore (keep, file nothing)
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
            Not a shipment — delete
          </MenuItem>
        )}
      </Menu>

      {/* Round N: no exit transition — the closing dialog's invisible container covered the rows for ~225 ms and ate
          the next click (the row's Accept needed a second click). No focus restore either. */}
      <Dialog open={!!open} onClose={() => setOpen(null)} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus>
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
              {!!open.check?.length && (
                <Alert severity="warning">
                  Check this match: the subject says {open.check.join("; ")}. Re-assign it to the right order / shipment if needed.
                </Alert>
              )}
              {(open.supplierOrderSuggestions ?? []).length > 0 && <PiTablePanel row={open} onApplied={setOpen} />}
            </Stack>
          )}
        </DialogContent>
        <DialogActions data-tour="inbox-dialog-actions">
          {/* Round N: the row's actions in the dialog too. Each closes the dialog first, then acts. */}
          {open && !open.canUndo && (
            <Button
              color="error"
              onClick={() => {
                const r = open;
                setOpen(null);
                setConfirm({ row: r, act: "dismiss" });
              }}
              sx={{ mr: "auto" }}
            >
              Not a shipment
            </Button>
          )}
          <Button onClick={() => setOpen(null)}>Close</Button>
          {open && !open.canUndo && open.inboxState !== "PROCESSED" && (
            <Button
              onClick={() => {
                const r = open;
                setOpen(null);
                setAssign(r);
              }}
            >
              Change order…
            </Button>
          )}
          {open?.inboxState === "SUGGESTED" && (
            <Button
              variant="contained"
              disabled={act.isPending}
              onClick={() => {
                const r = open;
                setOpen(null);
                void run(r, "accept");
              }}
            >
              Accept
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <PickerDialog
        row={assign}
        onClose={() => setAssign(null)}
        onDone={async () => {
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

/**
 * "Change order…": the top 3 candidates first (with why), then search every order / shipment (#n-seq · customer ·
 * B/L · product · qty · ETA). Pick one — or several for an email about more than one shipment, each attachment then
 * assigned to one of them. The preview shows what would be filed and filled; Accept does it.
 */
function PickerDialog({ row, onClose, onDone }: { row: InboxRow | null; onClose: () => void; onDone: () => void }) {
  const api = useShipmentsApi();
  const orders = useOrders({ pageSize: 100 }, !!row);
  const ships = useShipments({ pageSize: 100 }, !!row);
  type Opt = { key: string; orderId: string; shipmentId: string | null; label: string; group: string };
  const options: Opt[] = useMemo(() => {
    const out: Opt[] = [];
    for (const s of ships.data?.items ?? []) {
      if (s.status === "CANCELLED" || !s.orderId) continue;
      out.push({
        key: `s:${s.id}`,
        orderId: s.orderId,
        shipmentId: s.id,
        group: "Shipments",
        label: [s.ref || "Shipment", s.customerName, s.blNumber ? `B/L ${s.blNumber}` : "B/L pending", s.productLine, s.eta ? `ETA ${fmtDateTime(s.eta).slice(0, 10)}` : null].filter(Boolean).join(" · "),
      });
    }
    for (const o of orders.data?.items ?? []) if (!o.shipmentCount) out.push({ key: `o:${o.id}`, orderId: o.id, shipmentId: null, group: "Orders without a shipment", label: [o.label, o.customerName, o.productLabel].filter(Boolean).join(" · ") });
    return out;
  }, [orders.data, ships.data]);
  const optOf = (orderId: string, shipmentId: string | null) => options.find((o) => o.orderId === orderId && o.shipmentId === shipmentId) ?? options.find((o) => o.orderId === orderId);
  const [picked, setPicked] = useState<Opt[]>([]);
  const [assignOf, setAssignOf] = useState<Record<number, string>>({});
  const [plan, setPlan] = useState<InboxRow["planned"] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!row) return;
    setPicked([]);
    setAssignOf({});
    setPlan(null);
  }, [row]);
  // Each attachment goes to one picked shipment (default: the first).
  const body = picked.map((p) => ({
    orderId: p.orderId,
    shipmentId: p.shipmentId,
    ...(picked.length > 1 && row ? { attachmentIndexes: row.attachments.map((a) => a.index).filter((i) => (assignOf[i] ?? picked[0].key) === p.key) } : {}),
  }));
  const sig = JSON.stringify(body);
  useEffect(() => {
    if (!row || !picked.length) return setPlan(null);
    let live = true;
    api
      .inboxPreview(row.id, body)
      .then((r) => live && setPlan(r.planned))
      .catch(() => live && setPlan(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, sig]);
  const save = async (accept: boolean) => {
    setBusy(true);
    try {
      await api.inboxAssign(row!.id, { targets: body, accept });
      toast.success(accept ? "Done — documents filed" : "Order changed — review and accept");
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "Could not change the order");
    } finally {
      setBusy(false);
    }
  };
  const cands = (row?.candidates ?? []).filter((c) => optOf(c.orderId, c.shipmentId));
  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus>
      <DialogTitle>Change order — “{row?.subject ?? ""}”</DialogTitle>
      <DialogContent dividers data-tour="inbox-picker">
        <Stack spacing={2}>
          {cands.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Best matches
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {cands.map((c) => {
                  const o = optOf(c.orderId, c.shipmentId)!;
                  const on = picked.some((p) => p.key === o.key);
                  return (
                    <Chip
                      key={o.key}
                      color={on ? "primary" : "default"}
                      variant={on ? "filled" : "outlined"}
                      label={`${c.ref}${c.reasons.length ? ` — ${c.reasons.join(", ")}` : ""}`}
                      onClick={() => setPicked((ps) => (on ? ps.filter((p) => p.key !== o.key) : [...ps, o]))}
                    />
                  );
                })}
              </Stack>
            </Box>
          )}
          <Autocomplete
            multiple
            options={options}
            value={picked}
            onChange={(_, v) => setPicked(v)}
            groupBy={(o) => o.group}
            getOptionLabel={(o) => o.label}
            isOptionEqualToValue={(a, b) => a.key === b.key}
            filterSelectedOptions
            renderInput={(p) => <TextField {...p} label="Order / shipment (search #, customer, B/L, product)" size="small" />}
          />
          {picked.length > 1 && row && row.attachments.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Which shipment each attachment goes to
              </Typography>
              {row.attachments.map((a) => (
                <Stack key={a.index} direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="body2" sx={{ flex: 1, wordBreak: "break-all" }}>
                    {a.name}
                  </Typography>
                  <TextField select size="small" value={assignOf[a.index] ?? picked[0].key} onChange={(e) => setAssignOf((m) => ({ ...m, [a.index]: e.target.value }))} sx={{ minWidth: 200 }}>
                    {picked.map((p) => (
                      <MenuItem key={p.key} value={p.key}>
                        {p.label.split(" · ")[0]}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              ))}
            </Box>
          )}
          {picked.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Preview
              </Typography>
              {!plan ? (
                <CircularProgress size={18} />
              ) : !plan.length ? (
                <Typography variant="body2">Nothing to file or fill for this choice.</Typography>
              ) : (
                plan.map((a, k) => (
                  <Typography key={k} variant="body2" color={a.status === "skipped" ? "text.secondary" : undefined}>
                    • {actionText(a)}
                    {a.kind === "file" && a.ownerId ? ` → ${options.find((o) => o.shipmentId === a.ownerId || (o.orderId === a.ownerId && !o.shipmentId))?.label.split(" · ")[0] ?? ""}` : ""}
                  </Typography>
                ))
              )}
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={!picked.length || busy} onClick={() => void save(false)}>
          Save as suggestion
        </Button>
        <Button variant="contained" disabled={!picked.length || busy} onClick={() => void save(true)}>
          Accept
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Vedanta's PI table: the month's order each row fills (PI no., PI amount — blanks only), then "Apply". */
function PiTablePanel({ row, onApplied }: { row: InboxRow; onApplied: (r: InboxRow) => void }) {
  const api = useShipmentsApi();
  const plan = useQuery({ queryKey: ["trade-orders", "pi-table", row.id, (row.supplierOrderResults ?? []).length], queryFn: () => api.inboxPiTable(row.id) });
  const [busy, setBusy] = useState(false);
  const fieldText = (f: Record<string, string | number>) =>
    Object.entries(f)
      .map(([k, v]) => (k === "piNo" ? `PI no. ${v}` : k === "piAmount" ? `PI amount ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : `${k} ${v}`))
      .join(", ");
  return (
    <Box data-tour="inbox-pi-table">
      <Typography variant="overline" color="text.secondary">
        Vedanta&apos;s PI table → the month&apos;s orders
      </Typography>
      {plan.isLoading ? (
        <CircularProgress size={18} />
      ) : (
        (plan.data?.rows ?? []).map((p, i) => (
          <Typography key={i} variant="body2">
            • {p.row.grade ?? "—"} · {p.row.contractNo} · {p.row.qtyMt ?? "—"} MT · PI {p.row.piNo ?? "—"} →{" "}
            {p.orderLabel ? (
              <b>
                {p.orderLabel}
                {Object.keys(p.fields).length ? `: fill ${fieldText(p.fields)}` : " (already filled)"}
              </b>
            ) : (
              <span style={{ opacity: 0.7 }}>{p.reason}</span>
            )}
          </Typography>
        ))
      )}
      {(row.supplierOrderResults ?? []).map((r, i) => (
        <Typography key={`r${i}`} variant="caption" color="text.secondary" component="div">
          {r.contractNo} {r.piNo ? `PI ${r.piNo}` : ""}
          {r.orderLabel ? ` → ${r.orderLabel}` : ""}: {r.action}
          {r.reason ? ` (${r.reason})` : ""}
        </Typography>
      ))}
      <Button
        size="small"
        variant="outlined"
        sx={{ mt: 1 }}
        disabled={busy || !(plan.data?.rows ?? []).some((p) => p.orderId && Object.keys(p.fields).length)}
        onClick={async () => {
          setBusy(true);
          try {
            const out = await api.inboxApplyPiTable(row.id);
            onApplied(out.row);
            toast.success(`PI table: ${out.results.map((r) => `${r.orderLabel ?? r.contractNo} ${r.action}`).join(", ")}`);
            await plan.refetch();
          } catch (e: any) {
            toast.error(e?.message || "Could not apply");
          } finally {
            setBusy(false);
          }
        }}
      >
        Fill the PI fields on these orders
      </Button>
    </Box>
  );
}

/** What the sender filter kept / would drop (SHADOW): from-domain + subject (60) only — never bodies or addresses. */
function FilterPreviewTab() {
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
          <Table size="small" data-tour="inbox-filter-table">
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
                    <Typography variant="body2" noWrap title={r.subject}>
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
