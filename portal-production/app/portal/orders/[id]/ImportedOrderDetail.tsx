"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import NextLink from "next/link";
import { useAuth } from "@clerk/nextjs";
import moment from "moment";
import { toast } from "react-toastify";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  Link,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import PendingOutlinedIcon from "@mui/icons-material/PendingOutlined";
import MainCard from "@/components/MainCard";
import StatusPill from "../_components/StatusPill";
import { trackerCardClick } from "@/helpers/importedOrders";
import {
  IMPORTED_LINK_TYPES,
  importedBilledPct,
  importedDocRows,
  importedMoney,
  importedProgress,
  importedStatusHue,
  importedSteps,
  invoiceDialogLines,
  linkOptionState,
  type ImportedDocRow,
  type ImportedLinkType,
  type ImportedOrder,
  type LinkOption,
} from "@/helpers/importedOrders";
import { request } from "@/helpers/request";
import { requestFailed } from "@/helpers/requestOutcome";
import { publicFileUrl, uploadFile } from "@/helpers/fileUploader";
import { ORDER_FILE_ACCEPT, orderUploadTip, serviceReportFlowHref, serviceReportMenuItems, type ServiceReportPrefill } from "@/helpers/serviceReportFlow";
import { addJobPrefill } from "@/helpers/wctOrders";
import { linkedToast } from "@/helpers/quickJobQuotation";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import ScheduleDeliveryDialog from "@/app/portal/deliveries/_components/ScheduleDeliveryDialog";
import QuickJobDialog from "@/components/Dashboard/jobs-calendar/QuickJobDialog";
import OfficeCompleteJobDialog from "@/components/delivery/OfficeCompleteJobDialog";
import CustomerSignLink from "@/components/delivery/CustomerSignLink";
import SendServiceReportDialog from "@/components/orders/SendServiceReportDialog";
import { OrderDoMenu, useAddDo, type OrderDo } from "./OrderDosSection";

/**
 * An order imported from the old ERP (enableImportedOrders). Its quotation, imported invoices and ERP DOs stay
 * read-only. 2026-11-19: Create invoice (a normal AIMS draft invoice, number and lines editable), Mark complete /
 * Reopen. Round 19 (2026-11-19): open for backfilling like an AIMS order: Add DO, Add job, Service report, Send
 * service report, Create invoice on any status, Link existing document and Unlink. Menus open at the click.
 */
