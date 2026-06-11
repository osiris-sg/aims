"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ReceiptIcon from "@mui/icons-material/Receipt";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import AssignmentIcon from "@mui/icons-material/Assignment";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import moment from "moment";
import { toast } from "react-toastify";

interface OrderItem {
  id?: number;
  itemCode?: string;
  inventoryItemId?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  dealerPrice?: number;
  uom?: string;
  amount?: number;
  isTagGroup?: boolean;
  tagGroupId?: string;
  taggedAssetId?: string;
  taggedAssetCode?: string;
  taggedAssetName?: string;
  category?: string;
  points?: number;
  discount?: number;
  // Set by the orders/verify-upload endpoint when a supplier doc reconciles
  // against this line. Carries the supplier doc no. + date for the tooltip,
  // plus the S3 fileKey so the page can mint a signed download URL on demand.
  verifiedDo?: VerifiedStamp | null;
  verifiedInv?: VerifiedStamp | null;
}

interface VerifiedStamp {
  docNumber?: string | null;
  date?: string | null;
  supplier?: string | null;
  at?: string;
  fileUrl?: string | null;
  fileKey?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
  // 'ok' when SKU + qty + price + amount all matched the supplier doc;
  // 'mismatch' when qty matched but price/amount diverged (still stamped, but
  // shown amber so the user knows there's a discrepancy worth eyeballing).
  lineStatus?: "ok" | "mismatch";
  mismatchNotes?: string | null;
  supplierQty?: number | null;
  supplierUnitPrice?: number | null;
  supplierAmount?: number | null;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  customer?: { id: string; name: string; customerCode: string | null; address?: string | null } | null;
  sourceQuotation?: { id: string; name: string; status: string; type: string; documentTemplateId?: string } | null;
  items: OrderItem[];
  linkedDocuments?: { po?: any[]; do?: any[]; invoice?: any[] };
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

const statusColor = (status: string) => {
  const s = (status || "").toUpperCase();
  if (s === "DRAFT") return "default";
  if (s === "IN_PROGRESS") return "info";
  if (s === "COMPLETED") return "success";
  if (s === "CANCELLED") return "error";
  return "default";
};

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [inventories, setInventories] = useState<any[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [creating, setCreating] = useState<null | "PO" | "DO" | "INVOICE" | "SO">(null);
  // Project orders: editable per-item discount. draftItems is a working copy of
  // order.items; editedIdx tracks which lines the user manually changed (so
  // "Recalibrate" only rebalances the untouched lines).
  const [draftItems, setDraftItems] = useState<OrderItem[] | null>(null);
  const [editedIdx, setEditedIdx] = useState<Set<number>>(new Set());
  const [savingDiscounts, setSavingDiscounts] = useState(false);

  const fetchOrder = useCallback(async () => {
    if (!organization?.id || !params?.id) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await request({ path: `/orders/${params.id}`, method: "GET" }, {}, token ?? undefined);
      if (res?.success && res?.data) setOrder(res.data);
      else setOrder(res?.data ?? null);
    } catch (err) {
      console.error("Fetch order failed:", err);
      toast.error("Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [organization?.id, params?.id, getToken]);

  // Load inventories so we can resolve cost prices for PO conversion. Only
  // needed when the user actually clicks "Create PO"; preloading is fine.
  const fetchInventories = useCallback(async () => {
    if (!organization?.id) return;
    try {
      const token = await getToken();
      const res = await request(
        { path: "/inventories", method: "POST" },
        { status: "all", page: 1, limit: 200 },
        token ?? undefined,
      );
      setInventories(res?.data?.docs || []);
    } catch (err) {
      console.warn("Fetch inventories for cost lookup failed:", err);
    }
  }, [organization?.id, getToken]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);
  useEffect(() => { fetchInventories(); }, [fetchInventories]);

  // Route Orders show a per-item Points column (asset points carried on each line).
  const isRouteOrder = ((order as any)?.orderType || "") === "Route Order";
  // Project Orders show an editable per-item Discount column (the quotation's
  // discount, spread per line by the backend when the quotation was confirmed).
  const isProject = ((order as any)?.orderType || "") === "Project";
  const currency = (organization as any)?.currency || "SGD";

  // Seed the editable draft from the loaded order. Reset whenever the order
  // (re)loads so a fresh fetch after save clears the "edited" set.
  useEffect(() => {
    setDraftItems(order?.items ? order.items.map((i) => ({ ...i })) : null);
    setEditedIdx(new Set());
  }, [order?.items]);

  // Tagged CUs are also line items in the order — surface them as their own
  // rows in the table so the user can select + convert them to PO/DO/Invoice
  // independently from the FCU rows that reference them. For Project orders we
  // render from the editable draft so discount edits show live.
  const visibleItems = useMemo(() => {
    const base = isProject && draftItems ? draftItems : order?.items || [];
    return base.map((it, idx) => ({ ...it, _index: idx }));
  }, [isProject, draftItems, order?.items]);

  // Per-line gross (before discount) and the discount $ (gross − net amount).
  // The discount amount is the source of truth (the % is for display/entry),
  // so totals reconcile exactly to the cent regardless of rounded percents.
  const grossOf = (it: OrderItem) => (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0);
  const discAmtOf = (it: OrderItem) => grossOf(it) - (Number(it.amount) || 0);
  // Target = the discount total when the order was created (all lines at the
  // quotation rate). "Recalibrate" rebalances back to this fixed amount.
  const targetTotalDiscount = useMemo(
    () => (order?.items || []).reduce((s, it) => s + discAmtOf(it), 0),
    [order?.items],
  );
  const currentTotalDiscount = useMemo(
    () => (draftItems || []).reduce((s, it) => s + discAmtOf(it), 0),
    [draftItems],
  );
  const dirty = useMemo(() => {
    if (!draftItems || !order?.items) return false;
    return draftItems.some((it, i) => Number(it.discount || 0) !== Number(order.items[i]?.discount || 0));
  }, [draftItems, order?.items]);
  const diverged = Math.abs(currentTotalDiscount - targetTotalDiscount) > 0.005;
  const hasOtherItems = useMemo(
    () => (draftItems || []).some((_, i) => !editedIdx.has(i)),
    [draftItems, editedIdx],
  );

  const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  // Edit one line's discount %; recompute its amount and lock it (so a later
  // Recalibrate leaves it alone and only rebalances the untouched lines).
  const setItemDiscount = (idx: number, raw: string) => {
    setDraftItems((prev) => {
      if (!prev) return prev;
      const next = prev.map((x) => ({ ...x }));
      let pct = parseFloat(raw);
      if (isNaN(pct)) pct = 0;
      pct = Math.max(0, Math.min(100, pct));
      next[idx].discount = pct;
      next[idx].amount = r2(grossOf(next[idx]) * (1 - pct / 100));
      return next;
    });
    setEditedIdx((prev) => new Set(prev).add(idx));
  };

  // Edit a line's Amount directly (to land on round figures); back-compute its
  // discount % from gross − amount and lock the line, same as a % edit.
  const setItemAmount = (idx: number, raw: string) => {
    setDraftItems((prev) => {
      if (!prev) return prev;
      const next = prev.map((x) => ({ ...x }));
      const gross = grossOf(next[idx]);
      let amt = parseFloat(raw);
      if (isNaN(amt)) amt = 0;
      amt = Math.max(0, Math.min(gross, amt));
      next[idx].amount = r2(amt);
      next[idx].discount = gross > 0 ? r2(((gross - amt) / gross) * 100) : 0;
      return next;
    });
    setEditedIdx((prev) => new Set(prev).add(idx));
  };

  // Spread the remaining discount (target − sum of the edited lines) across the
  // untouched lines, proportional to each line's gross (i.e. a uniform rate).
  // Amounts are allocated in cents with the last line absorbing the rounding
  // residual, so the total discount returns to target exactly.
  const recalibrate = () => {
    setDraftItems((prev) => {
      if (!prev) return prev;
      const next = prev.map((x) => ({ ...x }));
      const editedDiscSum = next.reduce((s, it, i) => (editedIdx.has(i) ? s + discAmtOf(it) : s), 0);
      const otherIdx = next.map((_, i) => i).filter((i) => !editedIdx.has(i));
      const otherGross = otherIdx.reduce((s, i) => s + grossOf(next[i]), 0);
      if (otherGross <= 0) {
        toast.warn("No other items to recalibrate.");
        return prev;
      }
      let remaining = targetTotalDiscount - editedDiscSum;
      if (remaining < 0) {
        remaining = 0;
        toast.warn("Edited discounts already exceed the original total — other items set to 0%.");
      } else if (remaining > otherGross) {
        remaining = otherGross;
        toast.warn("Can't fully redistribute — other items capped at 100%.");
      }
      let allocated = 0;
      otherIdx.forEach((i, k) => {
        const gross = grossOf(next[i]);
        let discAmt =
          k === otherIdx.length - 1 ? r2(remaining - allocated) : r2((remaining * gross) / otherGross);
        if (discAmt < 0) discAmt = 0;
        if (discAmt > gross) discAmt = gross;
        allocated = r2(allocated + discAmt);
        next[i].amount = r2(gross - discAmt);
        next[i].discount = gross > 0 ? r2((discAmt / gross) * 100) : 0;
      });
      return next;
    });
  };

  const resetDiscounts = () => {
    setDraftItems(order?.items ? order.items.map((i) => ({ ...i })) : null);
    setEditedIdx(new Set());
  };

  const saveDiscounts = async () => {
    if (!order || !draftItems) return;
    setSavingDiscounts(true);
    try {
      const token = await getToken();
      const res = await request(
        { path: `/orders/${order.id}/items`, method: "PATCH" },
        { items: draftItems },
        token ?? undefined,
      );
      if (res?.success || res?.data) {
        toast.success("Discounts updated");
        await fetchOrder();
      } else {
        toast.error("Failed to update discounts");
      }
    } catch (err) {
      console.error("Update order items failed:", err);
      toast.error("Failed to update discounts");
    } finally {
      setSavingDiscounts(false);
    }
  };

  // Per-row status: which doc kinds (PO/DO/INVOICE/SO) have already been
  // created and include this item. Derived from
  // order.linkedDocuments[docKind][].itemIds.
  const itemStatusFor = (itemId: number | undefined): Record<"po" | "do" | "invoice" | "salesOrder", boolean> => {
    const result = { po: false, do: false, invoice: false, salesOrder: false };
    if (itemId == null) return result;
    const ld = order?.linkedDocuments || {};
    (["po", "do", "invoice", "salesOrder"] as const).forEach((kind) => {
      const list = (ld as any)[kind] || [];
      if (list.some((d: any) => Array.isArray(d.itemIds) && d.itemIds.includes(itemId))) {
        result[kind] = true;
      }
    });
    return result;
  };

  const allChecked = visibleItems.length > 0 && selected.length === visibleItems.length;
  const someChecked = selected.length > 0 && selected.length < visibleItems.length;

  const toggleRow = (idx: number) =>
    setSelected((prev) => (prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]));
  const toggleAll = () =>
    setSelected(allChecked ? [] : visibleItems.map((it) => it._index));

  const lookupCost = (it: OrderItem): number => {
    const inv = inventories.find((i: any) =>
      i.id === it.inventoryItemId ||
      i.assetId === it.inventoryItemId ||
      i.asset?.id === it.inventoryItemId ||
      i.sku === it.itemCode,
    );
    const cost = inv?.asset?.costPrice;
    if (cost != null) return Number(cost);
    return Number(inv?.asset?.price ?? it.unitPrice ?? 0);
  };

  const handleCreateDoc = async (targetType: "PO" | "DO" | "INVOICE" | "SO") => {
    if (!order || selected.length === 0) return;
    setCreating(targetType);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Not authenticated");
        return;
      }

      // Map the button's short code to the canonical doc-type string used in
      // DocumentTemplate.type and Document.type. The templates table stores
      // 'DELIVERY_ORDER' (not 'DO'), 'INVOICE', 'PO', and 'SO'. We try a few
      // fallbacks since some orgs may have legacy 'DO'/'PURCHASE_ORDER' rows.
      const candidateTypes =
        targetType === "DO"
          ? ["DELIVERY_ORDER", "DO"]
          : targetType === "PO"
          ? ["PO", "PURCHASE_ORDER"]
          : targetType === "SO"
          ? ["SO", "SALES_ORDER"]
          : ["INVOICE"];

      let templateId: string | undefined;
      let resolvedType: string | undefined;
      for (const t of candidateTypes) {
        try {
          const r = await request(
            { path: `/documentTemplates/type/${t}`, method: "GET" },
            {},
            token,
          );
          if (r?.success && r?.data?.id) {
            templateId = r.data.id;
            resolvedType = t;
            break;
          }
        } catch {
          // 404 just means this org doesn't have that variant — keep trying.
        }
      }
      if (!templateId || !resolvedType) {
        toast.error(`No ${targetType} template found for this org`);
        return;
      }

      // Build the items payload — PO uses costPrice, DO/Invoice keep the
      // order's stored unitPrice. Tag groups are dropped on PO; for DO/INV
      // the user's selection drives what's included so tag groups aren't
      // auto-added (user must check the row to send to a doc).
      const pickedItems = visibleItems.filter((it) => selected.includes(it._index));
      const flat = pickedItems.map((it, idx) => {
        const qty = Number(it.quantity || 1);
        // Pricing rules per outbound doc:
        //   PO        — Route Order = dealer (what we pay supplier); else cost.
        //   SO/DO/INV — line unitPrice ALWAYS = list (matches what the QF
        //               quotation showed on each line). A per-line discount
        //               then collapses the line to the quote's *effective*
        //               figure, so the standard totals waterfall lands on the
        //               same Nett as the quote:
        //                 Route Order → effective per unit = dealer − points;
        //                               discount % = 1 − effective/list
        //                 Project     → discount % = the cascaded per-item %
        //                               that was set on the order at confirm
        const dealer = Number((it as any).dealerPrice) || 0;
        const pointsPerUnit = Number((it as any).points) || 0;
        const itemDiscPct = Number((it as any).discount) || 0;
        const listUnit = Number(it.unitPrice || 0);
        const isPoTarget = targetType === "PO";
        const price = isPoTarget
          ? (isRouteOrder ? (dealer || lookupCost(it)) : lookupCost(it))
          : listUnit;
        // Compute the per-line discount % that absorbs the dealer markdown
        // and points into a single number for Route Order customer-facing
        // docs. Project keeps the cascaded discount as-is.
        let carriedDiscount = 0;
        if (!isPoTarget) {
          if (isRouteOrder && listUnit > 0) {
            const effectiveUnit = Math.max(0, dealer - pointsPerUnit);
            carriedDiscount = Math.max(0, Math.min(100, (1 - effectiveUnit / listUnit) * 100));
          } else {
            carriedDiscount = itemDiscPct;
          }
        }
        const carriedAmount = isPoTarget
          ? qty * price
          : qty * price * (1 - carriedDiscount / 100);
        return {
          id: Date.now() + idx,
          itemCode: it.itemCode || "",
          inventoryItemId: it.inventoryItemId || "",
          description: it.description || "",
          uom: it.uom || "PCS",
          quantity: qty,
          unitPrice: price,
          discount: carriedDiscount,
          amount: carriedAmount,
          // Per-unit points kept on the line for audit + so a Route Order PO
          // (supplier-facing) can still render its own 'Less Points' line.
          // On SO/DO/Invoice the absorption is already in the discount above,
          // so the customer-facing preview won't double-count it.
          points: pointsPerUnit,
        };
      });

      // Create the doc
      const created = await request(
        { path: "/documents/basic", method: "POST" },
        {
          type: resolvedType,
          documentTemplateId: templateId,
          config: {
            customer: order.customer
              ? {
                  id: order.customer.id,
                  name: order.customer.name,
                  customerCode: order.customer.customerCode,
                  address: order.customer.address,
                }
              : undefined,
            customerId: order.customer?.id,
            items: flat,
            sourceOrderId: order.id,
            sourceOrderNumber: order.orderNumber,
            // Carry the order's Type so the PO editor can gate discount behavior
            // (Project: cascade top % to item discounts; Route Order: hide discounts).
            orderType: (order as any).orderType || null,
          },
        },
        token,
      );
      if (!created?.success || !created?.data?.id) {
        toast.error(`Failed to create ${targetType}`);
        return;
      }

      // Link the spawned doc back onto the order so it shows up in "Linked".
      // Carry the templateId so the chip can route directly to the doc editor,
      // and the picked item ids so we can render per-row status badges later.
      const docKind =
        targetType === "PO" ? "po"
        : targetType === "DO" ? "do"
        : targetType === "SO" ? "salesOrder"
        : "invoice";
      const itemIds = pickedItems.map((it) => it.id).filter((id) => id != null);
      await request(
        { path: `/orders/${order.id}/link`, method: "PATCH" },
        { docKind, docId: created.data.id, docName: created.data.name, templateId, itemIds },
        token,
      );
      // Optimistic local update so the badges show without waiting for refetch.
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              linkedDocuments: {
                ...(prev.linkedDocuments || {}),
                [docKind]: [
                  ...((prev.linkedDocuments as any)?.[docKind] || []),
                  { id: created.data.id, name: created.data.name, templateId, itemIds },
                ],
              },
            }
          : prev,
      );
      setSelected([]);

      toast.success(`${targetType} created from ${pickedItems.length} item(s)`);
      router.push(`/portal/documents/${resolvedType}/${templateId}/${created.data.id}`);
    } catch (err: any) {
      console.error(`Create ${targetType} from order failed:`, err);
      toast.error(err?.message || `Failed to create ${targetType}`);
    } finally {
      setCreating(null);
    }
  };

  if (loading) {
    return (
      <MainCard>
        <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
          <CircularProgress />
        </Box>
      </MainCard>
    );
  }

  if (!order) {
    return (
      <MainCard>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <IconButton onClick={() => router.push("/portal/orders")}><ArrowBackIcon /></IconButton>
          <Typography>Order not found.</Typography>
        </Stack>
      </MainCard>
    );
  }

  return (
    <MainCard>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <IconButton onClick={() => router.push("/portal/orders")} size="small">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6">{order.orderNumber}</Typography>
        <Chip
          size="small"
          label={(order.status || "DRAFT").replace(/_/g, " ")}
          color={statusColor(order.status) as any}
          sx={{ textTransform: "capitalize" }}
        />
      </Stack>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Stack direction="row" spacing={4} flexWrap="wrap">
            <Box>
              <Typography variant="caption" color="text.secondary">Customer</Typography>
              <Typography variant="body2">{order.customer?.name || "—"}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">From Quotation</Typography>
              {order.sourceQuotation ? (
                <Button
                  size="small"
                  variant="text"
                  endIcon={<OpenInNewIcon fontSize="inherit" />}
                  onClick={() => {
                    const sq = order.sourceQuotation!;
                    const tmplId = sq.documentTemplateId;
                    if (!tmplId) {
                      toast.error("Cannot open quotation: missing template id");
                      return;
                    }
                    router.push(`/portal/documents/${sq.type || "QUOTATION"}/${tmplId}/${sq.id}`);
                  }}
                  sx={{ p: 0, justifyContent: "flex-start", textTransform: "none" }}
                >
                  {order.sourceQuotation.name}
                </Button>
              ) : (
                <Typography variant="body2">—</Typography>
              )}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Type</Typography>
              {(order as any).orderType ? (
                <Box sx={{ mt: 0.25 }}>
                  <Chip size="small" variant="outlined" label={(order as any).orderType} />
                </Box>
              ) : (
                <Typography variant="body2">—</Typography>
              )}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Created</Typography>
              <Typography variant="body2">{moment(order.createdAt).format("DD/MM/YYYY HH:mm")}</Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Items table */}
      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
        Items ({visibleItems.length})
      </Typography>
      <TableContainer sx={{ mb: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40, p: 0 }}>
                <Checkbox size="small" checked={allChecked} indeterminate={someChecked} onChange={toggleAll} />
              </TableCell>
              <TableCell>Code</TableCell>
              <TableCell align="center">Category</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="center">Qty</TableCell>
              <TableCell align="right">Unit Price</TableCell>
              {isProject && <TableCell align="center">Discount</TableCell>}
              <TableCell align="right">Amount</TableCell>
              {isRouteOrder && <TableCell align="center">Points</TableCell>}
              <TableCell align="center">Tagged</TableCell>
              <TableCell align="center">Ver. DO</TableCell>
              <TableCell align="center">Ver. INV</TableCell>
              <TableCell align="center">Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={11 + (isRouteOrder ? 1 : 0) + (isProject ? 1 : 0)}>
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                    No items in this order.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((it) => (
              <TableRow key={it._index} hover sx={it.isTagGroup ? { bgcolor: "action.hover" } : undefined}>
                <TableCell sx={{ p: 0, textAlign: "center" }}>
                  <Checkbox size="small" checked={selected.includes(it._index)} onChange={() => toggleRow(it._index)} />
                </TableCell>
                <TableCell>
                  {it.itemCode || "—"}
                  {it.isTagGroup && (
                    <Chip
                      size="small"
                      label="Tag"
                      variant="outlined"
                      sx={{ ml: 1, height: 18, fontSize: "0.65rem" }}
                    />
                  )}
                </TableCell>
                <TableCell align="center">
                  {it.category ? (
                    <Chip size="small" variant="outlined" label={it.category} sx={{ height: 20, fontSize: "0.7rem" }} />
                  ) : (
                    <Typography variant="caption" color="text.disabled">—</Typography>
                  )}
                </TableCell>
                <TableCell>{it.description || "—"}</TableCell>
                <TableCell align="center">{it.quantity ?? "—"}</TableCell>
                <TableCell align="right">{(it.unitPrice ?? 0).toFixed(2)}</TableCell>
                {isProject && (
                  <TableCell align="center">
                    <TextField
                      type="number"
                      size="small"
                      value={it.discount ?? 0}
                      onChange={(e) => setItemDiscount(it._index, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      inputProps={{ min: 0, max: 100, step: 0.01, style: { textAlign: "right", width: 52, padding: "4px 6px" } }}
                      InputProps={{ endAdornment: <Typography variant="caption" sx={{ ml: 0.25 }}>%</Typography> }}
                      sx={{ width: 88 }}
                    />
                  </TableCell>
                )}
                <TableCell align="right">
                  {isProject ? (
                    <TextField
                      type="number"
                      size="small"
                      value={it.amount ?? 0}
                      onChange={(e) => setItemAmount(it._index, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      inputProps={{ min: 0, step: 0.01, style: { textAlign: "right", width: 84, padding: "4px 6px" } }}
                      sx={{ width: 108 }}
                    />
                  ) : (
                    (it.amount ?? 0).toFixed(2)
                  )}
                </TableCell>
                {isRouteOrder && <TableCell align="center">{(Number(it.points) || 0) * (Number(it.quantity) || 0)}</TableCell>}
                <TableCell align="center">
                  {it.isTagGroup ? (
                    <Typography variant="caption" color="text.disabled">—</Typography>
                  ) : it.taggedAssetCode ? (
                    <Chip size="small" label={it.taggedAssetCode} />
                  ) : (
                    <Typography variant="caption" color="text.disabled">—</Typography>
                  )}
                </TableCell>
                <TableCell align="center">
                  <VerifiedCell stamp={it.verifiedDo} />
                </TableCell>
                <TableCell align="center">
                  <VerifiedCell stamp={it.verifiedInv} />
                </TableCell>
                <TableCell align="center">
                  {(() => {
                    const s = itemStatusFor(it.id as number | undefined);
                    const any = s.po || s.do || s.invoice || s.salesOrder;
                    if (!any) return <Typography variant="caption" color="text.disabled">—</Typography>;
                    return (
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        {s.salesOrder && <Chip size="small" color="warning" variant="outlined" label="SO" />}
                        {s.po && <Chip size="small" color="success" variant="outlined" label="PO" />}
                        {s.do && <Chip size="small" color="info" variant="outlined" label="DO" />}
                        {s.invoice && <Chip size="small" color="primary" variant="outlined" label="INV" />}
                      </Stack>
                    );
                  })()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Route Order: total points across all lines (points × qty). */}
      {isRouteOrder && (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1, mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Total Points:&nbsp;
            {visibleItems.reduce((sum, it) => sum + (Number(it.points) || 0) * (Number(it.quantity) || 0), 0)}
          </Typography>
        </Box>
      )}

      {/* Project Order: editable per-item discount. The total discount amount is
          fixed (set when the quotation was confirmed); editing one line's rate
          diverges the total and surfaces "Recalibrate" to rebalance the rest. */}
      {isProject && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mt: 1,
            mb: 2,
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            {diverged && hasOtherItems && (
              <Button size="small" variant="outlined" onClick={recalibrate}>
                Recalibrate discount for other items
              </Button>
            )}
            {dirty && (
              <Button size="small" variant="contained" onClick={saveDiscounts} disabled={savingDiscounts}>
                {savingDiscounts ? "Saving…" : "Save discounts"}
              </Button>
            )}
            {dirty && (
              <Button size="small" color="inherit" onClick={resetDiscounts} disabled={savingDiscounts}>
                Reset
              </Button>
            )}
          </Stack>
          <Box sx={{ textAlign: "right" }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Total Discount:&nbsp;{currency} {currentTotalDiscount.toFixed(2)}
            </Typography>
            {diverged ? (
              <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
                Target {currency} {targetTotalDiscount.toFixed(2)} — click Recalibrate to rebalance
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                Net total {currency} {(visibleItems.reduce((s, it) => s + grossOf(it), 0) - currentTotalDiscount).toFixed(2)}
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Action buttons */}
      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Typography variant="body2" sx={{ alignSelf: "center", mr: 1 }}>
          {selected.length} selected →
        </Typography>
        <Button
          variant="outlined"
          startIcon={<AssignmentIcon />}
          onClick={() => handleCreateDoc("SO")}
          disabled={selected.length === 0 || !!creating}
        >
          {creating === "SO" ? "Creating…" : "Create SO from selected"}
        </Button>
        <Button
          variant="outlined"
          startIcon={<ShoppingCartIcon />}
          onClick={() => handleCreateDoc("PO")}
          disabled={selected.length === 0 || !!creating}
        >
          {creating === "PO" ? "Creating…" : "Create PO from selected"}
        </Button>
        <Button
          variant="outlined"
          startIcon={<LocalShippingIcon />}
          onClick={() => handleCreateDoc("DO")}
          disabled={selected.length === 0 || !!creating}
        >
          {creating === "DO" ? "Creating…" : "Create DO from selected"}
        </Button>
        <Button
          variant="contained"
          startIcon={<ReceiptIcon />}
          onClick={() => handleCreateDoc("INVOICE")}
          disabled={selected.length === 0 || !!creating}
        >
          {creating === "INVOICE" ? "Creating…" : "Create Invoice from selected"}
        </Button>
      </Stack>

      <Divider sx={{ mb: 2 }} />

      {/* Linked documents */}
      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>Linked Documents</Typography>
      {(["salesOrder", "po", "do", "invoice"] as const).map((kind) => {
        const list = (order.linkedDocuments as any)?.[kind] || [];
        if (list.length === 0) return null;
        const labelMap = {
          salesOrder: "Sales Orders",
          po: "Purchase Orders",
          do: "Delivery Orders",
          invoice: "Invoices",
        } as const;
        return (
          <Box key={kind} sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{labelMap[kind]}</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
              {list.map((d: any) => (
                <Chip
                  key={d.id}
                  size="small"
                  label={d.name}
                  variant="outlined"
                  clickable
                  onClick={() => {
                    const type =
                      kind === "po" ? "PO"
                      : kind === "do" ? "DO"
                      : kind === "salesOrder" ? "SO"
                      : "INVOICE";
                    if (!d.templateId) {
                      toast.error("Cannot open doc: missing template id");
                      return;
                    }
                    router.push(`/portal/documents/${type}/${d.templateId}/${d.id}`);
                  }}
                />
              ))}
            </Stack>
          </Box>
        );
      })}
      {!order.linkedDocuments?.po?.length &&
        !order.linkedDocuments?.do?.length &&
        !order.linkedDocuments?.invoice?.length &&
        !(order.linkedDocuments as any)?.salesOrder?.length && (
          <Typography variant="caption" color="text.disabled">No documents created from this order yet.</Typography>
        )}

      {/* Supplier uploads — DOs / Invoices reconciled against this order via
          the upload-and-verify flow. Per-line stamps carry the same fileKey
          for the doc they came from, so we dedupe by fileKey to show each
          upload once. */}
      <SupplierUploadsSection items={order.items || []} />
    </MainCard>
  );
}

/**
 * Lists every supplier DO / Invoice uploaded against this order. Reads stamps
 * off the items array, dedupes by fileKey, and renders one clickable chip per
 * upload. Clicking mints a signed S3 URL and opens the file in a new tab.
 */
function SupplierUploadsSection({ items }: { items: OrderItem[] }) {
  const { getToken } = useAuth();
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  const uploads = useMemo(() => {
    const byKey = new Map<string, { kind: "do" | "invoice"; stamp: VerifiedStamp }>();
    for (const it of items || []) {
      for (const k of ["verifiedDo", "verifiedInv"] as const) {
        const stamp = (it as any)[k] as VerifiedStamp | undefined;
        if (!stamp?.fileKey || byKey.has(stamp.fileKey)) continue;
        byKey.set(stamp.fileKey, { kind: k === "verifiedDo" ? "do" : "invoice", stamp });
      }
    }
    return Array.from(byKey.values());
  }, [items]);

  if (uploads.length === 0) return null;

  const openFile = async (stamp: VerifiedStamp) => {
    if (!stamp.fileKey || openingKey) return;
    setOpeningKey(stamp.fileKey);
    try {
      const token = await getToken();
      const res = await request(
        { path: `/orders/supplier-doc-url?key=${encodeURIComponent(stamp.fileKey)}`, method: "GET" },
        {},
        token ?? undefined,
      );
      const url: string | undefined = res?.data?.url ?? res?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast.error("Couldn't get a download link for that file");
    } catch (err) {
      console.error("Supplier doc download failed:", err);
      toast.error("Couldn't open the file");
    } finally {
      setOpeningKey(null);
    }
  };

  const grouped = {
    do: uploads.filter((u) => u.kind === "do"),
    invoice: uploads.filter((u) => u.kind === "invoice"),
  };
  const labelMap = { do: "Delivery Orders (supplier)", invoice: "Invoices (supplier)" } as const;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>Supplier Uploads</Typography>
      {(["do", "invoice"] as const).map((kind) => {
        const list = grouped[kind];
        if (list.length === 0) return null;
        return (
          <Box key={kind} sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">{labelMap[kind]}</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap" }}>
              {list.map((u) => {
                const s = u.stamp;
                const label = [s.supplier, s.docNumber].filter(Boolean).join(" · ") || s.originalName || "Supplier doc";
                const busy = openingKey === s.fileKey;
                return (
                  <Tooltip key={s.fileKey || label} arrow title={`${label}${s.date ? ` · ${s.date}` : ""} — click to download`}>
                    <Chip
                      size="small"
                      label={busy ? "…" : label}
                      variant="outlined"
                      color="success"
                      icon={<CheckCircleIcon />}
                      clickable
                      onClick={() => openFile(s)}
                    />
                  </Tooltip>
                );
              })}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * One-cell render for a verifiedDo / verifiedInv stamp. ✓ chip when the line
 * was reconciled against a supplier doc; hovering shows doc no. + date.
 * Clicking opens the saved supplier file (a signed S3 URL minted on demand)
 * in a new tab so the user can re-download whenever they need it.
 */
/**
 * Per-row passive ✓ indicator. Downloads live in the Supplier Uploads
 * section at the bottom of the page (one chip per upload, deduped) so this
 * cell just summarises the per-line reconciliation: solid green when SKU +
 * qty + price all matched, amber Verified ⚠ when qty matched but price /
 * amount diverged (with the deltas in the tooltip).
 */
function VerifiedCell({ stamp }: { stamp?: VerifiedStamp | null }) {
  if (!stamp) return <Typography variant="caption" color="text.disabled">—</Typography>;
  const hasMismatch = stamp.lineStatus === "mismatch";
  const tip = (
    <>
      {stamp.supplier && <div>{stamp.supplier}</div>}
      {stamp.docNumber && <div>Doc no.&nbsp;{stamp.docNumber}</div>}
      {stamp.date && <div>{stamp.date}</div>}
      {hasMismatch && (
        <>
          <div style={{ marginTop: 4, color: "#ffb74d", fontWeight: 600 }}>Price mismatch</div>
          {stamp.supplierUnitPrice != null && (
            <div>Supplier unit&nbsp;{Number(stamp.supplierUnitPrice).toFixed(2)}</div>
          )}
          {stamp.supplierAmount != null && (
            <div>Supplier amount&nbsp;{Number(stamp.supplierAmount).toFixed(2)}</div>
          )}
          {stamp.mismatchNotes && (
            <div style={{ opacity: 0.85, fontSize: "0.7rem", marginTop: 2 }}>{stamp.mismatchNotes}</div>
          )}
        </>
      )}
      {stamp.at && <div style={{ opacity: 0.7, fontSize: "0.7rem", marginTop: 2 }}>verified {new Date(stamp.at).toLocaleString()}</div>}
    </>
  );

  return (
    <Tooltip arrow title={tip}>
      <Chip
        size="small"
        color={hasMismatch ? "warning" : "success"}
        variant={hasMismatch ? "outlined" : "filled"}
        icon={hasMismatch ? <WarningAmberIcon /> : <CheckCircleIcon />}
        label={hasMismatch ? "Verified ⚠" : "Verified"}
        sx={{ height: 22, "& .MuiChip-icon": { ml: "4px", fontSize: 14 } }}
      />
    </Tooltip>
  );
}
