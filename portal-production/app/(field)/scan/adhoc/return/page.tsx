"use client";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { capturePosition } from "@/helpers/geolocation";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import { useFieldAppBar } from "@/app/(field)/components/FieldAppBar";
import { FIELD_BUTTON_SX } from "@/app/(field)/components/fieldUi";
import FieldBackButton from "../../../components/FieldBackButton";

/**
 * AD-HOC RETURN, screen 1 (2026-10-22): the rider keys in the ID of every item
 * they are bringing back (serial or SKU), optionally where it was collected
 * from and up to 8 photos per item. Continue creates the return run
 * (POST /deliveries/adhoc-return): each ID that matches a unit out on rental
 * becomes a normal unit return line and is collected (stock back to instock);
 * anything else becomes an "Untagged item: <ID>" line for the office. The
 * review + customer signature is screen 2 (/scan/adhoc/return/:id/sign).
 */

const MAX_PHOTOS = 8;
const MAX_LINES = 50;

interface Line {
  key: number;
  id: string;
  photos: CapturedPhoto[];
}

export default function AdHocReturnEntryPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();
  const [lines, setLines] = useState<Line[]>([{ key: 1, id: "", photos: [] }]);
  const [collectedFrom, setCollectedFrom] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.replace("/scan/adhoc");
  }, [router]);
  useFieldAppBar({ title: "New return", onBack: goBack, backDisabled: submitting });

  const uploadPhoto = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-start", token });
  };

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((prev) => (prev.length >= MAX_LINES ? prev : [...prev, { key: (prev[prev.length - 1]?.key ?? 0) + 1, id: "", photos: [] }]));
  const removeLine = (key: number) => setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));

  const filled = lines.filter((l) => l.id.trim());
  const canContinue = filled.length > 0 && !uploading && !submitting;

  const technicianName =
    user?.fullName ?? user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? undefined;

  const submit = async () => {
    if (!canContinue) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const gps = await capturePosition().catch(() => null);
      const res = await request(
        { path: "/deliveries/adhoc-return", method: "POST" },
        {
          lines: filled.map((l) => ({ id: l.id.trim(), ...(l.photos.length ? { photos: l.photos.map((p) => p.key) } : {}) })),
          ...(collectedFrom.trim() ? { collectedFrom: collectedFrom.trim() } : {}),
          ...(technicianName ? { riderName: technicianName, technicianName } : {}),
          ...(gps ? { latitude: gps.latitude, longitude: gps.longitude } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not start the return");
      const run = res?.data ?? res;
      const id = run?.id;
      if (!id) throw new Error("No return id returned");
      // replace: the run exists now, so Back must not re-submit this form.
      router.replace(`/scan/adhoc/return/${id}/sign`);
    } catch (e: any) {
      setError(e?.message ?? "Could not start the return");
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <AssignmentReturnIcon color="primary" sx={{ fontSize: 32 }} />
        <Typography variant="body2" color="text.secondary">
          Key in the ID on each item you are bringing back. A known unit is returned to stock; an unknown ID is kept for the office to sort out.
        </Typography>
      </Stack>

      {lines.map((l, idx) => (
        <Paper key={l.key} variant="outlined" sx={{ borderRadius: "16px", p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>
              Item {idx + 1}
            </Typography>
            {lines.length > 1 && (
              <IconButton aria-label="Remove this item" size="small" onClick={() => removeLine(l.key)} disabled={submitting}>
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
          <TextField
            label="Item ID"
            placeholder="Serial or SKU"
            value={l.id}
            onChange={(e) => setLine(l.key, { id: e.target.value })}
            required
            fullWidth
            size="small"
            inputProps={{ autoCapitalize: "characters", autoCorrect: "off", spellCheck: false, maxLength: 120 }}
            disabled={submitting}
            sx={{ mb: 2 }}
          />
          <PhotoCaptureField
            label="Photos (optional)"
            photos={l.photos}
            onChange={(photos) => setLine(l.key, { photos })}
            upload={uploadPhoto}
            onError={(m) => setError(m || null)}
            onUploadingChange={setUploading}
            maxPhotos={MAX_PHOTOS}
            disabled={submitting}
          />
        </Paper>
      ))}

      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={addLine}
        disabled={submitting || lines.length >= MAX_LINES}
        fullWidth
        sx={FIELD_BUTTON_SX}
      >
        Add another item
      </Button>

      <TextField
        label="Collected from (optional)"
        placeholder="Customer or site"
        value={collectedFrom}
        onChange={(e) => setCollectedFrom(e.target.value)}
        fullWidth
        size="small"
        inputProps={{ maxLength: 300 }}
        disabled={submitting}
      />

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Button variant="contained" onClick={() => void submit()} disabled={!canContinue} fullWidth sx={FIELD_BUTTON_SX}>
        {submitting ? <CircularProgress size={22} color="inherit" /> : `Continue${filled.length ? ` (${filled.length})` : ""}`}
      </Button>

      <FieldBackButton disabled={submitting} />
    </Box>
  );
}
