"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import NfcIcon from "@mui/icons-material/Nfc";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import HandymanIcon from "@mui/icons-material/Handyman";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import EditNoteIcon from "@mui/icons-material/EditNote";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import { useNfcScan } from "../../../hooks/useNfcScan";

/**
 * Standalone-delivery BASKET (Layer 3 + in-basket scanning patch).
 *
 * Every item is independently actionable through its own lifecycle:
 *   not_delivered → [Start delivery] → delivering → [Acknowledge]
 *   → not_installed → [Complete installation | Install not needed] → completed
 * (The Start button is Fix B — items added before the DO_START-on-add fix, or
 * whose auto-start failed, are unsticked with one tap.)
 *
 * Units are added IN the basket: inline NFC scan (useNfcScan — native or Web
 * NFC) or a manual-serial dialog (field-resolve, assetId optional). Every
 * add/start goes through a MANDATORY condition-photo step first (same
 * evidence rule as the run's first unit on the delivery-start page): resolve
 * unit → photo dialog → POST /deliveries/:id/items → DO_START with the photo
 * keys. The old route-out via /scan remains as a fallback for browsers
 * without Web NFC.
 */

type ItemStatus = "not_delivered" | "delivering" | "not_installed" | "completed";

interface RunItem {
  id: string;
  assetId: string;
  inventoryId: string | null;
  description: string | null;
  quantity: number;
  deliveryStatus: ItemStatus;
  installSkipped: boolean;
  documentId: string | null;
  document: { id: string; name: string | null } | null;
  inventory: { id: string; sku: string; serialNumber: string | null; status: string } | null;
  asset: { id: string; name: string; skuKey: string } | null;
}

interface Run {
  id: string;
  deliveryNumber: number;
  status: "in_progress" | "delivered" | "completed" | "cancelled";
  riderName: string | null;
  siteAddress: string | null;
  startedAt: string;
  // Derived by the backend: the single distinct DO across linked items, else null.
  document: { id: string; name: string | null } | null;
  items: RunItem[];
  // MSR proof rows (findById returns them) — used to resume the reordered
  // ack flow: a draft DO_ACK for a delivering unit routes to after-ack.
  reports?: Array<{ id: string; kind: string; status: string; inventoryId: string | null }>;
}

interface ResolveMatch {
  inventoryId: string;
  assetId: string;
  sku: string;
  assetName?: string | null;
  skuKey?: string | null;
}

const STATUS_CHIP: Record<ItemStatus, { label: string; color: "default" | "warning" | "info" | "success" }> = {
  not_delivered: { label: "Not delivered", color: "default" },
  delivering: { label: "Delivering", color: "warning" },
  not_installed: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
};

