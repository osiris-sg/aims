"use client";

/**
 * Guest delivery surface — mirrors the authenticated field flow, but auth'd
 * ENTIRELY by the share-link token in the URL (no Clerk, no (field) layout).
 * Steps + captured proof match the field flow: Start Delivery → Acknowledge
 * Delivery (photos + GPS + recipient signature/name) → Complete Installation
 * (same). Reuses the shared PhotoCaptureField / SignaturePadField / capturePosition
 * components and drives the Phase-1 @Public token endpoints, which create/sign
 * the SAME MaintenanceServiceReports (so stock deduction + rental/sold flip fire
 * via the advanceDeliveryItem bridge exactly as the office flow). The request
 * helper omits Authorization when the token arg is undefined.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { request } from "@/helpers/request";
import { capturePosition } from "@/helpers/geolocation";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";

type DeliveryItemStatus = "not_delivered" | "delivering" | "not_installed" | "completed";
type ReportKind = "DO_START" | "DO_ACK" | "DO_INSTALL";

interface DeliveryItem {
  id: string;
  itemId: string;
  inventoryId: string | null;
  itemType: string;
  sku: string | null;
  unitSku: string | null;
  description: string | null;
  quantity: number | null;
  deliveryStatus: DeliveryItemStatus;
}
interface GuestView {
  documentNumber: string | null;
  status: string | null;
  customerName: string;
  deliveryItems: DeliveryItem[];
}

const STATUS_CHIP: Record<
  DeliveryItemStatus,
  { label: string; color: "default" | "warning" | "info" | "success" }
> = {
  not_delivered: { label: "Not delivered", color: "default" },
  delivering: { label: "Delivering", color: "warning" },
  not_installed: { label: "Delivered (not installed)", color: "info" },
  completed: { label: "Completed", color: "success" },
};

// Stage → the card's next action, derived from the item's OWN deliveryStatus —
// the same per-item derivation as the field big card (Option-B stage fix).
function stageAction(s: DeliveryItemStatus): { kind: ReportKind | null; label: string } {
  switch (s) {
    case "not_delivered":
      return { kind: "DO_START", label: "Start Delivery" };
    case "delivering":
      return { kind: "DO_ACK", label: "Acknowledge Delivery" };
    case "not_installed":
      return { kind: "DO_INSTALL", label: "Complete Installation" };
    default:
      return { kind: null, label: "Completed" };
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>
      {children}
    </Box>
  );
}

export default function GuestDeliveryPage() {
  const params = useParams();
  const token = (params?.token as string) ?? "";
  const [view, setView] = useState<GuestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The item + step currently being acted on; null = item list.
  const [active, setActive] = useState<{ item: DeliveryItem; kind: ReportKind } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await request({ path: `/public/delivery/${token}`, method: "GET" }, {});
      setView(res?.data ?? res);
    } catch (e: any) {
      setError(
        e?.response?.data?.message ||
          e?.message ||
          "This delivery link is invalid or has expired.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    );
  }
  if (error || !view) {
    return (
      <Centered>
        <Alert severity="error">{error ?? "Delivery not found"}</Alert>
      </Centered>
    );
  }

  if (active) {
    return (
      <StepScreen
        token={token}
        item={active.item}
        kind={active.kind}
        onBack={() => setActive(null)}
        onDone={() => {
          setActive(null);
          load();
        }}
      />
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", p: 2 }}>
      <Typography variant="h6" fontWeight={700}>
        Delivery {view.documentNumber || ""}
      </Typography>
      {view.customerName && (
        <Typography variant="body2" color="text.secondary">
          {view.customerName}
        </Typography>
      )}

      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        Items on this delivery ({view.deliveryItems.length})
      </Typography>

      <Stack spacing={1.5}>
        {view.deliveryItems.map((row) => {
          const chip = STATUS_CHIP[row.deliveryStatus] ?? {
            label: row.deliveryStatus,
            color: "default" as const,
          };
          const action = stageAction(row.deliveryStatus);
          return (
            <Card key={row.id} variant="outlined">
              <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {row.description || row.unitSku || "Item"}
                    </Typography>
                    {row.unitSku && (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {row.unitSku}
                      </Typography>
                    )}
                  </Box>
                  <Chip size="small" label={chip.label} color={chip.color} />
                </Box>

                {action.kind ? (
                  <Button
                    fullWidth
                    variant="contained"
                    sx={{ mt: 1.5 }}
                    disabled={!row.inventoryId}
                    onClick={() => setActive({ item: row, kind: action.kind! })}
                  >
                    {action.label}
                  </Button>
                ) : (
                  <Stack direction="row" spacing={0.5} sx={{ mt: 1, color: "success.main", alignItems: "center" }}>
                    <CheckCircleIcon fontSize="small" />
                    <Typography variant="body2">Delivered &amp; installed</Typography>
                  </Stack>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
}

/**
 * One step for one item. Start = a confirm screen (mirrors delivery-start).
 * Acknowledge / Complete = notes + photos + one-shot GPS + recipient name +
 * signature on a single screen (the field flow splits these across the do/
 * install page and the sign page; the guest surface combines them but captures
 * the identical proof and sequences create → sign the same way).
 */
