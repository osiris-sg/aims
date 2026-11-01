"use client";

import React, { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Box, Button, CircularProgress, IconButton, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloseIcon from "@mui/icons-material/Close";
import { uploadFile, publicFileUrl } from "@/helpers/fileUploader";
import { FileValue, JobFieldDef, jobFieldProblem } from "@/helpers/jobFields";
import JobFieldIcon from "./JobFieldIcon";

/**
 * Custom job fields (enableJobFields, 2026-11-01): the org's own fields on a
 * job — yes/no, text, date, file upload, link — as a controlled block for the
 * schedule dialog and the delivery page. values = { fieldId: value }.
 */
export default function JobFieldsEditor({
  fields,
  values,
  onChange,
  checkRequired = false,
  disabled,
}: {
  fields: JobFieldDef[];
  values: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  /** Mark required fields (a real schedule, not a draft). */
  checkRequired?: boolean;
  disabled?: boolean;
}) {
  const { getToken } = useAuth();
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  if (!fields.length) return null;
  const set = (id: string, v: any) => onChange({ ...values, [id]: v });

  const upload = async (f: JobFieldDef, file?: File) => {
    if (!file) return;
    setUploading(f.id);
    setUploadError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const meta = await uploadFile({ file, folder: "job-fields", token });
      set(f.id, { fileKey: meta.fileKey, fileName: meta.fileName, mimeType: meta.mimeType } as FileValue);
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  return (
    <Stack spacing={1.5} data-tour="job-fields-editor">
      {fields.map((f) => {
        const v = values[f.id];
        const problem = jobFieldProblem(f, v, { checkRequired });
        const label = `${f.displayLabel}${f.required ? " *" : ""}`;
        const head = (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <JobFieldIcon icon={f.display?.icon} fontSize="small" color="action" />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {label}
            </Typography>
          </Stack>
        );
        if (f.fieldType === "boolean") {
          return (
            <Stack key={f.id} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              {head}
              <ToggleButtonGroup size="small" exclusive disabled={disabled} value={v === true ? "yes" : v === false ? "no" : ""} onChange={(_, nv) => set(f.id, nv === "yes" ? true : nv === "no" ? false : null)}>
                <ToggleButton value="yes">Yes</ToggleButton>
                <ToggleButton value="no">No</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          );
        }
        if (f.fieldType === "file") {
          const fv = v as FileValue | null | undefined;
          return (
            <Box key={f.id}>
              {head}
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                {fv?.fileKey ? (
                  <>
                    <a href={publicFileUrl(fv.fileKey)} target="_blank" rel="noopener noreferrer">
                      {fv.fileName || "File"}
                    </a>
                    <IconButton size="small" aria-label={`Remove ${f.displayLabel}`} disabled={disabled} onClick={() => set(f.id, null)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </>
                ) : (
                  <Button size="small" variant="outlined" component="label" startIcon={uploading === f.id ? <CircularProgress size={14} /> : <CloudUploadIcon />} disabled={disabled || !!uploading}>
                    Upload
                    <input hidden type="file" accept="application/pdf,image/*" onChange={(e) => void upload(f, e.target.files?.[0])} />
                  </Button>
                )}
              </Stack>
              {problem && (
                <Typography variant="caption" color="error">
                  {problem}
                </Typography>
              )}
            </Box>
          );
        }
        return (
          <TextField
            key={f.id}
            size="small"
            fullWidth
            disabled={disabled}
            type={f.fieldType === "date" ? "date" : f.fieldType === "url" ? "url" : "text"}
            label={label}
            value={v ?? ""}
            onChange={(e) => set(f.id, e.target.value)}
            placeholder={f.fieldType === "url" ? "https://" : undefined}
            InputLabelProps={f.fieldType === "date" ? { shrink: true } : undefined}
            error={!!problem && v !== undefined}
            helperText={v !== undefined ? problem || " " : " "}
          />
        );
      })}
      {uploadError && (
        <Typography variant="caption" color="error">
          {uploadError}
        </Typography>
      )}
    </Stack>
  );
}