const RUN_STATUS_LABEL: Record<Run["status"], string> = {
  in_progress: "In progress",
  delivered: "Delivered — awaiting installation",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function DeliveryBasketPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const nfc = useNfcScan();
  const deliveryId = params?.deliveryId as string;
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Inline add/start feedback (reservation 400s, unknown tag, dup-in-run…)
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Manual-serial dialog
  const [manualOpen, setManualOpen] = useState(false);
  const [serial, setSerial] = useState("");
  const [resolving, setResolving] = useState(false);
  const [candidates, setCandidates] = useState<ResolveMatch[] | null>(null);
  // Free-typed line dialog: not in the catalog — a description-only record the
  // office resolves to a real asset/unit later. No reservation, no unit.
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeDesc, setFreeDesc] = useState("");
  const [freeQty, setFreeQty] = useState("1");
  // Mandatory condition-photo step: a resolved unit parks here until the
  // rider captures ≥1 photo. mode 'add' = new unit (add + start); mode
  // 'start' = existing not_delivered item (Fix B start only).
  // mode 'add' = new unit (add + start); 'start' = existing not_delivered item
  // (Fix B start only); 'photos' = append condition photos to an already-started
  // unit's DO_START (no new report).
  const [pending, setPending] = useState<{ mode: "add" | "start" | "photos"; assetId: string; inventoryId: string; sku?: string } | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<CapturedPhoto[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  // Guards double-handling the same NFC read (uid persists until next startScan)
  const handledUidRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setError("Not signed in");
        return;
      }
      const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
      if (res.success === false) setError(res.message ?? "Delivery not found");
      else setRun(res.data ?? res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load delivery");
    } finally {
      setLoading(false);
    }
  }, [deliveryId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Clerk-auth'd upload closure for the photo dialog (folder: do-start —
  // same bucket location as the run's first unit on the delivery-start page).
  const uploadDoStart = useCallback(
    async (blob: Blob): Promise<string | null> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      return uploadImage({ blob, folderName: "do-start", token });
    },
    [getToken],
  );

  // Fire a unit's DO_START with its condition photos (advances
  // not_delivered → delivering). Photos are REQUIRED — the backend rejects a
  // standalone DO_START without them.
  const startUnit = useCallback(
    async (assetId: string, inventoryId: string, token: string, photoKeys: string[]) => {
      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          inventoryId,
          kind: "DO_START",
          deliveryId,
          description: "Delivery started (added to run)",
          photos: photoKeys,
        },
        token,
      );
      if (res.success === false) throw new Error(res.message ?? "Failed to start delivery for this unit");
    },
    [deliveryId],
  );

  // A resolved unit parks in the mandatory photo step (NFC + manual + Fix B
  // all funnel here). The item is only added/started AFTER the photo confirm.
  const requestAdd = useCallback((assetId: string, inventoryId: string, sku?: string) => {
    setPendingPhotos([]);
    setPending({ mode: "add", assetId, inventoryId, sku });
  }, []);

  const requestStart = useCallback((it: RunItem) => {
    if (!it.inventoryId) return;
    setPendingPhotos([]);
    setPending({ mode: "start", assetId: it.assetId, inventoryId: it.inventoryId, sku: it.inventory?.sku });
  }, []);

  // Append more condition photos to an already-started unit's DO_START.
  const requestPhotos = useCallback((it: RunItem) => {
    if (!it.inventoryId) return;
    setPendingPhotos([]);
    setPending({ mode: "photos", assetId: it.assetId, inventoryId: it.inventoryId, sku: it.inventory?.sku });
  }, []);

  // Photo confirmed → add (mode 'add') then DO_START; or (mode 'photos') append
  // to the existing DO_START without creating a new report.
  const confirmPending = useCallback(async () => {
    if (!pending) return;
    if (pendingPhotos.length === 0) {
      setActionMsg("Take at least one photo of the unit.");
      return;
    }
    setBusy(true);
    setActionMsg(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      if (pending.mode === "photos") {
        const res = await request(
          { path: `/deliveries/${deliveryId}/items/photos`, method: "POST" },
          { inventoryId: pending.inventoryId, photos: pendingPhotos.map((p) => p.key) },
          token,
        );
        if (res.success === false) throw new Error(res.message ?? "Could not add photos");
        setActionMsg(pending.sku ? `Photos added to ${pending.sku} ✓` : "Photos added ✓");
        setPending(null);
        setPendingPhotos([]);
        await load();
        return;
      }
      if (pending.mode === "add") {
        const res = await request(
          { path: `/deliveries/${deliveryId}/items`, method: "POST" },
          { assetId: pending.assetId, inventoryId: pending.inventoryId },
          token,
        );
        if (res.success === false) throw new Error(res.message ?? "Could not add unit");
      }
      await startUnit(pending.assetId, pending.inventoryId, token, pendingPhotos.map((p) => p.key));
      setActionMsg(pending.sku ? `${pending.sku} added ✓` : "Unit added ✓");
      setPending(null);
      setPendingPhotos([]);
      await load();
    } catch (e: any) {
      setActionMsg(e?.message ?? "Unit not available — already out for delivery");
      // 'add' failures: nothing was created, close the photo step. A failed
      // DO_START after a successful add leaves the item with its own Start
      // button (which re-runs the photo step).
      setPending(null);
      setPendingPhotos([]);
      await load();
    } finally {
      setBusy(false);
    }
  }, [pending, pendingPhotos, deliveryId, getToken, load, startUnit]);

  // #3 fallback: rider decides installation isn't needed from the basket.
  const skipInstall = useCallback(
    async (it: RunItem) => {
      if (!it.inventoryId) return;
      setBusy(true);
      setActionMsg(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request(
          { path: `/deliveries/${deliveryId}/items/skip-install`, method: "POST" },
          { inventoryId: it.inventoryId },
          token,
        );
        if (res.success === false) throw new Error(res.message ?? "Could not skip installation");
        await load();
      } catch (e: any) {
        setActionMsg(e?.message ?? "Could not skip installation");
      } finally {
        setBusy(false);
      }
    },
    [deliveryId, getToken, load],
  );

  // Mark a FREE-TYPED line delivered (no unit to scan). One tap → completed,
  // keyed by DeliveryItem.id; the backend rejects any row carrying a unit.
  const markDelivered = useCallback(
    async (it: RunItem) => {
      setBusy(true);
      setActionMsg(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request(
          { path: `/deliveries/${deliveryId}/items/${it.id}/deliver`, method: "POST" },
          {},
          token,
        );
        if (res.success === false) throw new Error(res.message ?? "Could not mark delivered");
        setActionMsg(`"${it.description || "Item"}" delivered ✓`);
        await load();
      } catch (e: any) {
        setActionMsg(e?.message ?? "Could not mark delivered");
      } finally {
        setBusy(false);
      }
    },
    [deliveryId, getToken, load],
  );

  // Inline NFC: observe scanned uid → resolve to a unit → add. The hook resets
  // uid on each startScan, and auto-stops after one read.
  useEffect(() => {
    const uid = nfc.uid;
    if (!uid || uid === handledUidRef.current) return;
    handledUidRef.current = uid;
    (async () => {
      setBusy(true);
      setActionMsg(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request(
          { path: `/assets/by-nfc-uid/${encodeURIComponent(uid)}`, method: "GET" },
          {},
          token,
        );
        const payload = res.data ?? res;
        const assetId = payload?.asset?.id;
        const inventoryId = payload?.inventory?.id;
        if (!assetId || !inventoryId) {
          setActionMsg("Tag isn't bound to a unit — bind it from the scan page first.");
          return;
        }
        // Park the unit in the mandatory photo step (adds + starts on confirm).
        requestAdd(assetId, inventoryId, payload?.inventory?.sku);
        return;
      } catch (e: any) {
        const status = e?.response?.status ?? e?.status;
        setActionMsg(status === 404 ? "Tag isn't bound to a unit — bind it from the scan page first." : e?.message ?? "Tag lookup failed");
      } finally {
        setBusy(false);
      }
    })();
  }, [nfc.uid, requestAdd, getToken]);

  // Manual serial resolve (assetId optional — org-wide serial match).
  const resolveSerial = async () => {
    const q = serial.trim();
    if (!q) return;
    setResolving(true);
    setCandidates(null);
    setActionMsg(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/inventories/field-resolve?serial=${encodeURIComponent(q)}`, method: "GET" },
        {},
        token,
      );
      const matches: ResolveMatch[] = (res?.data ?? res)?.matches ?? [];
      if (matches.length === 0) {
        setActionMsg(`No unit found for "${q}" — check the serial.`);
      } else if (matches.length === 1) {
        setManualOpen(false);
        setSerial("");
        requestAdd(matches[0].assetId, matches[0].inventoryId, matches[0].sku);
      } else {
        setCandidates(matches); // pick list inside the dialog
      }
    } catch (e: any) {
      setActionMsg(e?.message ?? "Lookup failed");
    } finally {
      setResolving(false);
    }
  };

  // Add a FREE-TYPED line — no catalog asset, no unit. A description-only record
  // the office resolves later. POST /items with { description, quantity } only.
  const addFreeItem = async () => {
    const description = freeDesc.trim();
    if (!description) return;
    const quantity = Math.max(1, parseInt(freeQty, 10) || 1);
    setBusy(true);
    setActionMsg(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${deliveryId}/items`, method: "POST" },
        { description, quantity },
        token,
      );
      if (res.success === false) throw new Error(res.message ?? "Could not add item");
      setActionMsg(`"${description}" added ✓`);
      setFreeOpen(false);
      setFreeDesc("");
      setFreeQty("1");
      await load();
    } catch (e: any) {
      setActionMsg(e?.message ?? "Could not add item");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !run) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error ?? "Could not load delivery"}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  const ackHref = (it: RunItem) =>
    `/scan/delivery/${run.id}/ack?assetId=${encodeURIComponent(it.assetId)}${it.inventoryId ? `&inventoryId=${encodeURIComponent(it.inventoryId)}` : ""}`;
  const afterAckHref = (it: RunItem) =>
    `/scan/delivery/${run.id}/after-ack?assetId=${encodeURIComponent(it.assetId)}${it.inventoryId ? `&inventoryId=${encodeURIComponent(it.inventoryId)}` : ""}`;
  const installHref = (it: RunItem) =>
    `/scan/delivery/${run.id}/install?assetId=${encodeURIComponent(it.assetId)}${it.inventoryId ? `&inventoryId=${encodeURIComponent(it.inventoryId)}` : ""}`;
  // Reordered flow resume: a delivering unit with an UNSIGNED DO_ACK is
  // mid-flow (ack captured, signature pending) → Continue into after-ack.
  const hasDraftAck = (it: RunItem) =>
    !!it.inventoryId &&
    (run.reports ?? []).some(
      (r) => r.kind === "DO_ACK" && r.status !== "completed" && r.inventoryId === it.inventoryId,
    );

  // Adding is open only while the run is in progress AND nothing has been
  // handed over yet. "Handed over" = acknowledged, i.e. deliveryStatus
  // not_installed (delivered, awaiting install) or completed. We deliberately
  // do NOT count `delivering`: units auto-fire DO_START on add, so every added
  // unit is immediately delivering — gating on that would block multi-unit
  // baskets after the first scan. Once one unit reaches the customer, the run
  // is closed to additions.
  const anyAcknowledged = run.items.some(
    (it) => it.deliveryStatus === "not_installed" || it.deliveryStatus === "completed",
  );
  const canAdd = run.status === "in_progress" && !anyAcknowledged;

  // Unbound office-scheduled slots (assetId set, no unit yet) = a merged
  // scheduled run's remaining quantity. Render them as a per-asset "remaining to
  // load" summary instead of dead per-slot cards; scanning a matching unit fills
  // the next slot (the backend's addItem is slot-aware).
  const unboundSlots = run.items.filter((it) => it.assetId && !it.inventoryId);
  const visibleItems = run.items.filter((it) => !(it.assetId && !it.inventoryId));
  const scheduledSummary = (() => {
    if (unboundSlots.length === 0) return [] as Array<{ assetId: string; label: string; scheduled: number; delivered: number; remaining: number }>;
    const byAsset = new Map<string, { label: string; remaining: number; delivered: number }>();
    for (const s of unboundSlots) {
      const cur = byAsset.get(s.assetId!) ?? {
        label: s.asset?.skuKey || s.asset?.name || s.description || "Unit",
        remaining: 0,
        delivered: 0,
      };
      cur.remaining += s.quantity ?? 1;
      byAsset.set(s.assetId!, cur);
    }
    // "delivered" = units of that asset already bound onto the run.
    for (const it of run.items) {
      if (it.assetId && it.inventoryId && byAsset.has(it.assetId)) byAsset.get(it.assetId)!.delivered += 1;
    }
    return Array.from(byAsset, ([assetId, v]) => ({
      assetId,
      label: v.label,
      remaining: v.remaining,
      delivered: v.delivered,
      scheduled: v.delivered + v.remaining,
    }));
  })();

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <LocalShippingIcon color="primary" sx={{ fontSize: 44 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>Delivery #{run.deliveryNumber}</Typography>
          <Typography variant="body2" color="text.secondary">
            {RUN_STATUS_LABEL[run.status]}
            {(() => {
              // Per-item linking: items may span DOs. Single DO → its name;
              // several → a count; none → the old "no DO yet".
              const distinct = Array.from(
                new Map(run.items.filter((i) => i.document).map((i) => [i.document!.id, i.document!])).values(),
              );
              if (distinct.length === 0) return " · no DO yet";
              if (distinct.length === 1) return ` · DO ${distinct[0].name ?? ""}`;
              return ` · ${distinct.length} DOs`;
            })()}
          </Typography>
        </Box>
      </Stack>

      {actionMsg && (
        <Alert
          severity={actionMsg.endsWith("✓") ? "success" : "warning"}
          onClose={() => setActionMsg(null)}
        >
          {actionMsg}
        </Alert>
      )}
      {nfc.error && <Alert severity="warning">{nfc.error}</Alert>}

      <Typography variant="subtitle1" fontWeight={600}>
        Items ({visibleItems.length})
      </Typography>
      <Stack spacing={1}>
        {visibleItems.map((it) => {
          const chip = STATUS_CHIP[it.deliveryStatus] ?? { label: it.deliveryStatus, color: "default" as const };
          return (
            <Card key={it.id} variant="outlined">
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {it.description || it.asset?.name || it.inventory?.sku || "Item"}
                    </Typography>
                    {it.inventory?.sku && (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {it.inventory.sku}
                      </Typography>
                    )}
                  </Box>
                  <Chip size="small" label={chip.label} color={chip.color} />
                </Stack>
                {it.deliveryStatus !== "completed" && (
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
                    {/* Free-typed line (no unit to scan): one tap → completed.
                        Full delivery participant — the run won't complete until
                        it's marked. Available whenever the run is live, unlike
                        the unit Start/Ack buttons that gate on inventoryId. */}
                    {!it.inventoryId && !it.assetId && it.deliveryStatus === "not_delivered" && run.status !== "cancelled" && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<LocalShippingIcon />}
                        onClick={() => markDelivered(it)}
                        disabled={busy}
                        sx={{ minHeight: 40 }}
                      >
                        Mark delivered
                      </Button>
                    )}
                    {/* Fix B: not-yet-started items get their own Start action —
                        every item is independently actionable regardless of
                        scan order. */}
                    {it.deliveryStatus === "not_delivered" && it.inventoryId && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<PlayArrowIcon />}
                        onClick={() => requestStart(it)}
                        disabled={busy}
                        sx={{ minHeight: 40 }}
                      >
                        Start delivery
                      </Button>
                    )}
                    {it.deliveryStatus === "delivering" && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<LocalShippingIcon />}
                        onClick={() => router.push(hasDraftAck(it) ? afterAckHref(it) : ackHref(it))}
                        sx={{ minHeight: 40 }}
                      >
                        {hasDraftAck(it) ? "Continue" : "Acknowledge"}
                      </Button>
                    )}
                    {it.deliveryStatus === "not_installed" && (
                      <>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<HandymanIcon />}
                          onClick={() => router.push(installHref(it))}
                          sx={{ minHeight: 40 }}
                        >
                          Complete installation
                        </Button>
                        {it.inventoryId && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => skipInstall(it)}
                            disabled={busy}
                            sx={{ minHeight: 40, color: "text.secondary" }}
                          >
                            Install not needed
                          </Button>
                        )}
                      </>
                    )}
                    {/* Append more condition photos once the unit is out for
                        delivery — pushes onto the existing DO_START, never a new
                        report. Only for started (not_delivered has no DO_START yet). */}
                    {(it.deliveryStatus === "delivering" || it.deliveryStatus === "not_installed") &&
                      it.inventoryId && (
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<AddAPhotoIcon />}
                          onClick={() => requestPhotos(it)}
                          disabled={busy}
                          sx={{ minHeight: 40, color: "text.secondary" }}
                        >
                          Add photos
                        </Button>
                      )}
                  </Stack>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      {scheduledSummary.length > 0 && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            Scheduled — remaining to load
          </Typography>
          <Stack spacing={1}>
            {scheduledSummary.map((s) => (
              <Card key={s.assetId} variant="outlined" sx={{ borderStyle: "dashed" }}>
                <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{s.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {s.scheduled} scheduled · {s.delivered} delivered · {s.remaining} remaining
                      </Typography>
                    </Box>
                    <Chip size="small" color="warning" label={`${s.remaining} to load`} />
                  </Stack>
                  {canAdd && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={nfc.isScanning ? <CircularProgress size={16} /> : <NfcIcon />}
                      onClick={() => (nfc.isSupported ? nfc.startScan() : setManualOpen(true))}
                      disabled={busy || nfc.isScanning}
                      sx={{ mt: 1.5, minHeight: 40 }}
                    >
                      Scan another {s.label}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

      {canAdd && (
        <Stack spacing={1.5}>
          {/* Inline NFC — only when the platform supports it. */}
          {nfc.isSupported && (
            <Button
              variant={nfc.isScanning ? "outlined" : "contained"}
              size="large"
              startIcon={nfc.isScanning ? <CircularProgress size={18} /> : <NfcIcon />}
              onClick={() => (nfc.isScanning ? nfc.stopScan() : nfc.startScan())}
              disabled={busy}
              sx={{ py: 1.5, minHeight: 48 }}
            >
              {nfc.isScanning ? "Hold tag to phone… (tap to cancel)" : "Scan tag to add unit"}
            </Button>
          )}
          <Button
            variant="outlined"
            size="large"
            startIcon={<KeyboardIcon />}
            onClick={() => {
              setManualOpen(true);
              setCandidates(null);
            }}
            disabled={busy}
            sx={{ py: 1.5, minHeight: 48 }}
          >
            Enter serial to add unit
          </Button>
          {/* Free-typed line — not in the catalog; office resolves it later. */}
          <Button
            variant="outlined"
            size="large"
            startIcon={<EditNoteIcon />}
            onClick={() => {
              setFreeOpen(true);
              setFreeDesc("");
              setFreeQty("1");
            }}
            disabled={busy}
            sx={{ py: 1.5, minHeight: 48 }}
          >
            Free type item
          </Button>
          {/* Fallback: full scanner page (devices without Web NFC in-browser). */}
          <Button variant="text" size="small" onClick={() => router.push("/scan")} sx={{ color: "text.secondary" }}>
            Use the scanner page instead
          </Button>
        </Stack>
      )}

      <Button
        variant="text"
        sx={{ mt: 1, color: "text.secondary", alignSelf: "center" }}
        onClick={() => router.push("/scan")}
      >
        Done for now
      </Button>

      {/* Manual-serial add dialog */}
      <Dialog open={manualOpen} onClose={() => !resolving && setManualOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add unit by serial</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Serial number"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && resolveSerial()}
            sx={{ mt: 1 }}
          />
          {candidates && (
            <List dense sx={{ mt: 1 }}>
              {candidates.map((m) => (
                <ListItemButton
                  key={m.inventoryId}
                  onClick={() => {
                    setManualOpen(false);
                    setSerial("");
                    requestAdd(m.assetId, m.inventoryId, m.sku);
                  }}
                >
                  <ListItemText primary={m.sku} secondary={m.assetName ?? m.skuKey ?? undefined} />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualOpen(false)} disabled={resolving}>Cancel</Button>
          <Button variant="contained" onClick={resolveSerial} disabled={resolving || !serial.trim()}>
            {resolving ? <CircularProgress size={18} /> : "Find unit"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Free-typed line dialog — a description-only record (no catalog asset),
          resolved to a real asset/unit by the office later. */}
      <Dialog open={freeOpen} onClose={() => !busy && setFreeOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Free type item</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            For an item not in the catalog. The office resolves it to a product later.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Description"
            placeholder="e.g. 1 unit 60 es DG DCA-60ESI2"
            value={freeDesc}
            onChange={(e) => setFreeDesc(e.target.value)}
          />
          <TextField
            fullWidth
            type="number"
            label="Quantity"
            value={freeQty}
            onChange={(e) => setFreeQty(e.target.value)}
            inputProps={{ min: 1 }}
            sx={{ mt: 1.5, maxWidth: 140 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFreeOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={addFreeItem} disabled={busy || !freeDesc.trim()}>
            {busy ? <CircularProgress size={18} /> : "Add item"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Condition-photo step. mode 'add'/'start' evidence a unit before it goes
          out; mode 'photos' appends more to an already-started unit's DO_START. */}
      <Dialog open={!!pending} onClose={() => !busy && setPending(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {pending?.mode === "photos" ? "Add photos" : "Condition photo"}
          {pending?.sku ? ` — ${pending.sku}` : ""}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {pending?.mode === "photos"
              ? "Add more condition photos for this unit."
              : "Take at least one photo of the unit's condition before it goes out."}
          </Typography>
          <PhotoCaptureField
            label={pending?.mode === "photos" ? "Additional photos" : "Condition photos (required)"}
            photos={pendingPhotos}
            onChange={setPendingPhotos}
            upload={uploadDoStart}
            onError={(m) => setActionMsg(m || null)}
            onUploadingChange={setPhotoUploading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
          <Button
            variant="contained"
            onClick={confirmPending}
            disabled={busy || photoUploading || pendingPhotos.length === 0}
          >
            {busy ? (
              <CircularProgress size={18} />
            ) : pending?.mode === "photos" ? (
              "Add photos"
            ) : pending?.mode === "start" ? (
              "Start delivery"
            ) : (
              "Add & start delivery"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
