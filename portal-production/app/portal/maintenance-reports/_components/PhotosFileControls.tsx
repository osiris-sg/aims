"use client";

import React, { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { request } from "@/helpers/request";
import { uploadFile } from "@/helpers/fileUploader";
import { useOrganization } from "@hooks/useOrganization";

/** serviceData.photosFile as the API stores it. */
export type PhotosFile = { key: string; fileName: string; mimeType: string; addedAt?: string } | null;

export const REPORT_FILE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/gif";

/**
 * "Attach photos" on a service report (2026-11-12): ONE file, a PDF or an
 * image. Once attached it reads Replace photos / Remove photos; Remove asks
 * first. `onChange` gets the new photosFile (null after Remove).
 */
export default function PhotosFileControls({
  reportId,
  photosFile,
  onChange,
  onError,
}: {
  reportId: string;
  photosFile: PhotosFile;
  onChange: (next: PhotosFile) => void;
  onError: (message: string) => void;
}) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file || !organization?.id) return;
    setBusy("upload");
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const up = await uploadFile({ file, folder: `maintenance-reports/${organization.id}/photos`, token });
      const res: any = await request(
        { path: `/maintenance-reports/${reportId}/photos-file`, method: "PUT" },
        { fileKey: up.fileKey, fileName: up.fileName, mimeType: up.mimeType },
        token,
      );
      if (res?.success === false) throw new Error(res.message || "Could not attach the photos");
      const row = res?.data ?? res;
      onChange(row?.serviceData?.photosFile ?? null);
    } catch (e: any) {
      onError(e?.message ?? "Could not attach the photos");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setBusy("remove");
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res: any = await request({ path: `/maintenance-reports/${reportId}/photos-file`, method: "DELETE" }, {}, token);
      if (res?.success === false) throw new Error(res.message || "Could not remove the photos");
      onChange(null);
    } catch (e: any) {
      onError(e?.message ?? "Could not remove the photos");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <input ref={input} type="file" hidden accept={REPORT_FILE_ACCEPT} onChange={(e) => void pick(e.target.files?.[0])} />
      <Button
        variant="outlined"
        startIcon={busy === "upload" ? <CircularProgress size={16} color="inherit" /> : <AddPhotoAlternateIcon />}
        onClick={() => input.current?.click()}
        disabled={!!busy}
        data-tour="service-report-attach-photos"
      >
        {photosFile ? "Replace photos" : "Attach photos"}
      </Button>
      {photosFile && (
        <Button
          variant="outlined"
          color="error"
          startIcon={busy === "remove" ? <CircularProgress size={16} color="inherit" /> : <DeleteOutlineIcon />}
          onClick={() => setConfirmRemove(true)}
          disabled={!!busy}
        >
          Remove photos
        </Button>
      )}
      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove the photos?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {photosFile?.fileName ? `"${photosFile.fileName}" will be removed from this report.` : "The photos file will be removed from this report."} The report itself is not changed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void remove()}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
