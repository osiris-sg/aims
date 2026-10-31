"use client";

// Round AV (Sayaka, ADH Sales) — add or edit a shipment WITHOUT leaving the email. A side drawer over the Answer
// flow (and over the Dashboard's "Show full email" pop-up):
//   New   pick the order (search #n, customer, grade, contract, PI) unless it came with one → the shipment form,
//         its empty fields prefilled from the email + attachments where the email is exact ("from email").
//         Nothing is created until Save; Cancel creates nothing. Save → onSaved(shipment).
//   Edit  the shipment's normal form (same fields / validation as the shipment page); an email value that differs
//         from the field shows beside it with "Use this" — never applied by itself.
// One shipment per B/L is the server's rule; a net weight over the order's quantity left (± tolerance) warns
// before saving. The email stays one click away at the top ("The email").

import React, { useMemo, useState } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, CircularProgress, Drawer, IconButton, List, ListItemButton, ListItemText, Stack, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ThemeProvider, type Theme } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type InboxLang, type OrderListItem, type Shipment } from "../../_lib/api";
import { useOrder, useOrders, useShipment } from "../../_lib/hooks";
import { nextShipmentRef, orderHaystack, orderLine as orderLineOf, qtyLeft } from "../../_lib/shipment-picker";
import { fmtDay, shortCustomer } from "../../_lib/format";

const orderLine = (o: Parameters<typeof orderLineOf>[0]) => orderLineOf(o, { customer: shortCustomer });
import ShipmentFormDialog, { type OrderRef } from "../ShipmentFormDialog";
import { EmailView } from "./EmailView";

/** Menus, selects and the order search opened inside the drawer must sit above it (it sits above the dialog). */
const aboveDrawer = (outer: Theme): Theme => ({ ...outer, zIndex: { ...outer.zIndex, modal: outer.zIndex.modal + 10 } });

export type DrawerMode = { kind: "new"; orderId?: string | null } | { kind: "edit"; shipmentId: string };

