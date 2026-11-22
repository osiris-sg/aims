"use client";

// Link Document (WCT group, 2026-11-22; rules in helpers/linkDoc.ts, API api-server-production/src/orders/doc-links*.ts).
//  - LinkDocumentField: the editor row. Pills for the order / documents this one is linked to (each opens it, x unlinks
//    after a confirm) and a "Link Document" button that opens the picker.
//  - LinkDocumentDialog: the big picker (shared PickerDialog, the Stock Card look): tabs Order, QO, DO, Invoice minus
//    the page's own type; the document's customer first; a row click links.
//  - DocChainPanel: the left panel under Stock Card / Debtor Statement: the order's Order, QO, DO(s), Invoice(s) as
//    pills, "+ Create DO" / "+ Create invoice" where the order has none (the order page's own create calls), or, with
//    no order, the direct links and a Link Document shortcut.
// The three share one "changed" event so a link made in one refreshes the others.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import LinkIcon from "@mui/icons-material/Link";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { requestFailed } from "@/helpers/requestOutcome";
import PickerDialog, { type PickerColumn } from "@/components/PickerDialog";
import { chainSections, linkPills, linkedToastText, pickDate, pickMoney, pickerPath, pickerTabs, statusWords, unlinkConfirmText, type DocChain, type DocLinks, type LinkPill, type PageKind, type PickKind, type PickRow } from "@/helpers/linkDoc";

const CHANGED = "aims:doc-links-changed";
const announce = (documentId: string) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: { documentId } }));

function useApi() {
  const { getToken } = useAuth();
  return useCallback(
    async (method: "GET" | "POST", path: string, body?: any) => {
      const token = await getToken();
      const res: any = await request({ path, method, ownError: true }, body ?? (method === "POST" ? {} : undefined), token ?? undefined);
      if (requestFailed(res) || res?.success === false) throw new Error(res?.message || "Couldn't do that");
      return res?.data ?? res;
    },
    [getToken],
  );
}

/** Re-read when this document's links change (here or in the other panel). */
function useLinksVersion(documentId: string | null) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail?.documentId === documentId) setV((x) => x + 1);
    };
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, [documentId]);
  return v;
}

export interface LinkResult {
  mode?: "order" | "direct";
  orderNumber?: string | null;
  /** The Reference text the server wrote on a draft (a quotation picked from an invoice / DO), else null. */
  reference?: string | null;
  /** The customer the server set on a draft that had none. */
  customer?: { id: string; name: string; address?: string | null; email?: string | null; customerCode?: string | null; gstRegNo?: string | null } | null;
}

export function LinkDocumentDialog({ open, onClose, documentId, page, onLinked }: { open: boolean; onClose: () => void; documentId: string; page: PageKind; onLinked?: (out: LinkResult) => void }) {
  const api = useApi();
  const tabs = useMemo(() => pickerTabs(page), [page]);
  const [tab, setTab] = useState<PickKind>(tabs[0].value);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PickRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTab(tabs[0].value);
      setSearch("");
      setError("");
    }
  }, [open, tabs]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const out = await api("GET", pickerPath(documentId, tab, search));
        if (live) {
          setRows(Array.isArray(out?.rows) ? out.rows : []);
          setError("");
        }
      } catch (e: any) {
        if (live) {
          setRows([]);
          setError(e?.message || "Couldn't search");
        }
      } finally {
        if (live) setLoading(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, tab, search, documentId, api]);

  const pick = async (row: PickRow) => {
    setBusy(true);
    try {
      const out = await api("POST", "/order-refs/link-document", { documentId, kind: row.kind, id: row.id });
      toast.success(linkedToastText(out));
      onLinked?.(out);
      announce(documentId);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't link it");
    } finally {
      setBusy(false);
    }
  };

  const columns: PickerColumn<PickRow>[] = [
    { key: "no", header: tab === "ORDER" ? "Order No." : "Doc No.", width: "15%", render: (r) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.number || "Draft"}</Typography> },
    { key: "cust", header: "Customer", width: "24%", render: (r) => r.customer || "" },
    { key: "date", header: "Date", width: "10%", render: (r) => pickDate(r.date) },
    { key: "subj", header: "Subject", width: "27%", render: (r) => r.subject || "" },
    { key: "total", header: "Total", width: "12%", align: "right", render: (r) => <span className="tabular-nums">{pickMoney(r.total)}</span> },
    { key: "status", header: "Status", width: "12%", render: (r) => statusWords(r.status) },
  ];
  return (
    <PickerDialog<PickRow>
      open={open}
      onClose={onClose}
      title="Link Document"
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search by number, customer or subject"
      tabs={tabs}
      tab={tab}
      onTab={(v) => setTab(v as PickKind)}
      columns={columns}
      rows={rows}
      rowKey={(r) => `${r.kind}:${r.id}`}
      onPick={(r) => void pick(r)}
      loading={loading}
      busy={busy}
      emptyText={search ? "Nothing matches" : "Nothing to link"}
      note={error ? <Typography variant="body2" color="error">{error}</Typography> : undefined}
      data-tour="link-document-picker"
    />
  );
}

