"use client";

/**
 * Run-scoped guest delivery page (2026-08). An external driver, with only the
 * tokenised URL (no login), can: see the run's items read-only, deliver each one
 * with its condition photos (class-based minimum), then finalize ONCE with the
 * install yes/no and the customer signature. Finalize routes through the run's
 * finalizeRun, so the DO commits and the invoice fires atomically. No skip, no
 * add, no edit, no cancel. Expired / revoked / completed / cancelled links each
 * render a plain message rather than an error.
 */

import React, { useCallback, useEffect, useState } from "react";
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
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { request } from "@/helpers/request";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import GuidedPhotoCapture from "@/components/delivery/GuidedPhotoCapture";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";

type ItemStatus = "not_delivered" | "delivering" | "not_installed" | "completed";
type State = "ok" | "expired" | "revoked" | "completed" | "cancelled" | "notfound";

interface GuestItem {
  id: string;
  isFreeTyped: boolean;
  unitSku: string | null;
  description: string;
  quantity: number;
  deliveryStatus: ItemStatus;
  minPhotos: number;
  canDeliver: boolean;
}
interface GuestView {
  state: State;
  deliveryNumber: number | null;
  documentNumber: string | null;
  customerName: string;
  deliveryItems: GuestItem[];
}

const STATE_MSG: Record<Exclude<State, "ok">, { title: string; body: string; done?: boolean }> = {
  expired: { title: "Link expired", body: "This delivery link has expired. Please ask the sender for a new one." },
  revoked: { title: "Link no longer active", body: "This delivery link is no longer active." },
  completed: { title: "Delivery complete", body: "This delivery is already complete. Nothing more to do here.", done: true },
  cancelled: { title: "Delivery cancelled", body: "This delivery was cancelled." },
  notfound: { title: "Link not found", body: "This delivery link was not found." },
};

const STATUS_CHIP: Record<ItemStatus, { label: string; color: "default" | "warning" | "info" | "success" }> = {
  not_delivered: { label: "To deliver", color: "default" },
  delivering: { label: "In progress", color: "warning" },
  not_installed: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
};

function Centered({ children }: { children: React.ReactNode }) {
  return <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>{children}</Box>;
}

function StateScreen({ title, body, done }: { title: string; body: string; done?: boolean }) {
  return (
    <Centered>
      <Stack alignItems="center" spacing={2} sx={{ textAlign: "center", maxWidth: 380 }}>
        {done ? <CheckCircleIcon color="success" sx={{ fontSize: 56 }} /> : <InfoOutlinedIcon color="action" sx={{ fontSize: 56 }} />}
        <Typography variant="h6" fontWeight={800}>{title}</Typography>
        <Typography variant="body2" color="text.secondary">{body}</Typography>
      </Stack>
    </Centered>
  );
}

