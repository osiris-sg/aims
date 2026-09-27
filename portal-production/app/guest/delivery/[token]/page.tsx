"use client";

/**
 * Run-scoped guest delivery page (2026-08). An external driver, with only the
 * tokenised URL (no login), can: see the run's items read-only, deliver each one
 * with its condition photos (class-based minimum), then finalize ONCE with the
 * install yes/no and the customer signature. Finalize routes through the run's
 * finalizeRun, so the DO commits and the invoice fires atomically. No skip, no
 * add, no edit, no cancel. Expired / revoked / completed / cancelled links each
 * render a plain message rather than an error.
 *
 * DRIVER mode (2026-09 hand-off): a drv_ link the rider showed as a QR. The
 * driver sees only the trip's loaded items, ends them in one tap (no new
 * photos), then captures the installation answer and the customer signature
 * (partial sign-off: the rest of the run stays open). Afterwards the page offers
 * the signed DO as a view-only link, printable from the browser.
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
  // DRIVER = a rider's hand-off link; GUEST = the office share link.
  mode?: "DRIVER" | "GUEST";
  vehicleNumber?: string | null;
  canEnd?: boolean;
  canSign?: boolean;
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
  // DRIVER mode: ending the trip, and the result of the driver's sign-off.
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [signed, setSigned] = useState<{ signedItemCount: number | null; viewPath: string | null; documentNumber: string | null } | null>(null);

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

  const endTrip = async () => {
    setEnding(true);
    setEndError(null);
    try {
      const res: any = await request({ path: `/public/delivery/${token}/end`, method: "POST" }, {});
      if (res?.success === false) throw new Error(res?.message ?? "Could not end the delivery");
      await load();
    } catch (e: any) {
      setEndError(e?.response?.data?.message || e?.message || "Could not end the delivery");
    } finally {
      setEnding(false);
    }
  };

  // DRIVER: the sign-off is done. The link is closed now, so this screen comes
  // from the finalize response, not a reload.
  if (signed) {
    return (
      <Centered>
        <Stack alignItems="center" spacing={2} sx={{ textAlign: "center", maxWidth: 380, width: "100%" }}>
          <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
          <Typography variant="h6" fontWeight={800}>
            {signed.signedItemCount != null
              ? `Signed for ${signed.signedItemCount} ${signed.signedItemCount === 1 ? "item" : "items"}`
              : "Delivery signed"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Thank you. The delivery order is updated with the customer&apos;s signature. You can view it or print it
            from your browser.
          </Typography>
          {signed.viewPath && (
            <Button fullWidth variant="contained" href={signed.viewPath} target="_blank" rel="noopener" sx={{ minHeight: 48 }}>
              View / Print DO
            </Button>
          )}
          <Typography variant="caption" color="text.secondary">This link is now closed.</Typography>
        </Stack>
      </Centered>
    );
  }

  if (loading) return <Centered><CircularProgress /></Centered>;
  if (loadError && !view) return <Centered><Alert severity="error">{loadError}</Alert></Centered>;
  if (!view) return <Centered><Alert severity="error">Delivery not found.</Alert></Centered>;

  if (view.state !== "ok") {
    const m = STATE_MSG[view.state];
    // A driver link closes when its trip is signed for or the rider hands over again.
    if (view.mode === "DRIVER" && view.state === "revoked") {
      return <StateScreen title="Trip finished" body="This driver link is closed: the trip was signed for, or the rider shared a new link." />;
    }
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
        driver={view.mode === "DRIVER"}
        itemCount={view.deliveryItems.filter((i) => i.deliveryStatus === "not_installed").length}
        upload={uploadGuestPhoto}
        onBack={() => setFinalizing(false)}
        onDone={async (res: any) => {
          setFinalizing(false);
          if (view.mode === "DRIVER" && res?.state === "signed") {
            setSigned({ signedItemCount: res.signedItemCount ?? null, viewPath: res.viewPath ?? null, documentNumber: res.documentNumber ?? null });
            return;
          }
          await load();
        }}
      />
    );
  }

  // ── DRIVER mode ────────────────────────────────────────────────────────────
  if (view.mode === "DRIVER") {
    return (
      <Box sx={{ p: 3, width: "100%", maxWidth: 560, mx: "auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={800}>Delivery #{view.deliveryNumber}</Typography>
          <Typography variant="body2" color="text.secondary">
            {view.documentNumber}{view.customerName ? ` · ${view.customerName}` : ""}
          </Typography>
          {view.vehicleNumber && (
            <Chip size="small" icon={<LocalShippingIcon />} label={`Vehicle ${view.vehicleNumber}`} sx={{ mt: 1 }} />
          )}
        </Box>

        <Typography variant="subtitle2" fontWeight={700}>Items on this trip ({view.deliveryItems.length})</Typography>
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
                </CardContent>
              </Card>
            );
          })}
        </Stack>

        {endError && <Alert severity="error">{endError}</Alert>}

        {view.canEnd && (
          <Button fullWidth variant="contained" startIcon={<LocalShippingIcon />} onClick={endTrip} disabled={ending} sx={{ minHeight: 48 }}>
            {ending ? <CircularProgress size={22} color="inherit" /> : "End Delivery"}
          </Button>
        )}
        {view.canSign && (
          <Button fullWidth variant="contained" color="success" onClick={() => setFinalizing(true)} sx={{ minHeight: 48 }}>
            Get customer signature
          </Button>
        )}
        {!view.canEnd && !view.canSign && (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
            Nothing on this trip is waiting.
          </Typography>
        )}
      </Box>
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
  driver = false,
  itemCount = 0,
  upload,
  onBack,
  onDone,
}: {
  token: string;
  // DRIVER mode signs for the trip only (partial sign-off).
  driver?: boolean;
  itemCount?: number;
  upload: (blob: Blob) => Promise<string | null>;
  onBack: () => void;
  onDone: (result?: any) => void;
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
      onDone(res?.data ?? res);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || "Could not finalize the delivery");
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 560, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" fontWeight={800}>{driver ? "Customer signature" : "Finish delivery"}</Typography>
      {driver && (
        <Typography variant="body2" color="text.secondary">
          This signature covers the {itemCount} {itemCount === 1 ? "item" : "items"} on this trip.
        </Typography>
      )}

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
          {submitting ? (
            <CircularProgress size={22} color="inherit" />
          ) : driver ? (
            `Sign for ${itemCount} ${itemCount === 1 ? "item" : "items"}`
          ) : (
            "Complete delivery"
          )}
        </Button>
      </Stack>
    </Box>
  );
}