/** The pill: opens its document; x (with a confirm) unlinks. */
function Pill({ pill, onOpen, onUnlink, disabled }: { pill: LinkPill; onOpen: () => void; onUnlink?: () => void; disabled?: boolean }) {
  return (
    <Chip
      size="small"
      color="primary"
      variant="outlined"
      icon={<LinkIcon fontSize="small" />}
      label={pill.label}
      onClick={pill.href ? onOpen : undefined}
      onDelete={onUnlink && !disabled ? onUnlink : undefined}
      sx={{ fontWeight: 600, cursor: pill.href ? "pointer" : "default" }}
    />
  );
}

export function LinkDocumentField({
  documentId,
  docName,
  page,
  onLinked,
  onUnlinked,
  offerFill = false,
  onFill,
  sx,
}: {
  documentId: string | null;
  docName: string | null;
  page: PageKind;
  onLinked?: (out: LinkResult) => void;
  onUnlinked?: (out: { orderNumber?: string | null; clearedReference?: boolean }) => void;
  /** An invoice draft with no line yet: "Fill remaining lines" once it is on an order (kept from the old Reference field). */
  offerFill?: boolean;
  onFill?: (lines: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>) => void;
  sx?: any;
}) {
  const api = useApi();
  const router = useRouter();
  const version = useLinksVersion(documentId);
  const [links, setLinks] = useState<DocLinks | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<LinkPill | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!documentId) return void setLinks(null);
    let live = true;
    setLoading(true);
    api("GET", `/order-refs/links/${documentId}`)
      .then((out) => live && setLinks(out))
      .catch(() => live && setLinks(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [documentId, version, api]);
  const pills = linkPills(links);
  const fill = async () => {
    if (!links?.order || !onFill) return;
    setBusy(true);
    try {
      const out = await api("GET", `/order-refs/remaining-lines/${links.order.id}`);
      const lines = Array.isArray(out?.lines) ? out.lines : [];
      if (!lines.length) toast.info(`Nothing left to bill on ${links.order.orderNumber}`);
      else onFill(lines);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't read the lines");
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (p: LinkPill) => {
    if (!documentId || !p.unlink) return;
    setBusy(true);
    try {
      const out = await api("POST", "/order-refs/unlink-document", { documentId, kind: p.unlink.kind, id: p.unlink.id });
      toast.success(`Unlinked ${p.label}`);
      onUnlinked?.(out);
      announce(documentId);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't unlink it");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", flex: 1, minHeight: 32, ...(sx || {}) }} data-tour="link-document-row">
      {pills.map((p) => (
        <Pill key={p.key} pill={p} onOpen={() => p.href && router.push(p.href)} onUnlink={p.unlink ? () => setConfirm(p) : undefined} disabled={busy} />
      ))}
      {loading && <CircularProgress size={14} />}
      {offerFill && onFill && links?.order && (
        <Button size="small" onClick={() => void fill()} disabled={busy} sx={{ textTransform: "none" }} data-tour="doc-order-ref-fill">
          Fill remaining lines
        </Button>
      )}
      {documentId ? (
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setOpen(true)} sx={{ textTransform: "none" }} data-tour="link-document-open">
          Link Document
        </Button>
      ) : (
        <Tooltip title="Save the document first">
          <span>
            <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled sx={{ textTransform: "none" }}>
              Link Document
            </Button>
          </span>
        </Tooltip>
      )}
      {documentId && <LinkDocumentDialog open={open} onClose={() => setOpen(false)} documentId={documentId} page={page} onLinked={onLinked} />}
      <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)}>
        <DialogTitle>Unlink</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirm ? unlinkConfirmText(confirm, docName) : ""}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={busy}>
            Cancel
          </Button>
          <Button color="error" variant="contained" disableElevation onClick={() => confirm && void unlink(confirm)} disabled={busy}>
            Unlink
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** The left panel: the order's chain (or the direct links), like the old ERP's side list. */
export function DocChainPanel({ documentId, page, onLinked }: { documentId: string | null; page: PageKind; onLinked?: (out: LinkResult) => void }) {
  const api = useApi();
  const router = useRouter();
  const version = useLinksVersion(documentId);
  const [chain, setChain] = useState<DocChain | null>(null);
  const [busy, setBusy] = useState<"do" | "invoice" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (!documentId) return void setChain(null);
    let live = true;
    api("GET", `/order-refs/chain/${documentId}`)
      .then((out) => live && setChain(out))
      .catch(() => live && setChain(null));
    return () => {
      live = false;
    };
  }, [documentId, version, api]);
  const sections = chainSections(chain);
  // "+ Create DO" / "+ Create invoice": the order page's own calls (POST /deliveries/order/:id/dos, /orders/:id/invoice-now).
  const create = async (what: "do" | "invoice") => {
    if (!chain?.order) return;
    setBusy(what);
    try {
      const out: any = what === "do" ? await api("POST", `/deliveries/order/${chain.order.id}/dos`) : await api("POST", `/orders/${chain.order.id}/invoice-now`);
      if (what === "invoice" && out?.covered) toast.info(`No new invoice: ${out?.name || "the order's invoice"} already covers it`);
      else if (out?.existing) toast.info(`${out?.name || "The invoice"} is already on ${chain.order.orderNumber}`);
      else toast.success(what === "do" ? `${out?.doName || "A draft DO"} made on ${chain.order.orderNumber}` : `${out?.name || "A draft invoice"} made on ${chain.order.orderNumber}`);
      if (documentId) announce(documentId);
      if (out?.href) router.push(out.href);
    } catch (e: any) {
      toast.error(e?.message || (what === "do" ? "Couldn't make the DO" : "Couldn't make the invoice"));
    } finally {
      setBusy(null);
    }
  };
  if (!documentId) return null;
  return (
    <Box sx={{ width: 172, mt: 1.5, p: 1.25, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }} data-tour="doc-chain-panel">
      {sections.length ? (
        <Stack spacing={1}>
          {sections.map((s) => (
            <Box key={s.key}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: "block", mb: 0.25 }}>
                {s.label}
              </Typography>
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                {s.items.map((i) => (
                  <Chip
                    key={i.id}
                    size="small"
                    label={i.name}
                    color={i.id === documentId ? "primary" : "default"}
                    variant={i.id === documentId ? "filled" : "outlined"}
                    onClick={i.href && i.id !== documentId ? () => router.push(i.href!) : undefined}
                    sx={{ maxWidth: "100%", fontWeight: 600 }}
                  />
                ))}
                {!s.items.length && !s.create && (
                  <Typography variant="body2" color="text.secondary">
                    None yet
                  </Typography>
                )}
                {s.create && (
                  <Button size="small" startIcon={busy === s.create ? <CircularProgress size={12} /> : <AddIcon />} disabled={!!busy} onClick={() => void create(s.create!)} sx={{ textTransform: "none", px: 0.5, minWidth: 0 }} data-tour={`doc-chain-create-${s.create}`}>
                    {s.create === "do" ? "Create DO" : "Create invoice"}
                  </Button>
                )}
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            Linked
          </Typography>
          {chain?.direct?.length ? (
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
              {chain.direct.map((d) => (
                <Chip key={d.id} size="small" variant="outlined" label={d.name || "Document"} onClick={d.href ? () => router.push(d.href!) : undefined} sx={{ fontWeight: 600 }} />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No order linked
            </Typography>
          )}
          <Button size="small" variant="outlined" startIcon={<LinkIcon />} onClick={() => setPickerOpen(true)} sx={{ textTransform: "none" }} data-tour="doc-chain-link-document">
            Link Document
          </Button>
          <LinkDocumentDialog open={pickerOpen} onClose={() => setPickerOpen(false)} documentId={documentId} page={page} onLinked={onLinked} />
        </Stack>
      )}
    </Box>
  );
}