export default function GuestDeliveryPage() {
  const { token } = useParams() as { token: string };
  const [view, setView] = useState<GuestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<GuestItem | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res: any = await request({ path: `/public/delivery/${token}`, method: "GET" }, {});
      setView((res?.data ?? res) as GuestView);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.response?.data?.message || e?.message || "Could not load this delivery.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadGuestPhoto = async (blob: Blob): Promise<string | null> => {
    const fd = new FormData();
    fd.append("file", blob, "photo.jpg");
    const res: any = await request({ path: `/public/delivery/${token}/photo`, method: "POST" }, fd, undefined, undefined, true, true);
    return res?.Key ?? res?.data?.Key ?? null;
  };

  if (loading) return <Centered><CircularProgress /></Centered>;
  if (loadError && !view) return <Centered><Alert severity="error">{loadError}</Alert></Centered>;
  if (!view) return <Centered><Alert severity="error">Delivery not found.</Alert></Centered>;

  if (view.state !== "ok") {
    const m = STATE_MSG[view.state];
    return <StateScreen title={m.title} body={m.body} done={m.done} />;
  }

  if (active) {
    return (
      <DeliverItemScreen
        token={token}
        item={active}
        upload={uploadGuestPhoto}
        onBack={() => setActive(null)}
        onDone={async () => { setActive(null); await load(); }}
      />
    );
  }

  if (finalizing) {
    return (
      <FinalizeScreen
        token={token}
        upload={uploadGuestPhoto}
        onBack={() => setFinalizing(false)}
        onDone={async () => { setFinalizing(false); await load(); }}
      />
    );
  }

  const toDeliver = view.deliveryItems.filter((i) => i.canDeliver);
  const allDelivered = view.deliveryItems.length > 0 && toDeliver.length === 0;

  return (
    <Box sx={{ p: 3, maxWidth: 560, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h6" fontWeight={800}>Delivery #{view.deliveryNumber}</Typography>
        <Typography variant="body2" color="text.secondary">
          {view.documentNumber}{view.customerName ? ` · ${view.customerName}` : ""}
        </Typography>
      </Box>

      <Stack spacing={1.5}>
        {view.deliveryItems.map((it) => {
          const chip = STATUS_CHIP[it.deliveryStatus];
          return (
            <Card key={it.id} variant="outlined">
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>{it.description}</Typography>
                    {it.unitSku && (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">{it.unitSku}</Typography>
                    )}
                  </Box>
                  <Chip size="small" label={chip.label} color={chip.color} />
                </Stack>
                {it.canDeliver && (
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={<LocalShippingIcon />}
                    onClick={() => setActive(it)}
                    sx={{ mt: 1.5, minHeight: 44 }}
                  >
                    Deliver this item
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      {allDelivered ? (
        <Button fullWidth variant="contained" color="success" onClick={() => setFinalizing(true)} sx={{ minHeight: 48 }}>
          Get customer signature
        </Button>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
          Deliver every item, then capture the customer signature to finish.
        </Typography>
      )}
    </Box>
  );
}

function DeliverItemScreen({
  token,
  item,
  upload,
  onBack,
  onDone,
}: {
  token: string;
  item: GuestItem;
  upload: (blob: Blob) => Promise<string | null>;
  onBack: () => void;
  onDone: () => void;
}) {
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guided = item.minPhotos > 1;

  const submit = async () => {
    setError(null);
    if (photos.length < item.minPhotos) {
      setError(item.minPhotos === 1 ? "A condition photo is required." : `This item needs ${item.minPhotos} condition photos.`);
      return;
    }
    setSubmitting(true);
    try {
      const res: any = await request(
        { path: `/public/delivery/${token}/items/${encodeURIComponent(item.id)}/deliver`, method: "POST" },
        { photos: photos.map((p) => p.key) },
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not deliver this item");
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Could not deliver this item");
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 560, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" fontWeight={800}>{item.description}</Typography>
      <Typography variant="body2" color="text.secondary">
        Take {item.minPhotos === 1 ? "a condition photo" : `${item.minPhotos} condition photos`} of the item, then confirm delivery.
      </Typography>

      {guided ? (
        <GuidedPhotoCapture
          photos={photos}
          onChange={setPhotos}
          upload={upload}
          minPhotos={item.minPhotos}
          onError={(m) => setError(m || null)}
          onUploadingChange={setUploading}
        />
      ) : (
        <PhotoCaptureField
          label="Condition photo (required)"
          photos={photos}
          onChange={setPhotos}
          upload={upload}
          onError={(m) => setError(m || null)}
          onUploadingChange={setUploading}
        />
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1}>
        <Button variant="outlined" fullWidth onClick={onBack} disabled={submitting} sx={{ minHeight: 48 }}>Back</Button>
        <Button
          variant="contained"
          fullWidth
          onClick={submit}
          disabled={submitting || uploading || photos.length < item.minPhotos}
          sx={{ minHeight: 48 }}
        >
          {submitting ? <CircularProgress size={22} color="inherit" /> : "Confirm delivery"}
        </Button>
      </Stack>
    </Box>
  );
}

function FinalizeScreen({
  token,
  upload,
  onBack,
  onDone,
}: {
  token: string;
  upload: (blob: Blob) => Promise<string | null>;
  onBack: () => void;
  onDone: () => void;
}) {
  const [installNeeded, setInstallNeeded] = useState<"yes" | "no" | null>(null);
  const [installPhotos, setInstallPhotos] = useState<CapturedPhoto[]>([]);
  const [signedByName, setSignedByName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sigRef = React.useRef<SignaturePadHandle>(null);

  const submit = async () => {
    setError(null);
    if (installNeeded === null) {
      setError("Please answer whether installation was needed.");
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("The customer needs to sign to complete the delivery.");
      return;
    }
    setSubmitting(true);
    try {
      const res: any = await request(
        { path: `/public/delivery/${token}/finalize`, method: "POST" },
        {
          signature: sigRef.current.toDataUrl(),
          ...(signedByName.trim() ? { signedByName: signedByName.trim() } : {}),
          installNeeded: installNeeded === "yes",
          ...(installNeeded === "yes" && installPhotos.length ? { installPhotos: installPhotos.map((p) => p.key) } : {}),
        },
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not finalize the delivery");
      onDone();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Could not finalize the delivery");
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 560, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" fontWeight={800}>Finish delivery</Typography>

      <Typography variant="subtitle2" fontWeight={700}>Installation needed?</Typography>
      <Stack direction="row" spacing={1.5}>
        <Button fullWidth variant={installNeeded === "yes" ? "contained" : "outlined"} onClick={() => setInstallNeeded("yes")} sx={{ minHeight: 48 }}>
          Yes, installed
        </Button>
        <Button fullWidth variant={installNeeded === "no" ? "contained" : "outlined"} onClick={() => setInstallNeeded("no")} sx={{ minHeight: 48 }}>
          No install needed
        </Button>
      </Stack>
      {installNeeded === "yes" && (
        <PhotoCaptureField
          label="Installation photos (optional)"
          photos={installPhotos}
          onChange={setInstallPhotos}
          upload={upload}
          onError={(m) => setError(m || null)}
          onUploadingChange={setUploading}
        />
      )}

      <TextField label="Signed by (name)" value={signedByName} onChange={(e) => setSignedByName(e.target.value)} size="small" fullWidth />
      <Typography variant="subtitle2">Customer signature</Typography>
      <SignaturePadField ref={sigRef} />

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={1}>
        <Button variant="outlined" fullWidth onClick={onBack} disabled={submitting} sx={{ minHeight: 48 }}>Back</Button>
        <Button variant="contained" color="success" fullWidth onClick={submit} disabled={submitting || uploading} sx={{ minHeight: 48 }}>
          {submitting ? <CircularProgress size={22} color="inherit" /> : "Complete delivery"}
        </Button>
      </Stack>
    </Box>
  );
}
