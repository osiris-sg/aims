"use client";

// One order page for AIMS and imported orders (WCT group, round 24, 2026-11-19). Presentational only: it draws the
// model from helpers/orderPage.ts (same sections, card keys, actions and Documents columns for both kinds) and hands
// every click back to the page (WctOrderDetail), which owns the dialogs, menus and API calls.

import { PLACEHOLDER_TIP } from "@/helpers/linkDoc";
import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Box, Button, Chip, CircularProgress, Collapse, IconButton, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MainCard from "@/components/MainCard";
import { OrderJobPhotos } from "@/components/delivery/JobPhotos";
import StatusPill from "../_components/StatusPill";
import { importedMoney } from "@/helpers/importedOrders";
import { LEFT_TO_BILL_COLUMNS, ORDER_DOC_COLUMNS, docRowMenu, fmtDate, type OrderAction, type OrderCard, type OrderDocRow, type OrderField, type OrderPageModel } from "@/helpers/orderPage";
import type { HubActionKey } from "@/helpers/wctOrderHub";

type Pos = { left: number; top: number };
const at = (e: React.MouseEvent): Pos => ({ left: e.clientX, top: e.clientY });
const money = (n: number | null | undefined) => (n == null ? "" : importedMoney(n));

/** A document number as a link (its own click only). */
function NumberLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} style={{ color: "inherit", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
      {label}
    </Link>
  );
}

function Field({ f }: { f: OrderField }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {f.label}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {f.href && f.value !== "-" ? <NumberLink href={f.href} label={f.value} /> : f.value}
      </Typography>
    </Box>
  );
}

function Card({ card, n, onClick, onUploadDo }: { card: OrderCard; n: number; onClick: (e: React.MouseEvent) => void; onUploadDo?: (doId: string) => void }) {
  const can = !!card.click;
  return (
    <Box
      onClick={can ? onClick : undefined}
      data-card={card.key}
      sx={{
        flex: 1,
        minWidth: 160,
        p: 1.5,
        borderRadius: 1.5,
        border: 1,
        borderColor: card.current ? "primary.main" : "divider",
        bgcolor: card.current ? "action.hover" : "transparent",
        cursor: can ? "pointer" : "default",
        "&:hover": can ? { bgcolor: "action.selected" } : undefined,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        {card.done ? (
          <CheckCircleIcon fontSize="small" color="success" />
        ) : (
          <Box sx={{ width: 20, height: 20, borderRadius: "50%", border: 1.5, borderColor: card.current ? "primary.main" : "text.disabled", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: card.current ? "primary.main" : "text.secondary" }}>
            {n}
          </Box>
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {card.title}
        </Typography>
        {card.done && card.date && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: "auto !important" }}>
            {fmtDate(card.date)}
          </Typography>
        )}
      </Stack>
      {card.note && (
        <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.25 }}>
          {card.note}
        </Typography>
      )}
      {card.docs.length ? (
        card.docs.map((d, i) => (
          <Typography key={i} variant="caption" component="div" title={d.placeholder ? PLACEHOLDER_TIP : undefined} sx={{ color: "text.secondary", ...(d.placeholder ? { opacity: 0.5 } : {}) }}>
            {d.href ? (
              <NumberLink href={d.href} label={d.label} />
            ) : (
              <Box component="span" sx={{ color: "text.primary", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {d.label}
              </Box>
            )}
            {d.status ? ` · ${d.status}` : ""}
            {/* 2026-11-23: a pending DO: the DO page's upload (Complete DO, Upload signed DO), from here. */}
            {d.uploadDoId && onUploadDo && (
              <Box
                component="button"
                type="button"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  onUploadDo(d.uploadDoId!);
                }}
                data-tour="wct-order-card-upload-do"
                sx={{ display: "block", p: 0, mt: 0.25, border: 0, background: "none", cursor: "pointer", color: "primary.main", font: "inherit", fontSize: "0.75rem", fontWeight: 600, textAlign: "left" }}
              >
                Attach signed copy
              </Box>
            )}
          </Typography>
        ))
      ) : !card.note ? (
        <Typography variant="caption" color="text.disabled" component="div">
          {card.empty}
        </Typography>
      ) : null}
      {card.subNote && (
        <Typography variant="caption" color="text.secondary" component="div">
          {card.subNote}
        </Typography>
      )}
    </Box>
  );
}