function StepScreen({
  token,
  item,
  kind,
  onBack,
  onDone,
}: {
  token: string;
  item: DeliveryItem;
  kind: ReportKind;
  onBack: () => void;
  onDone: () => void;
}) {
  const isStart = kind === "DO_START";
  const title =
    kind === "DO_START"
      ? "Start Delivery"
      : kind === "DO_ACK"
        ? "Acknowledge Delivery"
        : "Complete Installation";
  const photoLabel = kind === "DO_INSTALL" ? "Proof of installation" : "Proof of delivery";
  const itemLabel = item.description || item.unitSku || "Item";
  const unitId = item.inventoryId ?? item.itemId;

  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);

  // Token-scoped photo upload — the SAME contract the field flow's uploadImage
  // closure provides, but via the @Public /photo endpoint (no Clerk token).
  const uploadGuestPhoto = async (blob: Blob): Promise<string | null> => {
    const fd = new FormData();
    fd.append("file", blob, "photo.jpg");
    const res: any = await request(
      { path: `/public/delivery/${token}/photo`, method: "POST" },
      fd,
      undefined,
      undefined,
      true,
      true,
    );
    return res?.Key ?? res?.data?.Key ?? null;
  };

  const submitStart = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await request(
        { path: `/public/delivery/${token}/report`, method: "POST" },
        { kind: "DO_START", inventoryId: unitId },
      );
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Failed to start delivery");
    } finally {
      setSubmitting(false);
    }
  };

  const submitAckOrInstall = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("Signature is required");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const description =
        notes.trim() || (kind === "DO_INSTALL" ? "Installation acknowledged" : "Delivery acknowledged");
      // One-shot GPS at the acknowledgement/installation point (best-effort).
      setLocating(true);
      const coords = await capturePosition();
      setLocating(false);
      // create (notes + photos + GPS) THEN sign (signature + name) — mirrors the
      // field do/install → sign split; the sign call bridges to advanceDeliveryItem.
      const created: any = await request(
        { path: `/public/delivery/${token}/report`, method: "POST" },
        {
          kind,
          inventoryId: unitId,
          description,
          photos: photos.map((p) => p.key),
          ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
        },
      );
      const reportId = created?.id ?? created?.data?.id;
      if (!reportId) throw new Error("No report id returned");
      const signature = sigRef.current.toDataUrl();
      await request(
        { path: `/public/delivery/${token}/report/${reportId}/sign`, method: "POST" },
        { signature, signedByName: name.trim() || undefined },
      );
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  // START — confirm only (mirrors delivery-start; no proof captured at start).
  if (isStart) {
    return (
      <Box sx={{ minHeight: "100vh", p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
        <LocalShippingIcon sx={{ fontSize: 80, color: "primary.main", mt: 4 }} />
        <Typography variant="h6" fontWeight={700} textAlign="center">
          Start Delivery
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ maxWidth: 360 }}>
          Confirm you&apos;re taking this item out for delivery.
        </Typography>
        <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1, minWidth: 280, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary" display="block">
            Item
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {itemLabel}
          </Typography>
        </Box>
        {error && (
          <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>
            {error}
          </Alert>
        )}
        <Stack direction="row" spacing={2} sx={{ mt: 2, width: "100%", maxWidth: 360 }}>
          <Button variant="outlined" fullWidth onClick={onBack} disabled={submitting} sx={{ py: 1.5, minHeight: 48 }}>
            Cancel
          </Button>
          <Button variant="contained" fullWidth onClick={submitStart} disabled={submitting} sx={{ py: 1.5, minHeight: 48 }}>
            {submitting ? <CircularProgress size={20} color="inherit" /> : "Confirm & Start"}
          </Button>
        </Stack>
      </Box>
    );
  }

  // ACKNOWLEDGE / COMPLETE — notes + photos + recipient name + signature.
  return (
    <Box sx={{ minHeight: "100vh", p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {itemLabel}
      </Typography>

      <TextField
        label="Notes (optional)"
        placeholder="Any condition issues or remarks"
        multiline
        minRows={3}
        fullWidth
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <PhotoCaptureField
        label={photoLabel}
        photos={photos}
        onChange={setPhotos}
        upload={uploadGuestPhoto}
        onError={(m) => setError(m || null)}
        onUploadingChange={setUploading}
      />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Recipient signature
        </Typography>
        <TextField
          label="Recipient name (optional)"
          size="small"
          fullWidth
          sx={{ mb: 1 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <SignaturePadField ref={sigRef} />
        <Button size="small" onClick={() => sigRef.current?.clear()} sx={{ mt: 0.5 }}>
          Clear
        </Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
        <Button variant="outlined" fullWidth onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button
          variant="contained"
          fullWidth
          onClick={submitAckOrInstall}
          disabled={submitting || uploading}
          sx={{ py: 1.5, minHeight: 48 }}
        >
          {submitting ? (locating ? "Getting location…" : "Submitting…") : "Submit"}
        </Button>
      </Stack>
    </Box>
  );
}
