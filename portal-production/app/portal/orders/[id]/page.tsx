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
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ReceiptIcon from "@mui/icons-material/Receipt";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
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
  uom?: string;
  amount?: number;
  isTagGroup?: boolean;
  tagGroupId?: string;
  taggedAssetId?: string;
  taggedAssetCode?: string;
  taggedAssetName?: string;
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
  const [creating, setCreating] = useState<null | "PO" | "DO" | "INVOICE">(null);

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

  // Tagged CUs are also line items in the order — surface them as their own
  // rows in the table so the user can select + convert them to PO/DO/Invoice
  // independently from the FCU rows that reference them.
  const visibleItems = useMemo(
    () => (order?.items || []).map((it, idx) => ({ ...it, _index: idx })),
    [order?.items],
  );

  // Per-row status: which doc kinds (PO/DO/INVOICE) have already been created
  // and include this item. Derived from order.linkedDocuments[docKind][].itemIds.
  const itemStatusFor = (itemId: number | undefined): Record<"po" | "do" | "invoice", boolean> => {
    const result = { po: false, do: false, invoice: false };
    if (itemId == null) return result;
    const ld = order?.linkedDocuments || {};
    (["po", "do", "invoice"] as const).forEach((kind) => {
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

  const handleCreateDoc = async (targetType: "PO" | "DO" | "INVOICE") => {
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
      // 'DELIVERY_ORDER' (not 'DO'), 'INVOICE', and 'PO'. We also try a few
      // fallbacks since some orgs may have legacy 'DO'/'PURCHASE_ORDER' rows.
      const candidateTypes =
        targetType === "DO"
          ? ["DELIVERY_ORDER", "DO"]
          : targetType === "PO"
          ? ["PO", "PURCHASE_ORDER"]
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
        const price = targetType === "PO" ? lookupCost(it) : Number(it.unitPrice || 0);
        return {
          id: Date.now() + idx,
          itemCode: it.itemCode || "",
          inventoryItemId: it.inventoryItemId || "",
          description: it.description || "",
          uom: it.uom || "PCS",
          quantity: qty,
          unitPrice: price,
          discount: 0,
          amount: qty * price,
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
      const docKind = targetType === "PO" ? "po" : targetType === "DO" ? "do" : "invoice";
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
              <TableCell>Description</TableCell>
              <TableCell align="center">Qty</TableCell>
              <TableCell align="right">Unit Price</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="center">Tagged</TableCell>
              <TableCell align="center">Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
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
                <TableCell>{it.description || "—"}</TableCell>
                <TableCell align="center">{it.quantity ?? "—"}</TableCell>
                <TableCell align="right">{(it.unitPrice ?? 0).toFixed(2)}</TableCell>
                <TableCell align="right">{(it.amount ?? 0).toFixed(2)}</TableCell>
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
                  {(() => {
                    const s = itemStatusFor(it.id as number | undefined);
                    const any = s.po || s.do || s.invoice;
                    if (!any) return <Typography variant="caption" color="text.disabled">—</Typography>;
                    return (
                      <Stack direction="row" spacing={0.5} justifyContent="center">
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

      {/* Action buttons */}
      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Typography variant="body2" sx={{ alignSelf: "center", mr: 1 }}>
          {selected.length} selected →
        </Typography>
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
      {(["po", "do", "invoice"] as const).map((kind) => {
        const list = order.linkedDocuments?.[kind] || [];
        if (list.length === 0) return null;
        const labelMap = { po: "Purchase Orders", do: "Delivery Orders", invoice: "Invoices" } as const;
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
                    const type = kind === "po" ? "PO" : kind === "do" ? "DO" : "INVOICE";
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
        !order.linkedDocuments?.invoice?.length && (
          <Typography variant="caption" color="text.disabled">No documents created from this order yet.</Typography>
        )}
    </MainCard>
  );
}