export default function ImportedOrderDetail({ order, onBack, onChanged }: { order: ImportedOrder; onBack: () => void; onChanged?: () => void }) {
  const q = order.sourceQuotation;
  const router = useRouter();
  const { getToken } = useAuth();
  const { isJobsCalendarEnabled } = useOrganizationFeatures();
  const manualFlow = !!order.manualFlow;
  const reload = () => onChanged?.();
  const [busy, setBusy] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  // Failures show the portal's error toast; nothing here says "done" unless the call succeeded.
  const post = async (action: string, body: any = {}) => {
    setBusy(action);
    try {
      const token = await getToken();
      return await request({ path: `/orders/${order.id}/${action}`, method: "POST" }, body, token ?? undefined);
    } finally {
      setBusy(null);
    }
  };

  // Create invoice: a dialog first: the number (prefilled, editable) and the lines (editable, add / remove).
  const [invOpen, setInvOpen] = useState(false);
  const [invNumber, setInvNumber] = useState("");
  const [invLines, setInvLines] = useState<Array<{ description: string; quantity: string; unitPrice: string; priced: boolean }>>([]);
  const openInvoiceDialog = () => {
    setInvNumber(order.suggestedInvoiceNumber ?? "");
    setInvLines(invoiceDialogLines(order));
    setInvOpen(true);
  };
  const invNet = invLines.reduce((t, l) => t + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const setLine = (i: number, patch: Partial<(typeof invLines)[number]>) => setInvLines((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const createInvoice = async () => {
    const res: any = await post("invoice-remaining", {
      number: invNumber.trim() || null,
      lines: invLines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    });
    if (requestFailed(res)) return;
    setInvOpen(false);
    const href = res?.data?.href ?? res?.href;
    if (href) router.push(href);
    else reload();
  };
  const markComplete = async () => {
    const res: any = await post("mark-complete", { reason: reason.trim() });
    if (requestFailed(res)) return;
    setCompleteOpen(false);
    setReason("");
    reload();
  };
  const reopen = async () => {
    const res: any = await post("reopen");
    if (requestFailed(res)) return;
    reload();
  };

  // Link existing document (round 19): type + number search, the order's customer only.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkType, setLinkType] = useState<ImportedLinkType>("QUOTATION");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<LinkOption[] | null>(null);
  const findLinkOptions = async (type: ImportedLinkType, qText: string) => {
    setLinkResults(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/orders/${order.id}/link-options?type=${type}&q=${encodeURIComponent(qText.trim())}`, method: "GET" }, {}, token ?? undefined);
      setLinkResults(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
    } catch {
      setLinkResults([]);
    }
  };
  const openLink = (type: ImportedLinkType = "QUOTATION") => {
    setLinkType(type);
    setLinkQuery("");
    setLinkOpen(true);
    void findLinkOptions(type, "");
  };
  const linkDocument = async (o: LinkOption) => {
    const res: any = await post("link-document", { type: o.type, id: o.id });
    if (requestFailed(res)) return;
    setLinkOpen(false);
    toast.success(`${o.name ?? "Document"} linked to ${order.orderNumber}`);
    reload();
  };
  const unlink = async (u: NonNullable<ImportedDocRow["unlink"]>) => {
    if (!window.confirm(`Unlink ${u.name} from ${order.orderNumber}?`)) return;
    const res: any = await post("unlink-document", { type: u.type, id: u.id });
    if (requestFailed(res)) return;
    toast.success(`${u.name} unlinked`);
    reload();
  };

  // Native order work (round 19): Add DO, Add job, service reports, DO menu, Complete DO, sign link.
  const { addDo, adding: addingDo } = useAddDo(order.id, () => reload());
  const [jobOpen, setJobOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const prefill = useMemo(() => addJobPrefill(order as any), [order]);
  const dos: OrderDo[] = (order.deliveryOrders ?? []) as any;
  const [doMenu, setDoMenu] = useState<{ pos: { left: number; top: number }; d: OrderDo } | null>(null);
  const [completeDo, setCompleteDo] = useState<OrderDo | null>(null);
  const [signLinkDo, setSignLinkDo] = useState<OrderDo | null>(null);
  const [srMenu, setSrMenu] = useState<{ pos: { left: number; top: number } } | null>(null);
  const [sendReportOpen, setSendReportOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rowMenu, setRowMenu] = useState<{ pos: { left: number; top: number }; row: ImportedDocRow } | null>(null);
  const srPrefill = (): ServiceReportPrefill => ({
    customer: order.customer ? { id: order.customer.id, name: order.customer.name } : null,
    doId: ([...dos].reverse().find((d) => d.completed) ?? dos[0])?.id ?? (order.linkedDos ?? []).find((d) => d.id)?.id ?? null,
  });
  const uploadAttachment = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const meta = await uploadFile({ file, folder: `orders/${order.id}`, token });
      const res: any = await post("attachments", { kind: "file", fileKey: meta.fileKey, fileName: meta.fileName, mimeType: meta.mimeType });
      if (!requestFailed(res)) reload();
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const removeFile = async (row: ImportedDocRow) => {
    if (!row.attachmentId || !window.confirm(`Remove "${row.label}" from this order?`)) return;
    const res: any = await post("attachments/remove", { id: row.attachmentId });
    if (!requestFailed(res)) reload();
  };
  const canSendReport = (order.jobReports ?? []).some((r) => r.status === "completed") || (order.attachments ?? []).some((a) => a.kind === "report" && a.report?.status === "completed");
  const addJob = () => {
    if (manualFlow && isJobsCalendarEnabled && q) setJobOpen(true);
    else if (!manualFlow) setScheduleOpen(true);
  };
  const canAddJob = (manualFlow && isJobsCalendarEnabled && !!q) || !manualFlow;

  const draftHref = order.draftInvoice?.templateId ? `/portal/documents/INVOICE/${order.draftInvoice.templateId}/${order.draftInvoice.id}` : null;
  const left = (order.remaining?.lines ?? []).filter((l) => l.priced);
  const rows = importedDocRows(order);
  const openRow = (row: ImportedDocRow) => {
    if (row.href) router.push(row.href);
    else if (row.fileKey) window.open(publicFileUrl(row.fileKey), "_blank", "noopener");
  };
  const hasMenu = (row: ImportedDocRow) => !!row.unlink || !!row.attachmentId || (row.kind === "do" && !!row.doId);
  return (
    <MainCard>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton size="small" onClick={onBack} aria-label="Back to orders">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          Orders
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {order.orderNumber}
        </Typography>
        <StatusPill label={order.statusLabel || order.status} color="default" hue={importedStatusHue(order.status)} />
        <StatusPill label="Imported" color="default" variant="outlined" />
        <Tooltip title="Imported from the old ERP: its quotation and the invoices the ERP linked to it. The imported documents are read-only.">
          <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {order.canInvoice && (
          <Button variant="contained" disableElevation size="small" disabled={!!busy} onClick={openInvoiceDialog} data-tour="imported-order-create-invoice">
            Create invoice
          </Button>
        )}
        {order.draftInvoice && draftHref && (
          <Button variant="contained" disableElevation size="small" onClick={() => router.push(draftHref)}>
            Open draft invoice {order.draftInvoice.name ?? ""}
          </Button>
        )}
        {order.canComplete && (
          <Button variant="outlined" size="small" disabled={!!busy} onClick={() => setCompleteOpen(true)} data-tour="imported-order-mark-complete">
            Mark complete
          </Button>
        )}
        {order.canReopen && (
          <Button variant="outlined" size="small" disabled={!!busy} onClick={() => void reopen()}>
            Reopen
          </Button>
        )}
      </Stack>

      <Stack direction="row" spacing={3} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
        <Field label="Customer" value={order.customer?.name || ""} />
        <Field label="Order date" value={q?.date ? moment(q.date).format("DD/MM/YYYY") : moment(order.createdAt).format("DD/MM/YYYY")} />
        <Field label="Subject" value={order.subject || ""} />
        <Field label="Quotation total" value={importedMoney(order.quoteTotal ?? q?.total ?? null)} />
        <Field label="Billed" value={importedMoney(order.billed ?? order.total)} />
        <Field label="Billed %" value={importedBilledPct(order.billedPct)} />
        {(order.billingSteps?.length ? true : !!importedProgress(order.progress)) && <Field label="Billed qty" value={order.billingSteps?.length ? importedSteps(order.billingSteps) : importedProgress(order.progress)} />}
        {order.remaining && order.status === "PART_BILLED" && <Field label="Left to bill" value={importedMoney(order.remaining.remainingGross)} />}
        {order.completed && (
          <Field
            label={order.completed.auto ? "Complete (assumed closed)" : "Marked complete"}
            value={[order.completed.reason, order.completed.byName, order.completed.at ? moment(order.completed.at).format("DD/MM/YYYY") : ""].filter(Boolean).join(", ")}
          />
        )}
        {!!order.credited && <Field label="Credited" value={importedMoney(order.credited)} />}
        <Field label="Owed" value={importedMoney(order.owed)} />
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 3 }} data-tour="imported-order-tracker">
        {order.tracker.map((s) => {
          // 2026-11-19: the DO and Service report cards open their document, else their add action (like native orders).
          const click = trackerCardClick(s);
          const canClick = !!click && (!("action" in click) || click.action !== "addDo" || manualFlow);
          const onCard = (e: React.MouseEvent) => {
            if (!click || !canClick) return;
            if ("href" in click) router.push(click.href);
            else if (click.action === "addDo") void addDo();
            else setSrMenu({ pos: { left: e.clientX, top: e.clientY } });
          };
          return (
          <Box
            key={s.key}
            onClick={canClick ? onCard : undefined}
            sx={{ flex: 1, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1, opacity: s.state === "na" ? 0.7 : 1, cursor: canClick ? "pointer" : "default", "&:hover": canClick ? { bgcolor: "action.hover" } : undefined }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              {s.state === "done" ? <CheckCircleIcon fontSize="small" color="success" /> : s.state === "todo" ? <PendingOutlinedIcon fontSize="small" color="warning" /> : <RemoveCircleOutlineIcon fontSize="small" sx={{ color: "text.disabled" }} />}
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {s.label}
              </Typography>
            </Stack>
            {s.docs?.length ? (
              s.docs.map((d, i) => (
                <Typography key={i} variant="caption" color="text.secondary" component="div">
                  {d.href ? (
                    <NextLink href={d.href} onClick={(e) => e.stopPropagation()} style={{ color: "inherit", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {d.label}
                    </NextLink>
                  ) : (
                    <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
                      {d.label}
                    </Box>
                  )}
                  {d.status ? ` · ${d.status}` : ""}
                </Typography>
              ))
            ) : (
              <Typography variant="caption" color="text.secondary" component="div">
                {s.note || (s.state === "done" ? "Done" : "")}
              </Typography>
            )}
            {s.subNote && (
              <Typography variant="caption" color="text.secondary" component="div">
                {s.subNote}
              </Typography>
            )}
            {s.action === "addDo" && manualFlow && (
              <Link component="button" type="button" variant="caption" underline="hover" disabled={addingDo} onClick={(e: React.MouseEvent) => { e.stopPropagation(); void addDo(); }} sx={{ display: "block", mt: 0.5 }}>
                Add DO
              </Link>
            )}
            {s.action === "addServiceReport" && (
              <Link component="button" type="button" variant="caption" underline="hover" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSrMenu({ pos: { left: e.clientX, top: e.clientY } }); }} sx={{ display: "block", mt: 0.5 }}>
                Add service report
              </Link>
            )}
          </Box>
          );
        })}
      </Stack>

      {order.status === "PART_BILLED" && left.length > 0 && (
        <Box sx={{ mb: 3 }} data-tour="imported-order-left-to-bill">
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Left to bill
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell align="right">Quoted</TableCell>
                  <TableCell align="right">Billed</TableCell>
                  <TableCell align="right">Left</TableCell>
                  <TableCell align="right">Unit price</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {left.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ whiteSpace: "pre-line" }}>{l.description.split("\n")[0]}</TableCell>
                    <TableCell align="right">{l.quotedQty ?? ""}</TableCell>
                    <TableCell align="right">{l.billedQty ?? ""}</TableCell>
                    <TableCell align="right">{l.quantity}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{importedMoney(l.unitPrice)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{importedMoney(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Documents
        </Typography>
        <Box sx={{ flex: 1 }} />
        {manualFlow && (
          <Button size="small" variant="outlined" startIcon={addingDo ? <CircularProgress size={14} /> : <AddIcon />} disabled={addingDo} onClick={() => void addDo()} data-tour="imported-order-add-do">
            Add DO
          </Button>
        )}
        {canAddJob && (
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addJob} data-tour="imported-order-add-job">
            Add job
          </Button>
        )}
        <input ref={fileRef} type="file" accept={ORDER_FILE_ACCEPT} hidden onChange={(e) => void uploadAttachment(e.target.files?.[0])} />
        <Button
          size="small"
          variant="outlined"
          disabled={uploading}
          endIcon={uploading ? <CircularProgress size={14} color="inherit" /> : <ArrowDropDownIcon />}
          onClick={(e) => setSrMenu({ pos: { left: e.clientX, top: e.clientY } })}
          data-tour="imported-order-service-report"
        >
          Service report
        </Button>
        {manualFlow && canSendReport && (
          <Button size="small" variant="outlined" onClick={() => setSendReportOpen(true)}>
            Send service report
          </Button>
        )}
        {order.canLink && (
          <Button size="small" variant="contained" disableElevation onClick={() => openLink()} data-tour="imported-order-link-document">
            Link existing document
          </Button>
        )}
      </Stack>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Document</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Linked by</TableCell>
              <TableCell>ERP DO</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Owed</TableCell>
              <TableCell padding="checkbox" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} hover sx={row.href || row.fileKey ? { cursor: "pointer" } : undefined} onClick={() => openRow(row)}>
                <TableCell>{row.label}</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{row.date ? moment(row.date).format("DD/MM/YYYY") : ""}</TableCell>
                <TableCell>{row.state}</TableCell>
                <TableCell>{row.by}</TableCell>
                <TableCell>{row.doNo}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {row.amount == null ? "" : importedMoney(row.amount)}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {row.owed == null ? "" : importedMoney(row.owed)}
                </TableCell>
                <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                  {hasMenu(row) && (
                    <IconButton
                      size="small"
                      aria-label="More actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        const pos = { left: e.clientX, top: e.clientY };
                        const d = row.kind === "do" ? dos.find((x) => x.id === row.doId) : null;
                        if (d) setDoMenu({ pos, d });
                        else setRowMenu({ pos, row });
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorReference="anchorPosition" anchorPosition={rowMenu?.pos} open={!!rowMenu} onClose={() => setRowMenu(null)}>
        {rowMenu?.row.href && (
          <MenuItem
            onClick={() => {
              const r = rowMenu.row;
              setRowMenu(null);
              openRow(r);
            }}
          >
            Open
          </MenuItem>
        )}
        {rowMenu?.row.unlink && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              const u = rowMenu.row.unlink!;
              setRowMenu(null);
              void unlink(u);
            }}
          >
            Unlink
          </MenuItem>
        )}
        {rowMenu?.row.attachmentId && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              const r = rowMenu.row;
              setRowMenu(null);
              void removeFile(r);
            }}
          >
            Remove from order
          </MenuItem>
        )}
      </Menu>

      <OrderDoMenu menu={doMenu} onClose={() => setDoMenu(null)} cancelled={false} onCompleteDo={(d) => setCompleteDo(d)} onSignLink={(d) => setSignLinkDo(d)} />

      <Menu anchorReference="anchorPosition" anchorPosition={srMenu?.pos} open={!!srMenu} onClose={() => setSrMenu(null)}>
        {serviceReportMenuItems(manualFlow).map((it) => {
          const item = (
            <MenuItem
              key={it.key}
              data-tour={it.tour}
              onClick={() => {
                setSrMenu(null);
                if (it.key === "new" || (it.key === "upload" && manualFlow)) router.push(serviceReportFlowHref(it.key, srPrefill()));
                else if (it.key === "upload") fileRef.current?.click();
                else openLink("SERVICE_REPORT");
              }}
            >
              {it.label}
            </MenuItem>
          );
          return it.key === "upload" ? (
            <Tooltip key={it.key} title={orderUploadTip(manualFlow)} placement="right">
              {item}
            </Tooltip>
          ) : (
            item
          );
        })}
      </Menu>

      {jobOpen && q && (
        <QuickJobDialog
          open
          withQuotation
          initialQuotationId={q.id}
          onClose={() => setJobOpen(false)}
          onSaved={(_id, r) => {
            setJobOpen(false);
            toast.success(linkedToast(r, q.name));
            reload();
          }}
        />
      )}
      <ScheduleDeliveryDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} onCreated={() => reload()} prefill={prefill} />
      {completeDo && (
        <OfficeCompleteJobDialog
          open
          onClose={() => setCompleteDo(null)}
          deliveryId=""
          doId={completeDo.id}
          productSlots={(completeDo.products ?? []).map((p: any) => ({ assetId: p.assetId, name: p.name, quantity: 1 }))}
          jobLabel={completeDo.name || "the DO"}
          defaultName={order.customer?.name ?? null}
          onDone={(mode) => {
            const d = completeDo;
            setCompleteDo(null);
            if (mode === "sign_link") setSignLinkDo(d);
            reload();
          }}
        />
      )}
      <Dialog open={!!signLinkDo} onClose={() => setSignLinkDo(null)} fullWidth maxWidth="sm">
        <DialogTitle>Customer sign link</DialogTitle>
        <DialogContent>{signLinkDo && <CustomerSignLink documentId={signLinkDo.id} doName={signLinkDo.name} />}</DialogContent>
        <DialogActions>
          <Button onClick={() => setSignLinkDo(null)}>Close</Button>
        </DialogActions>
      </Dialog>
      <SendServiceReportDialog
        open={sendReportOpen}
        onClose={() => setSendReportOpen(false)}
        orderId={order.id}
        orderNumber={order.orderNumber}
        defaultEmail={(order.customer as any)?.email ?? null}
        onSent={(r) => {
          toast.success(`Service report sent to ${r.sentTo.join(", ")}`);
          reload();
        }}
      />

      <Dialog open={linkOpen} onClose={() => !busy && setLinkOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Link existing document</DialogTitle>
        <DialogContent>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={linkType}
            onChange={(_e, v) => {
              if (!v) return;
              setLinkType(v);
              void findLinkOptions(v, linkQuery);
            }}
            sx={{ mt: 1, mb: 1.5, flexWrap: "wrap" }}
          >
            {IMPORTED_LINK_TYPES.map((t) => (
              <ToggleButton key={t.key} value={t.key} sx={{ textTransform: "none" }}>
                {t.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField
              size="small"
              fullWidth
              label={linkType === "SERVICE_REPORT" ? "Report number" : "Number"}
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void findLinkOptions(linkType, linkQuery);
              }}
              inputProps={{ maxLength: 40 }}
            />
            <Button onClick={() => void findLinkOptions(linkType, linkQuery)}>Find</Button>
          </Stack>
          {linkResults === null ? (
            <CircularProgress size={20} />
          ) : linkResults.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No documents found
            </Typography>
          ) : (
            <List dense>
              {linkResults.map((o) => {
                const st = linkOptionState(o);
                const secondary = [o.date ? moment(o.date).format("DD/MM/YYYY") : "", o.imported ? "Imported" : "", o.total != null ? importedMoney(o.total) : "", st.note].filter(Boolean).join(" · ");
                return (
                  <ListItemButton key={o.id} disabled={st.disabled || !!busy} onClick={() => void linkDocument(o)}>
                    <ListItemText primary={o.name ?? "Document"} secondary={secondary} />
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)} disabled={!!busy}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={invOpen} onClose={() => !busy && setInvOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Create invoice</DialogTitle>
        <DialogContent>
          <TextField label="Invoice number" value={invNumber} onChange={(e) => setInvNumber(e.target.value)} inputProps={{ maxLength: 40 }} sx={{ mt: 1, mb: 2, minWidth: 260 }} />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell align="right" sx={{ width: 90 }}>Qty</TableCell>
                  <TableCell align="right" sx={{ width: 130 }}>Unit price</TableCell>
                  <TableCell align="right" sx={{ width: 120 }}>Amount</TableCell>
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {invLines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <TextField size="small" fullWidth multiline maxRows={4} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} inputProps={{ "aria-label": `Line ${i + 1} description` }} />
                    </TableCell>
                    <TableCell align="right">
                      <TextField size="small" type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputProps={{ min: 0, step: "any", "aria-label": `Line ${i + 1} qty` }} />
                    </TableCell>
                    <TableCell align="right">
                      <TextField size="small" type="number" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} inputProps={{ step: "any", "aria-label": `Line ${i + 1} unit price` }} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{importedMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}</TableCell>
                    <TableCell padding="checkbox">
                      <IconButton size="small" aria-label={`Remove line ${i + 1}`} disabled={invLines.length <= 1} onClick={() => setInvLines((xs) => xs.filter((_x, k) => k !== i))}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack direction="row" alignItems="center" sx={{ mt: 1.5 }}>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setInvLines((xs) => [...xs, { description: "", quantity: "1", unitPrice: "0", priced: true }])}>
              Add line
            </Button>
            <Box sx={{ flex: 1 }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Total before GST {importedMoney(invNet)}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvOpen(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="contained" disableElevation disabled={!!busy || invNet <= 0} onClick={() => void createInvoice()}>
            Create draft invoice
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={completeOpen} onClose={() => !busy && setCompleteOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Mark complete</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth multiline minRows={2} label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 300 }} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteOpen(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="contained" disableElevation disabled={!reason.trim() || !!busy} onClick={() => void markComplete()}>
            Mark complete
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}