export function ShipmentDrawer({ open, mode, emailIds, lang, onClose, onSaved }: { open: boolean; mode: DrawerMode | null; emailIds: string[]; lang: InboxLang; onClose: () => void; onSaved: (s: Shipment) => void }) {
  const api = useShipmentsApi();
  const ja = lang === "ja";
  const [pickedOrder, setPickedOrder] = useState<OrderListItem | null>(null);
  const [orderQ, setOrderQ] = useState("");
  const isNew = mode?.kind === "new";
  const orders = useOrders({ bucket: "pending", pageSize: 200 }, open && isNew);
  const editing = useShipment(open && mode?.kind === "edit" ? mode.shipmentId : undefined);
  const presetOrder = isNew && mode.orderId ? (orders.data?.items ?? []).find((o) => o.id === mode.orderId) ?? null : null;
  const order = isNew ? (presetOrder ?? pickedOrder) : null;
  const orderId = isNew ? order?.id : editing.data?.orderId ?? undefined;
  const orderDetail = useOrder(open ? orderId ?? undefined : undefined);
  const facts = useQuery({ queryKey: ["inbox-shipment-facts", emailIds], enabled: open && emailIds.length > 0, queryFn: () => api.inboxShipmentFacts(emailIds), staleTime: 5 * 60_000, retry: false });

  // The order's quantity left: max (qty ± tolerance) − the other shipments' net (this one's excluded on an edit).
  const qtyLimit = useMemo(() => {
    const tol = orderDetail.data?.tolerance;
    const left = qtyLeft(tol, mode?.kind === "edit" && editing.data?.netWeightMt != null ? Number(editing.data.netWeightMt) : null);
    if (!tol || left === null) return null;
    return { remainingMt: left, maxMt: tol.max, orderRef: `#${orderDetail.data!.orderNo}` };
  }, [orderDetail.data, editing.data, mode]);
  const orderRef: OrderRef | null = order
    ? {
        id: order.id,
        ref: `#${order.orderNo}`,
        nextRef: nextShipmentRef(order),
        customerName: order.customerName ?? order.customer?.name ?? null,
        contractNo: order.contractNo,
        currency: (order as { currency?: string | null }).currency ?? null,
        deliveryMonth: order.deliveryMonth ?? null,
        commodity: [order.product, order.grade].filter(Boolean).join(" ") || null,
        sizeSpec: order.size ?? null,
      }
    : null;

  // Edit of a shipment under an order: the form shows the order (not a contract to pick) and saves as an edit.
  const ed = mode?.kind === "edit" ? editing.data : null;
  const editOrderRef: OrderRef | null = ed?.orderId ? { id: ed.orderId, ref: (ed.ref ?? "").replace(/-\d+$/, "") || "Order", customerName: ed.customer?.name ?? null, contractNo: ed.contract?.contractNo ?? null } : null;

  // The order list under the search: every word must match (#n and old numbers, customer, grade, contract, PI).
  const orderOptions = useMemo(() => {
    const words = orderQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (orders.data?.items ?? []).filter((o) => words.every((w) => orderHaystack(o).includes(w))).slice(0, 40);
  }, [orders.data, orderQ]);

  const close = () => {
    setPickedOrder(null);
    setOrderQ("");
    onClose();
  };
  const subject = facts.data?.subject ?? null;
  const title = !mode ? "" : mode.kind === "edit" ? (ja ? `出荷を編集 ${editing.data?.ref ?? ""}` : `Edit shipment ${editing.data?.ref ?? ""}`) : orderRef ? (ja ? `新しい出荷 ${orderRef.nextRef}` : `New shipment ${orderRef.nextRef}`) : ja ? "新しい出荷 — 注文を選択" : "New shipment — pick the order";
  const newestId = emailIds[emailIds.length - 1];

  return (
    // Above the Answer dialog / email pop-up it opens from (a drawer's own z-index sits below modals).
    <Drawer anchor="right" open={open && !!mode} onClose={close} sx={{ zIndex: (th) => th.zIndex.modal + 1 }} PaperProps={{ sx: { width: { xs: "100%", sm: 600, md: 680 }, p: 0 } }} data-tour="shipment-drawer" data-kind={mode?.kind}>
      <ThemeProvider theme={aboveDrawer}>
      <Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: "divider", position: "sticky", top: 0, zIndex: 2, bgcolor: "background.paper" }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h6" sx={{ fontWeight: 700, flex: 1, minWidth: 0, wordBreak: "break-word" }} data-tour="shipment-drawer-title">
            {title}
          </Typography>
          <IconButton aria-label="Close" onClick={close} data-tour="shipment-drawer-close">
            <CloseIcon />
          </IconButton>
        </Stack>
        {subject && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }}>
            {ja ? "メールから" : "From the email"}: {subject}
          </Typography>
        )}
      </Box>
      <Box sx={{ px: 2.5, py: 2 }}>
        {newestId && (
          <Accordion disableGutters variant="outlined" sx={{ mb: 2, "&:before": { display: "none" } }} data-tour="shipment-drawer-email">
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{ja ? "メール" : "The email"}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ maxHeight: 420, overflow: "auto" }}>
              <EmailView id={newestId} compactHeaders lang={lang} />
            </AccordionDetails>
          </Accordion>
        )}
        {facts.isLoading && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">{ja ? "メールと添付を読んでいます…" : "Reading the email and its attachments…"}</Typography>
          </Stack>
        )}
        {facts.data && facts.data.containers.length > 0 && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5, wordBreak: "break-word" }} data-tour="email-containers">
            {ja ? "メールのコンテナ" : "Containers in the email"}: {facts.data.containers.join(", ")}
          </Typography>
        )}
        {isNew && !presetOrder && !pickedOrder && (
          <Box>
            <TextField
              fullWidth
              autoFocus
              size="small"
              label={ja ? "注文（#番号・顧客・材質・契約・PI）" : "Order (#n, customer, grade, contract, PI)"}
              value={orderQ}
              onChange={(e) => setOrderQ(e.target.value)}
              inputProps={{ "data-tour": "new-shipment-order" }}
            />
            {orders.isLoading ? (
              <CircularProgress size={20} sx={{ mt: 1.5 }} />
            ) : (
              <List dense disablePadding sx={{ mt: 1 }} data-tour="new-shipment-order-list">
                {orderOptions.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{ja ? "該当する注文がありません" : "No open order matches"}</Typography>
                )}
                {orderOptions.map((o) => (
                  <ListItemButton key={o.id} onClick={() => setPickedOrder(o)} sx={{ borderRadius: 1 }} data-tour="new-shipment-order-option">
                    <ListItemText
                      primary={orderLine(o)}
                      secondary={[o.contractNo, o.piNo ? `PI ${o.piNo}` : null, o.shipmentCount ? `${o.shipmentCount} shipment${o.shipmentCount > 1 ? "s" : ""}` : ja ? "出荷なし" : "no shipment yet", `${ja ? "次" : "next"} ${nextShipmentRef(o)}`].filter(Boolean).join(" · ")}
                      primaryTypographyProps={{ variant: "body2", fontWeight: 600 }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
        )}
        {mode?.kind === "edit" && editing.isLoading && <CircularProgress size={22} />}
        {mode?.kind === "edit" && editing.error && <Alert severity="error">{(editing.error as Error).message}</Alert>}
        {((isNew && orderRef) || (mode?.kind === "edit" && editing.data)) && (
          <ShipmentFormDialog
            key={mode?.kind === "edit" ? `e:${mode.shipmentId}` : `n:${orderRef!.id}`}
            bare
            open={open}
            onClose={close}
            shipment={mode?.kind === "edit" ? editing.data : null}
            order={isNew ? orderRef : editOrderRef}
            emailFacts={facts.data ?? null}
            fromEmailId={newestId ?? null}
            qtyLimit={qtyLimit}
            onSaved={(s) => {
              setPickedOrder(null);
              onSaved(s);
            }}
          />
        )}
      </Box>
      </ThemeProvider>
    </Drawer>
  );
}
