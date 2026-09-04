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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import {
  ASSET_CLASS_OPTIONS,
  DEFAULT_ASSET_CLASS,
  normalizeAssetClass,
  type AssetClass,
} from "@/helpers/assetClass";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import NfcIcon from "@mui/icons-material/Nfc";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import EditNoteIcon from "@mui/icons-material/EditNote";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import GuidedPhotoCapture from "@/components/delivery/GuidedPhotoCapture";
import { minPhotosForAssetClass } from "@/helpers/assetClass";
import { useNfcScan } from "../../../hooks/useNfcScan";

/**
 * Standalone-delivery BASKET (Layer 3 + in-basket scanning patch).
 *
 * Every item is independently actionable through its own lifecycle:
 *   not_delivered → [Start Delivery] → delivering → [Acknowledge]
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
  // Walk position (office order) and the conscious pass-over. skippedAt is what
  // separates "the rider passed this" from "not reached yet" — both of which are
  // deliveryStatus not_delivered.
  sortOrder?: number;
  skippedAt?: string | null;
  documentId: string | null;
  document: { id: string; name: string | null } | null;
  inventory: { id: string; sku: string; serialNumber: string | null; status: string } | null;
  asset: { id: string; name: string; skuKey: string } | null;
  // Resolved Equipment/Accessory for this line (backend pre-resolves the
  // free-typed / catalog fallback chain). Drives the condition-photo minimum.
  effectiveAssetClass?: string | null;
}

interface Run {
  id: string;
  deliveryNumber: number;
  direction?: "OUTBOUND" | "RETURN";
  // "scheduled" = the office declared this run and NO unit has been scanned yet
  // (the run-first entry point lands here). The first successful scan claims it
  // to in_progress via claimScheduled; every other status is post-claim.
  status: "scheduled" | "in_progress" | "delivered" | "completed" | "cancelled";
  // Set = the office scheduled this run, which is what turns on the one-pass
  // walk-through. An ad-hoc run (null) keeps the free-order basket behaviour.
  scheduledFor?: string | null;
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
  assetClass?: string | null;
}

const STATUS_CHIP: Record<ItemStatus, { label: string; color: "default" | "warning" | "info" | "success" }> = {
  not_delivered: { label: "Not delivered", color: "default" },
  delivering: { label: "Delivering", color: "warning" },
  not_installed: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
};

const RUN_STATUS_LABEL: Record<Run["status"], string> = {
  scheduled: "Scheduled — scan the first item to start",
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
  // Equipment vs Accessory for the free-typed line. There is no asset to read
  // the class from, so the rider picks it; defaults to Equipment.
  const [freeClass, setFreeClass] = useState<AssetClass>(DEFAULT_ASSET_CLASS);
  // Mandatory condition-photo step: a resolved unit parks here until the
  // rider captures ≥1 photo. mode 'add' = new unit (add + start); mode
  // 'start' = existing not_delivered item (Fix B start only).
  // mode 'add' = new unit (add + start); 'start' = existing not_delivered item
  // (Fix B start only); 'photos' = append condition photos to an already-started
  // unit's DO_START (no new report).
  const [pending, setPending] = useState<{
    mode: "add" | "start" | "photos";
    assetId: string;
    inventoryId: string;
    sku?: string;
    // Equipment/Accessory for the unit being captured. Sets how many photos
    // this step demands; unknown falls back to Equipment (the stricter rule).
    assetClass?: string | null;
  } | null>(null);
  // The rider stepped out of the walk-through to see the whole basket. Not
  // persisted: a reload should put them back on the next item, which is where
  // the run actually is.
  const [walkDismissed, setWalkDismissed] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<CapturedPhoto[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  // Bulk delivery/return ("Deliver all" / "Complete all deliveries") now runs on
  // the rider's own ack -> after-ack screens with applyToAll=1. Returns enter
  // after-ack directly (their photos were taken at Start Return).
  // Guards double-handling the same NFC read (uid persists until next startScan)
  const handledUidRef = useRef<string | null>(null);

  // Returns the freshly-loaded run so callers can branch on its new status (e.g.
  // ending the last item flows straight into the signature when the run is now
  // `delivered`). Null on failure / not signed in.
  // Fetch the run WITHOUT committing it to state. Used when the next step is to
  // navigate away (to finalize): committing a `delivered` run first would
  // re-render this page into its sparse post-delivery state for a frame before
  // the route changes — the "flash" the rider sees between End Delivery and the
  // installation question. Peeking at status without setRun avoids that.
  const fetchRun = useCallback(async (): Promise<Run | null> => {
    try {
      const token = await getToken();
      if (!token) {
        setError("Not signed in");
        return null;
      }
      const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
      if (res.success === false) {
        setError(res.message ?? "Delivery not found");
        return null;
      }
      return (res.data ?? res) as Run;
    } catch (e: any) {
      setError(e?.message ?? "Failed to load delivery");
      return null;
    }
  }, [deliveryId, getToken]);

  const load = useCallback(async () => {
    const fresh = await fetchRun();
    if (fresh) setRun(fresh);
    setLoading(false);
    return fresh;
  }, [fetchRun]);

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
  const requestAdd = useCallback(
    (assetId: string, inventoryId: string, sku?: string, assetClass?: string | null) => {
      setPendingPhotos([]);
      setPending({ mode: "add", assetId, inventoryId, sku, assetClass });
    },
    [],
  );

  const requestStart = useCallback((it: RunItem) => {
    if (!it.inventoryId) return;
    setPendingPhotos([]);
    setPending({
      mode: "start",
      assetId: it.assetId,
      inventoryId: it.inventoryId,
      sku: it.inventory?.sku,
      assetClass: it.effectiveAssetClass,
    });
  }, []);

  // Append more condition photos to an already-started unit's DO_START.
  const requestPhotos = useCallback((it: RunItem) => {
    if (!it.inventoryId) return;
    setPendingPhotos([]);
    setPending({
      mode: "photos",
      assetId: it.assetId,
      inventoryId: it.inventoryId,
      sku: it.inventory?.sku,
      assetClass: it.effectiveAssetClass,
    });
  }, []);

  // Mark ONE item delivered (per-item End Delivery, 2026-08 signature-at-end):
  // advances delivering -> not_installed with NO signature. The single customer
  // signature is captured later at Finalize, once every item is resolved. Units
  // hit the per-unit deliver endpoint; a free-typed line ends by DeliveryItem.id.
  const endItemDelivery = useCallback(
    async (it: RunItem) => {
      setBusy(true);
      setActionMsg(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = it.inventoryId
          ? await request(
              { path: `/deliveries/${deliveryId}/units/${encodeURIComponent(it.inventoryId)}/deliver`, method: "POST" },
              {},
              token,
            )
          : await request(
              { path: `/deliveries/${deliveryId}/items/${encodeURIComponent(it.id)}/end`, method: "POST" },
              {},
              token,
            );
        if (res?.success === false) throw new Error(res?.message ?? "Could not mark this item delivered");
        // Peek at the fresh status WITHOUT committing it. Ending the LAST
        // unresolved item leaves the run `delivered` -> go STRAIGHT to the one
        // signature; committing the delivered run first would flash this page's
        // post-delivery state before the route changes. If items remain, commit
        // and stay on the walk.
        const fresh = await fetchRun();
        if (fresh && fresh.direction !== "RETURN" && fresh.status === "delivered") {
          router.push(`/scan/delivery/${deliveryId}/finalize`);
          return;
        }
        if (fresh) setRun(fresh);
        setActionMsg(it.inventory?.sku ? `${it.inventory.sku} delivered ✓` : "Marked delivered ✓");
      } catch (e: any) {
        setActionMsg(e?.message ?? "Could not mark this item delivered");
      } finally {
        setBusy(false);
      }
    },
    [deliveryId, getToken, fetchRun, router],
  );

  // Collect ONE return item — NO signature (2026-08 signature-at-end for returns,
  // mirroring outbound). Marks it collected (delivering -> not_installed) via the
  // return-aware collect endpoint (unit: collect-return; free-typed: items/:id/end).
  // Collecting the LAST outstanding item folds the run to `delivered` -> flow ONCE
  // into the single return signature. fetchRun peeks WITHOUT committing, so the run
  // page never flashes its post-collection state before navigating.
  const endReturnItem = useCallback(
    async (it: RunItem) => {
      setBusy(true);
      setActionMsg(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = it.inventoryId
          ? await request(
              { path: `/deliveries/${deliveryId}/items/${encodeURIComponent(it.inventoryId)}/collect-return`, method: "POST" },
              {},
              token,
            )
          : await request(
              { path: `/deliveries/${deliveryId}/items/${encodeURIComponent(it.id)}/end`, method: "POST" },
              {},
              token,
            );
        if (res?.success === false) throw new Error(res?.message ?? "Could not collect this item");
        const fresh = await fetchRun();
        if (fresh && fresh.direction === "RETURN" && fresh.status === "delivered") {
          router.push(`/scan/delivery/${deliveryId}/finalize?return=1`);
          return;
        }
        if (fresh) setRun(fresh);
        setActionMsg(it.inventory?.sku ? `${it.inventory.sku} collected ✓` : "Collected ✓");
      } catch (e: any) {
        setActionMsg(e?.message ?? "Could not collect this item");
      } finally {
        setBusy(false);
      }
    },
    [deliveryId, getToken, fetchRun, router],
  );

  // How many condition photos this step demands (OSI-81). Equipment gets the
  // guided set, an accessory keeps one, and the rule is the same on a return as
  // on the way out so the two sets can be compared before and after the hire.
  // 'photos' mode is an append to an already started unit, so it only needs the
  // one it is adding.
  const requiredPhotos =
    !pending || pending.mode === "photos" ? 1 : minPhotosForAssetClass(pending.assetClass);

  // Photo confirmed → add (mode 'add') then DO_START; or (mode 'photos') append
  // to the existing DO_START without creating a new report.
  const confirmPending = useCallback(async () => {
    if (!pending) return;
    if (pendingPhotos.length < requiredPhotos) {
      setActionMsg(
        requiredPhotos === 1
          ? "Take at least one photo of the unit."
          : `This unit is equipment, so it needs ${requiredPhotos} photos before it can be moved. ${pendingPhotos.length} so far.`,
      );
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
        // Run-first entry point: the run is still `scheduled`, so this is the
        // FIRST unit. claimScheduled is the run-first binder — it fills the
        // declared slot, reserves the unit, sets the rider and flips the run to
        // in_progress. POST /items is the ad-hoc path and would not claim.
        // Everything after this scan takes the normal in_progress branch below,
        // so the walk continues unchanged from item 2 onward.
        if (run?.status === "scheduled") {
          const res = await request(
            { path: `/deliveries/${deliveryId}/claim-scheduled`, method: "POST" },
            { assetId: pending.assetId, inventoryId: pending.inventoryId },
            token,
          );
          if (res.success === false) throw new Error(res.message ?? "Could not start this delivery");
        } else {
          const res = await request(
            { path: `/deliveries/${deliveryId}/items`, method: "POST" },
            { assetId: pending.assetId, inventoryId: pending.inventoryId },
            token,
          );
          if (res.success === false) throw new Error(res.message ?? "Could not add unit");
        }
      }
      await startUnit(pending.assetId, pending.inventoryId, token, pendingPhotos.map((p) => p.key));
      setActionMsg(pending.sku ? `${pending.sku} added ✓` : "Unit added ✓");
      setPending(null);
      setPendingPhotos([]);
      await load();
    } catch (e: any) {
      // claimScheduled deliberately REJECTS a unit whose asset is not on this
      // run ("No open scheduled slot for this asset on this run") — that loud
      // failure is correct and kept. Reword it for someone holding a phone.
      const raw = String(e?.message ?? "");
      const friendly = /no open scheduled slot/i.test(raw)
        ? "That unit isn't on this delivery. Check the item list below, or scan it from the scan page to start it as its own delivery."
        : raw || "Unit not available — already out for delivery";
      setActionMsg(friendly);
      // 'add' failures: nothing was created, close the photo step. A failed
      // DO_START after a successful add leaves the item with its own Start
      // button (which re-runs the photo step).
      setPending(null);
      setPendingPhotos([]);
      await load();
    } finally {
      setBusy(false);
    }
  }, [pending, pendingPhotos, requiredPhotos, deliveryId, getToken, load, startUnit, run?.status]);

  // #3 fallback: rider decides installation isn't needed from the basket.
  // Free-typed lines now run the full lifecycle (Start -> photos -> End -> sign)
  // on /scan/delivery/[id]/free-item/[itemId]; the old one-tap "Mark delivered"
  // (POST /items/:itemId/deliver) was removed here.

  // Walk-through: pass this item over and move to the next. Keyed by
  // DeliveryItem.id so an unfilled slot or a free-typed line is skippable too.
  // Nothing is delivered or proven — the item stays fully startable from the
  // Skipped section afterwards.
  const skipWalkItem = useCallback(
    async (it: RunItem) => {
      setBusy(true);
      setActionMsg(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request(
          { path: `/deliveries/${deliveryId}/items/${it.id}/skip`, method: "POST" },
          {},
          token,
        );
        if (res.success === false) throw new Error(res.message ?? "Could not skip this item");
        await load();
      } catch (e: any) {
        setActionMsg(e?.message ?? "Could not skip this item");
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
        requestAdd(assetId, inventoryId, payload?.inventory?.sku, payload?.asset?.assetClass);
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
        requestAdd(matches[0].assetId, matches[0].inventoryId, matches[0].sku, matches[0].assetClass);
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
        { description, quantity, assetClass: freeClass },
        token,
      );
      if (res.success === false) throw new Error(res.message ?? "Could not add item");
      setActionMsg(`"${description}" added ✓`);
      setFreeOpen(false);
      setFreeDesc("");
      setFreeQty("1");
      setFreeClass(DEFAULT_ASSET_CLASS);
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
  // Filling an office-scheduled slot is NOT an addition — the office already
  // declared those units, so slot 3 of 5 must stay loadable after slots 1 and 2
  // are acknowledged. Only the run being finished closes it. The generic add
  // controls below stay on `canAdd`, so ad-hoc units still lock at first
  // hand-over; the backend enforces the same split in addItem.
  // "scheduled" included: on the run-first entry point NOTHING has been scanned
  // yet, so slot 1 must be fillable while the run is still unclaimed. The scan
  // itself claims it (claimScheduled), which is what flips it to in_progress.
  const canFillScheduledSlot = run.status === "in_progress" || run.status === "scheduled";

  // EVERY item still delivering, unit-backed OR free-typed. The single "End
  // Delivery" / "End Return" button covers all of them: ack-all fans across every
  // delivering item (free-typed included).
  const deliveringItems = run.items.filter((it) => it.deliveryStatus === "delivering");

  // Bulk end: prefer a UNIT lead (its ack -> after-ack screens capture the shared
  // proof, then ack-all fans it across every delivering item including free-typed
  // lines). With only free-typed lines delivering, end via the free-item page.
  const bulkEnd = async () => {
    // RETURN (2026-08 signature-at-end, mirroring outbound): COLLECT every
    // delivering item with NO signature — units via ack-all (unsigned DO_ACK +
    // off-hire), free-typed via /end. The single customer signature is captured
    // ONCE at the end (finalize?return=1), reached when the run folds to
    // `delivered`. fetchRun peeks without committing so the page never flashes.
    if (run.direction === "RETURN") {
      setBusy(true);
      setActionMsg(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        // One ack-all collects EVERY delivering return item unsigned — units and
        // free-typed lines alike (the backend dispatcher handles both).
        const res = await request({ path: `/deliveries/${run.id}/ack-all`, method: "POST" }, {}, token);
        if (res?.success === false) throw new Error(res?.message ?? "Could not collect the items");
        const fresh = await fetchRun();
        if (fresh && fresh.direction === "RETURN" && fresh.status === "delivered") {
          router.push(`/scan/delivery/${run.id}/finalize?return=1`);
          return;
        }
        if (fresh) setRun(fresh);
        setActionMsg("Collected ✓");
      } catch (e: any) {
        setActionMsg(e?.message ?? "Could not collect the item");
      } finally {
        setBusy(false);
      }
      return;
    }
    // OUTBOUND (2026-08 signature-at-end): mark every delivering item delivered
    // (delivering -> not_installed) with NO signature. ack-all writes an unsigned
    // proof MSR per item. The single customer signature is captured later at
    // Finalize, once every item on the run is resolved.
    setBusy(true);
    setActionMsg(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/deliveries/${run.id}/ack-all`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res?.message ?? "Could not mark items delivered");
      // Peek without committing: if this ended the last unresolved item(s) the run
      // is now `delivered` -> go straight to the one signature. Committing the
      // delivered run first would flash this page's post-delivery state before the
      // route changes. Otherwise commit and stay on the walk.
      const fresh = await fetchRun();
      if (fresh && fresh.direction !== "RETURN" && fresh.status === "delivered") {
        router.push(`/scan/delivery/${run.id}/finalize`);
        return;
      }
      if (fresh) setRun(fresh);
    } catch (e: any) {
      setActionMsg(e?.message ?? "Could not mark items delivered");
    } finally {
      setBusy(false);
    }
  };

  // Unbound office-scheduled slots (assetId set, no unit yet) = a merged
  // scheduled run's remaining quantity. Render them as a per-asset "remaining to
  // load" summary instead of dead per-slot cards; scanning a matching unit fills
  // the next slot (the backend's addItem is slot-aware).
  // SKIPPED: consciously passed over during the walk. Still not_delivered, so
  // the bulk button (which acts on `delivering` units only) can never touch
  // them — that separation is exactly why skippedAt exists. They keep their own
  // Start button so the rider can come back to any of them.
  const skippedItems = run.items.filter(
    (it) => it.skippedAt && it.deliveryStatus === "not_delivered",
  );
  const isSkipped = (it: RunItem) => skippedItems.some((s) => s.id === it.id);

  const unboundSlots = run.items.filter((it) => it.assetId && !it.inventoryId && !isSkipped(it));
  const visibleItems = run.items.filter((it) => !(it.assetId && !it.inventoryId) && !isSkipped(it));
  // A completed item is DONE — it must leave the Delivering box entirely, so the
  // bulk "End Delivery" only ever sits over items still in flight. Completed
  // units render read-only in their own section below (progress at a glance,
  // no action that could invite a second pointless bulk end).
  const inFlightItems = visibleItems.filter((it) => it.deliveryStatus !== "completed");
  const completedItems = visibleItems.filter((it) => it.deliveryStatus === "completed");

  // ── one-pass walk-through (scheduled runs only) ──────────────────────────
  // The office declared these items in order, so the rider is stepped through
  // them one at a time instead of choosing from a list. The queue is DERIVED,
  // not stored: starting or skipping an item removes it, so the walk advances
  // by itself and survives a reload mid-run (it resumes at the same place).
  // Ad-hoc runs have no declared order and keep the free-order basket.
  const isScheduledRun = !!run.scheduledFor;
  // The counter must read the office's DECLARED order (sortOrder), not the API's
  // incoming array order or the shrinking remaining queue. Sort a local copy by
  // [sortOrder, id] (same tiebreak the backend uses) so "Item N of M" is the
  // item's fixed position in the full list even as earlier ones complete/skip.
  const orderedItems = [...run.items].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  // The forward walk covers ONLY un-started, non-skipped items, and it
  // TERMINATES: once every such item has been scanned (-> delivering) or skipped,
  // walkQueue is empty and the walk ends, handing the rider to the basket. This
  // is deliberate - including delivering/skipped items here made the walk cycle
  // back onto unresolved items with no way to finish (a skipped item traps the
  // rider). Instead: a started-but-not-ended item is ended from the basket's
  // Delivering section (no signature), and a skipped item is revisited from the
  // basket's Skipped section (Start). A skipped item does NOT resolve the run -
  // it holds the run open (in_progress) - it is just picked up later, not by
  // looping the walk.
  const walkQueue = orderedItems.filter(
    (it) => it.deliveryStatus === "not_delivered" && !it.skippedAt,
  );
  const walkItem = walkQueue[0] ?? null;
  // Active while the run is in progress and un-started, unskipped items remain.
  // When they are all scanned or skipped the walk ends and the basket takes over.
  const walkActive =
    isScheduledRun &&
    (run.status === "in_progress" || run.status === "scheduled") &&
    !!walkItem &&
    !walkDismissed;
  // Counter position within the full item list. OUTBOUND fills slots in walk
  // order, so the walkItem's fixed declared position (its index in the ordered
  // list) already reads 1..N as the rider advances. RETURN items are unit-bound,
  // so the rider can start units out of declared order; then the lowest-unstarted
  // item's declared position sticks (e.g. "1 of 4" after starting a later unit).
  // For returns, count PROGRESS instead — how many of the full list are already
  // resolved (out of walkQueue), + 1 — so the counter advances in any scan order.
  // OUTBOUND keeps its exact formula (it fills in order, so progress == declared),
  // leaving the outbound counter byte-identical.
  const walkPosition = walkItem
    ? run.direction === "RETURN"
      ? run.items.length - walkQueue.length + 1
      : orderedItems.findIndex((it) => it.id === walkItem.id) + 1
    : 0;
  const isReturnRun = run.direction === "RETURN";
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
          <Typography variant="h6" fontWeight={700}>{run.direction === "RETURN" ? "Return" : "Delivery"} #{run.deliveryNumber}</Typography>
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

      {/* FINALIZE (outbound): the run has folded to `delivered`, meaning every
          item is delivered or skipped. This is the ONLY point the single customer
          signature is captured; it completes the run and fires the DO commit +
          invoice. Returns are signed at collection, so this never shows for them. */}
      {!isReturnRun && run.status === "delivered" && (
        <Card variant="outlined" sx={{ borderColor: "success.main", borderWidth: 2 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={700}>Ready to finish</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
              Every item is delivered or skipped. Get the customer&apos;s signature to complete this delivery.
            </Typography>
            <Button
              fullWidth
              variant="contained"
              color="success"
              startIcon={<LocalShippingIcon />}
              onClick={() => router.push(`/scan/delivery/${run.id}/finalize`)}
              disabled={busy}
              sx={{ minHeight: 48 }}
            >
              Get customer signature
            </Button>
          </CardContent>
        </Card>
      )}

      {/* RETURN fallback: the run is fully collected but unsigned — reached when a
          rider backs out of the return signature, or collected the last item from
          the free-item page. The single return signature is captured here. */}
      {isReturnRun && run.status === "delivered" && (
        <Card variant="outlined" sx={{ borderColor: "success.main", borderWidth: 2 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={700}>Ready to finish</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
              Every unit is collected or skipped. Get the customer&apos;s signature to complete this return.
            </Typography>
            <Button
              fullWidth
              variant="contained"
              color="success"
              startIcon={<AssignmentReturnIcon />}
              onClick={() => router.push(`/scan/delivery/${run.id}/finalize?return=1`)}
              disabled={busy}
              sx={{ minHeight: 48 }}
            >
              Get customer signature
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── WALK-THROUGH (scheduled runs) ──────────────────────────────────
          One item at a time, in the order the office entered them, so nothing
          is missed and the rider never has to pick from a list while standing
          at the vehicle. Every position is either handled or consciously
          skipped; when the last one leaves the queue this card disappears and
          the basket below is what remains. */}
      {walkActive && walkItem && (
        <Card variant="outlined" sx={{ borderColor: "primary.main", borderWidth: 2 }}>
          <CardContent>
            <Typography variant="overline" color="primary" fontWeight={700}>
              Item {walkPosition} of {run.items.length}
            </Typography>
            <Typography variant="h6" fontWeight={700} sx={{ mt: 0.5 }}>
              {walkItem.description || walkItem.asset?.name || walkItem.inventory?.sku || "Item"}
            </Typography>
            {walkItem.inventory?.sku && (
              <Typography variant="body2" color="text.secondary">
                {walkItem.inventory.sku}
              </Typography>
            )}
            {!walkItem.inventoryId && walkItem.assetId && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Scan or key in the unit you are loading for this line.
              </Typography>
            )}

            <Stack spacing={1} sx={{ mt: 2 }}>
              {/* Free-typed line: no unit to scan, so it runs its lifecycle on its
                  own page (guided condition photos -> Start). RETURN mirrors
                  OUTBOUND here (same guided capture, class-based minimum); only the
                  End differs (a return is collected, not signed for). */}
              {!walkItem.inventoryId && !walkItem.assetId && walkItem.deliveryStatus === "not_delivered" && (
                <Button
                  variant="contained"
                  size="large"
                  startIcon={isReturnRun ? <AssignmentReturnIcon /> : <LocalShippingIcon />}
                  onClick={() => router.push(`/scan/delivery/${run.id}/free-item/${walkItem.id}`)}
                  disabled={busy}
                  sx={{ py: 1.5, minHeight: 48 }}
                >
                  {isReturnRun ? "Start Return" : "Start Delivery"}
                </Button>
              )}
              {/* Free-typed line already started -> End marks it delivered with no
                  signature (captured at Finalize), by DeliveryItem.id. */}
              {!walkItem.inventoryId && !walkItem.assetId && walkItem.deliveryStatus === "delivering" && (
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<LocalShippingIcon />}
                  onClick={() => endItemDelivery(walkItem)}
                  disabled={busy}
                  sx={{ py: 1.5, minHeight: 48 }}
                >
                  End Delivery
                </Button>
              )}

              {/* Unit bound to this position. not_delivered -> Start (condition
                  photos). delivering -> End: outbound marks it delivered here with
                  NO signature (the run's single signature is captured at Finalize);
                  a return still ends through its per-unit collection flow. */}
              {walkItem.inventoryId && walkItem.deliveryStatus !== "delivering" && (
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => requestStart(walkItem)}
                  disabled={busy}
                  sx={{ py: 1.5, minHeight: 48 }}
                >
                  {isReturnRun ? "Start Return" : "Start Delivery"}
                </Button>
              )}
              {walkItem.inventoryId && walkItem.deliveryStatus === "delivering" && (
                isReturnRun ? (
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<AssignmentReturnIcon />}
                    onClick={() => endReturnItem(walkItem)}
                    disabled={busy}
                    sx={{ py: 1.5, minHeight: 48 }}
                  >
                    End Return
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<LocalShippingIcon />}
                    onClick={() => endItemDelivery(walkItem)}
                    disabled={busy}
                    sx={{ py: 1.5, minHeight: 48 }}
                  >
                    End Delivery
                  </Button>
                )
              )}

              {/* Open slot: any matching unit is accepted, and the backend binds
                  it to the earliest open slot for that asset. */}
              {!walkItem.inventoryId && walkItem.assetId && (
                <>
                  {/* Scan ALWAYS renders (never gated on the async isSupported,
                      which is undefined for a moment after the basket re-mounts).
                      When NFC is unavailable or still resolving, it falls back to
                      the manual serial dialog, so both options are always offered. */}
                  <Button
                    variant={nfc.isScanning ? "outlined" : "contained"}
                    size="large"
                    startIcon={nfc.isScanning ? <CircularProgress size={18} /> : <NfcIcon />}
                    onClick={() => {
                      if (!nfc.isSupported) {
                        setManualOpen(true);
                        setCandidates(null);
                        setSerial("");
                        return;
                      }
                      nfc.isScanning ? nfc.stopScan() : nfc.startScan();
                    }}
                    disabled={busy}
                    sx={{ py: 1.5, minHeight: 48 }}
                  >
                    {nfc.isScanning ? "Hold tag to phone… (tap to cancel)" : "Scan tag"}
                  </Button>
                  <Button
                    variant="outlined"
                    size="large"
                    startIcon={<KeyboardIcon />}
                    onClick={() => {
                      setManualOpen(true);
                      setCandidates(null);
                      setSerial("");
                    }}
                    disabled={busy}
                    sx={{ py: 1.5, minHeight: 48 }}
                  >
                    Enter serial
                  </Button>
                </>
              )}

              <Button
                variant="text"
                size="large"
                startIcon={<SkipNextIcon />}
                onClick={() => skipWalkItem(walkItem)}
                disabled={busy}
                sx={{ minHeight: 48, color: "text.secondary" }}
              >
                Skip this item
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {walkActive && (
        <Button
          variant="text"
          size="small"
          onClick={() => setWalkDismissed(true)}
          sx={{ color: "text.secondary", alignSelf: "center" }}
        >
          View all items
        </Button>
      )}

      {/* Stepped out of the walk with positions still to visit — offer the way
          back rather than stranding them in the basket. */}
      {isScheduledRun && walkDismissed && walkItem && (run.status === "in_progress" || run.status === "scheduled") && (
        <Button
          variant="outlined"
          startIcon={<PlayArrowIcon />}
          onClick={() => setWalkDismissed(false)}
          sx={{ alignSelf: "center" }}
        >
          Resume walk-through ({walkQueue.length} left)
        </Button>
      )}

      {/* The basket is what the rider sees BETWEEN walk items and after the
          last one; during a walk step it would just be a distraction. */}
      {!walkActive && (
      <>
      {/* The whole Delivering section is one box: the items still in flight,
          then a single "End Delivery" action at the bottom (inside the box) that
          covers every item in it. Completed items are NOT here — they moved to
          the Completed section below, so this box (and its End Delivery) only
          ever covers active work. When nothing is in flight the box is not
          rendered at all. Per-item End actions are removed; Start actions (for
          not-yet-started items) stay per item. The Skipped section is separate. */}
      {inFlightItems.length > 0 && (
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        Delivering ({inFlightItems.length})
      </Typography>
      <Stack spacing={1}>
        {inFlightItems.map((it) => {
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
                    {/* Free-typed line (no unit to scan) runs the full flow on its
                        own page, keyed by DeliveryItem.id: Start (guided photos)
                        then End (signature). Same lifecycle as a unit line. */}
                    {!it.inventoryId && !it.assetId && it.deliveryStatus === "not_delivered" && run.status !== "cancelled" && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<LocalShippingIcon />}
                        onClick={() => router.push(`/scan/delivery/${run.id}/free-item/${it.id}`)}
                        disabled={busy}
                        sx={{ minHeight: 40 }}
                      >
                        Start Delivery
                      </Button>
                    )}
                    {/* Delivering items (free-typed and unit) have NO per-item End
                        action — the single "End Delivery" at the bottom of the box
                        ends them all together. */}
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
                        Start Delivery
                      </Button>
                    )}
                    {/* Per-item install actions removed (2026-08): installation is
                        no longer per item. It is asked ONCE for the whole run at
                        the end, in the finalize sequence (Installation needed? then
                        signature). A delivered item just sits at not_installed
                        until the run-level finalize completes it. */}
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

      {/* Single End action for the WHOLE box: a unit lead captures one signature/
          photo/GPS and ack-all fans it across every delivering item (free-typed
          included). Shown while anything is still delivering. */}
      {deliveringItems.length >= 1 && (
        <Button
          fullWidth
          variant="contained"
          startIcon={isReturnRun ? <AssignmentReturnIcon /> : <LocalShippingIcon />}
          onClick={bulkEnd}
          disabled={busy}
          sx={{ mt: 1.5, minHeight: 44 }}
        >
          {isReturnRun ? "End Return" : "End Delivery"}
        </Button>
      )}
      </Box>
      )}

      {/* Completed — read-only. Done items live here, out of the Delivering box,
          so the rider sees progress at a glance without any action that could
          trigger a second End Delivery. No buttons by design. */}
      {completedItems.length > 0 && (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            Completed ({completedItems.length})
          </Typography>
          <Stack spacing={1}>
            {completedItems.map((it) => {
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
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </Box>
      )}

      {/* ── SKIPPED ────────────────────────────────────────────────────────
          Passed over during the walk. Deliberately its own section and NOT part
          of the bulk pass above: the rider decided these are not going out with
          the rest, so each one is picked up individually or left alone. */}
      {skippedItems.length > 0 && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            Skipped ({skippedItems.length})
          </Typography>
          <Stack spacing={1}>
            {skippedItems.map((it) => (
              <Card key={it.id} variant="outlined" sx={{ borderStyle: "dashed" }}>
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
                    <Chip size="small" label="Skipped" color="default" />
                  </Stack>
                  {run.status === "in_progress" && (
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
                      {/* Free-typed: no unit; runs its full flow on its own page
                          (Start clears the skip + captures guided photos, then End).
                          RETURN mirrors OUTBOUND (same page, same photo capture);
                          only the End differs (collected, not signed). */}
                      {!it.inventoryId && !it.assetId && (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={isReturnRun ? <AssignmentReturnIcon /> : <LocalShippingIcon />}
                          onClick={() =>
                            router.push(
                              `/scan/delivery/${run.id}/free-item/${it.id}`,
                            )
                          }
                          disabled={busy}
                          sx={{ minHeight: 40 }}
                        >
                          {it.deliveryStatus === "delivering"
                            ? isReturnRun
                              ? "End Return"
                              : "End Delivery"
                            : isReturnRun
                              ? "Start Return"
                              : "Start Delivery"}
                        </Button>
                      )}
                      {it.inventoryId && (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PlayArrowIcon />}
                          onClick={() => requestStart(it)}
                          disabled={busy}
                          sx={{ minHeight: 40 }}
                        >
                          {isReturnRun ? "Start Return" : "Start Delivery"}
                        </Button>
                      )}
                      {/* Open slot: needs a unit before it can start, so the
                          action is the scan rather than a Start button. */}
                      {!it.inventoryId && it.assetId && (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<KeyboardIcon />}
                          onClick={() => {
                            setManualOpen(true);
                            setCandidates(null);
                            setSerial("");
                          }}
                          disabled={busy}
                          sx={{ minHeight: 40 }}
                        >
                          Load a unit
                        </Button>
                      )}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

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
                  {canFillScheduledSlot && s.remaining > 0 && (
                    // Scan OR key the serial: a tag can be missing or unreadable,
                    // and the slot still has to be fillable without leaving the card.
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={nfc.isScanning ? <CircularProgress size={16} /> : <NfcIcon />}
                        onClick={() => (nfc.isSupported ? nfc.startScan() : setManualOpen(true))}
                        disabled={busy || nfc.isScanning}
                        sx={{ flex: 1, minHeight: 40 }}
                      >
                        Scan another {s.label}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<KeyboardIcon />}
                        onClick={() => {
                          setManualOpen(true);
                          setCandidates(null);
                          setSerial("");
                        }}
                        disabled={busy}
                        sx={{ minHeight: 40, whiteSpace: "nowrap" }}
                      >
                        Enter serial
                      </Button>
                    </Stack>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

      {canAdd && (
        <Stack spacing={1.5}>
          {/* Scan ALWAYS renders (never gated on the async isSupported); it falls
              back to the manual serial dialog when NFC is unavailable or still
              resolving, so both options are always offered. */}
          <Button
            variant={nfc.isScanning ? "outlined" : "contained"}
            size="large"
            startIcon={nfc.isScanning ? <CircularProgress size={18} /> : <NfcIcon />}
            onClick={() => {
              if (!nfc.isSupported) {
                setManualOpen(true);
                setCandidates(null);
                return;
              }
              nfc.isScanning ? nfc.stopScan() : nfc.startScan();
            }}
            disabled={busy}
            sx={{ py: 1.5, minHeight: 48 }}
          >
            {nfc.isScanning ? "Hold tag to phone… (tap to cancel)" : "Scan tag to add unit"}
          </Button>
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

      </>
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
          {/* No catalog asset behind this line, so the class is captured here.
              It sets how many photos this item needs when it is tagged. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2, mb: 0.5 }}>
            Type
          </Typography>
          <ToggleButtonGroup
            value={freeClass}
            exclusive
            fullWidth
            size="small"
            color="primary"
            disabled={busy}
            onChange={(_, next) => {
              // exclusive group returns null when re-clicking the active button;
              // keep the current value so one option is always selected.
              if (next) setFreeClass(normalizeAssetClass(next));
            }}
          >
            {ASSET_CLASS_OPTIONS.map((o) => (
              <ToggleButton key={o.value} value={o.value}>
                {o.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
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
              : requiredPhotos > 1
                ? `This unit is equipment, so it needs ${requiredPhotos} condition photos before it can be moved.`
                : "Take at least one photo of the unit's condition before it is moved."}
          </Typography>
          {requiredPhotos > 1 ? (
            // Equipment going out: walk the named angles instead of a free-form
            // picker, so the office gets a comparable set for every unit.
            <GuidedPhotoCapture
              photos={pendingPhotos}
              onChange={setPendingPhotos}
              upload={uploadDoStart}
              minPhotos={requiredPhotos}
              onError={(m) => setActionMsg(m || null)}
              onUploadingChange={setPhotoUploading}
            />
          ) : (
            <PhotoCaptureField
              label={pending?.mode === "photos" ? "Additional photos" : "Condition photos (required)"}
              photos={pendingPhotos}
              onChange={setPendingPhotos}
              upload={uploadDoStart}
              onError={(m) => setActionMsg(m || null)}
              onUploadingChange={setPhotoUploading}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
          <Button
            variant="contained"
            onClick={confirmPending}
            disabled={busy || photoUploading || pendingPhotos.length < requiredPhotos}
          >
            {busy ? (
              <CircularProgress size={18} />
            ) : pending?.mode === "photos" ? (
              "Add photos"
            ) : pending?.mode === "start" ? (
              "Start Delivery"
            ) : (
              "Add & start delivery"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