function ActionButton({ a, busy, onClick }: { a: OrderAction; busy?: boolean; onClick: (e: React.MouseEvent<HTMLElement>) => void }) {
  const icon = busy ? <CircularProgress size={14} color="inherit" /> : undefined;
  const btn = (
    <Button
      size="small"
      variant={a.primary ? "contained" : "outlined"}
      color={a.key === "cancel-order" ? "error" : "primary"}
      disableElevation
      disabled={a.disabled || busy}
      startIcon={a.key === "add-do" || a.key === "add-job" ? icon ?? <AddIcon /> : undefined}
      endIcon={a.key === "service-report" ? icon ?? <ArrowDropDownIcon /> : undefined}
      onClick={onClick}
      data-tour={a.tour}
      data-action={a.key}
    >
      {a.label}
    </Button>
  );
  return a.tip ? (
    <Tooltip title={a.tip}>
      <span>{btn}</span>
    </Tooltip>
  ) : (
    btn
  );
}

/** A section that starts closed (Supplier invoices, Photos). */
function Collapsed({ title, tour, children }: { title: string; tour: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Box sx={{ mt: 2, borderTop: 1, borderColor: "divider", pt: 1 }} data-tour={tour}>
      <Button size="small" color="inherit" onClick={() => setOpen((v) => !v)} endIcon={<ExpandMoreIcon sx={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />} sx={{ fontWeight: 600, textTransform: "none", px: 0.5 }}>
        {title}
      </Button>
      <Collapse in={open}>
        <Box sx={{ mt: 1 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

function SupplierInvoices({ data }: { data: OrderPageModel["supplierInvoices"] }) {
  const router = useRouter();
  if (!data?.rows?.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No supplier invoices
      </Typography>
    );
  }
  const f = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Invoice #</TableCell>
            <TableCell>Supplier</TableCell>
            <TableCell>Date</TableCell>
            <TableCell align="right">Total</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.rows.map((b: any) => (
            <TableRow key={b.id} hover sx={{ cursor: "pointer", opacity: b.void ? 0.55 : 1 }} onClick={() => router.push(`/portal/accounting/payables/purchase-journal?bill=${b.id}`)}>
              <TableCell sx={{ fontWeight: 600 }}>
                {b.billNumber}
                {b.void ? " (void)" : ""}
              </TableCell>
              <TableCell>{b.supplierName || "-"}</TableCell>
              <TableCell>{b.billDate ? new Date(b.billDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", textDecoration: b.void ? "line-through" : "none" }}>
                {/* This quotation's lines; the invoice's whole total under it, smaller. */}
                {b.currency} {f(b.quotationAmount ?? b.totalAmount)}
                <Typography component="div" variant="caption" color="text.secondary">
                  of {b.currency} {f(b.totalAmount)}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
              Supplier invoices total
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              SGD {f(data.total)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** Photos from SiteClock, one group per job; the whole section hides for orgs without the SiteClock link. */
function Photos({ orderId }: { orderId: string }) {
  const [shown, setShown] = React.useState(true);
  if (!shown) return null;
  return (
    <Collapsed title="Photos" tour="wct-order-photos">
      <OrderJobPhotos orderId={orderId} onUnavailable={() => setShown(false)} />
    </Collapsed>
  );
}

export default function OrderPageLayout({
  model,
  onBack,
  onAction,
  onNextStep,
  onCard,
  onRow,
  onRowMenu,
  onFile,
  onUploadDo,
  busy = {},
  alerts,
  photos = true,
  children,
}: {
  model: OrderPageModel;
  onBack: () => void;
  onAction: (a: OrderAction, e: React.MouseEvent<HTMLElement>) => void;
  onNextStep: (key: HubActionKey, pos: Pos) => void;
  onCard: (card: OrderCard, pos: Pos) => void;
  onRow: (row: OrderDocRow) => void;
  onRowMenu: (row: OrderDocRow, pos: Pos) => void;
  onFile: (row: OrderDocRow) => void;
  /** The DO card's "Attach signed copy" under a pending DO (2026-11-23). */
  onUploadDo?: (doId: string) => void;
  busy?: Partial<Record<OrderAction["key"], boolean>>;
  alerts?: React.ReactNode;
  /** Off in the fixture preview (no API). */
  photos?: boolean;
  children?: React.ReactNode;
}) {
  const m = model;
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

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }} data-section="header">
        <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {m.number}
        </Typography>
        <StatusPill label={m.statusLabel} color="default" hue={m.statusHue} />
        {/* Round 40 (Elroy 2026-11-20): no "Imported" tag; the (i) still says where the order came from. */}
        {m.imported && (
          <Tooltip title="Imported from the old ERP: its quotation and the invoices the ERP linked to it. The imported documents are read-only.">
            <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
          </Tooltip>
        )}
      </Stack>

      <Stack direction="row" spacing={3} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap data-section="info">
        {m.info.map((f) => (
          <Field key={f.key} f={f} />
        ))}
      </Stack>
      <Stack direction="row" spacing={3} sx={{ mb: 2.5 }} flexWrap="wrap" useFlexGap data-section="summary" data-tour="wct-order-summary">
        {[...m.summary, ...m.extras].map((f) => (
          <Field key={f.key} f={f} />
        ))}
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }} data-section="tracker" data-tour="wct-order-hub">
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {m.cards.map((c, i) => (
            <Card key={c.key} card={c} n={i + 1} onClick={(e) => onCard(c, at(e))} onUploadDo={onUploadDo} />
          ))}
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }} data-section="actions">
        {m.nextSteps.map((s) => (
          <Button key={s.key} size="small" variant="contained" disableElevation onClick={(e) => onNextStep(s.key, at(e))} data-tour="wct-order-next-step">
            {s.label}
          </Button>
        ))}
        {m.actions
          .filter((a) => a.show)
          .map((a) => (
            <ActionButton key={a.key} a={a} busy={busy[a.key]} onClick={(e) => onAction(a, e)} />
          ))}
        {m.cancelled && <Chip size="small" label="Cancelled" />}
      </Stack>
      {alerts}

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Documents
      </Typography>
      <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }} data-section="documents" data-tour="wct-order-documents">
        <Table size="small">
          <TableHead>
            <TableRow>
              {ORDER_DOC_COLUMNS.map((c, i) => (
                <TableCell key={i} align={c === "Amount" || c === "Owed" ? "right" : undefined} padding={c === "" ? "checkbox" : undefined}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {m.documents.length === 0 && (
              <TableRow>
                <TableCell colSpan={ORDER_DOC_COLUMNS.length}>
                  <Typography variant="body2" color="text.secondary">
                    No documents yet
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {m.documents.map((r) => {
              const menu = docRowMenu(r, { manualFlow: m.manualFlow });
              const can = !!r.href || !!r.fileKey;
              return (
                <TableRow key={r.key} hover title={r.placeholder ? PLACEHOLDER_TIP : undefined} sx={{ cursor: can ? "pointer" : "default", ...(r.placeholder ? { opacity: 0.5 } : {}) }} onClick={() => can && onRow(r)}>
                  <TableCell sx={r.child ? { pl: 4 } : undefined}>
                    <Box component="span" sx={{ color: "text.secondary", mr: 0.75 }}>
                      {r.type}
                    </Box>
                    {r.href ? <NumberLink href={r.href} label={r.number} /> : <Box component="span" sx={{ fontWeight: 600 }}>{r.number}</Box>}
                    {r.note && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        {r.note}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</TableCell>
                  <TableCell>{r.status}</TableCell>
                  <TableCell>{r.by}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {money(r.amount)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {money(r.owed)}
                  </TableCell>
                  <TableCell>
                    {(r.file || r.fileKey) && (
                      <Button
                        size="small"
                        variant="text"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFile(r);
                        }}
                        sx={{ minWidth: 0, p: 0, textTransform: "none" }}
                      >
                        {r.file?.label ?? "File"}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    {menu.length > 0 && (
                      <IconButton
                        size="small"
                        aria-label="More actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRowMenu(r, at(e));
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {m.leftToBill.length > 0 && (
        <Box sx={{ mt: 3 }} data-section="leftToBill" data-tour="wct-order-left-to-bill">
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Left to bill
          </Typography>
          <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {LEFT_TO_BILL_COLUMNS.map((c) => (
                    <TableCell key={c} align={c === "Item" ? undefined : "right"}>
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {m.leftToBill.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>{l.description}</TableCell>
                    <TableCell align="right">{l.quotedQty ?? ""}</TableCell>
                    <TableCell align="right">{l.billedQty ?? ""}</TableCell>
                    <TableCell align="right">{l.quantity}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {importedMoney(l.unitPrice)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {importedMoney(l.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <Box sx={{ mt: 2 }} data-section="supplierInvoices">
        <Collapsed title="Supplier invoices" tour="wct-order-supplier-invoices">
          <SupplierInvoices data={m.supplierInvoices} />
        </Collapsed>
      </Box>
      {photos && <Photos orderId={m.id} />}

      {children}
    </MainCard>
  );
}
