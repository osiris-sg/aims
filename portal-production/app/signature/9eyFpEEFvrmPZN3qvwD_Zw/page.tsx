"use client";

// TEMPORARY (2026-09), PUBLIC, no login: standalone signature capture.
//
// Lives under an unguessable path segment (/signature/9eyFpEEFvrmPZN3qvwD_Zw)
// because there is no token behind it — the URL itself is the only thing
// keeping it private, and middleware.ts matches that exact path. Do not
// shorten the route or make the matcher a prefix.
//
// A client who cannot use the field app signs here: name + signature +
// optional comment. The submission goes straight to S3 for MANUAL backfill
// onto a delivery later — there is no DO, no delivery, no token and no
// database row behind this page. Remove it (and the backend module) once the
// backfill is done.
//
// Deliberately standalone chrome: no nav, no dashboard, no link anywhere else
// in the app. Phone is the primary device.

import React, { useRef, useState } from "react";
import { Alert, Box, Button, Container, Paper, Stack, TextField, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";

const MAX_COMMENT = 1000;

export default function TempSignaturePage() {
  const base = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  const sigRef = useRef<SignaturePadHandle>(null);

  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter your name.");
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("Please draw your signature.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${base}/public/temp-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          signature: sigRef.current.toDataUrl(),
          comment: comment.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const msg = json?.message?.message || json?.message;
        throw new Error(typeof msg === "string" ? msg : "Could not submit. Please try again.");
      }
      // Reset so a second submission is possible if the first was wrong.
      sigRef.current.clear();
      setName("");
      setComment("");
      setDone(true);
    } catch (e: any) {
      setError(e?.message || "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", width: "100%", bgcolor: "#f5f5f5", py: { xs: 2, sm: 5 } }}>
      <Container maxWidth="sm" sx={{ px: { xs: 1.5, sm: 3 } }}>
        <Paper variant="outlined" sx={{ borderRadius: 2, p: { xs: 2, sm: 3 }, bgcolor: "#fff" }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: "#111" }}>
            Signature
          </Typography>
          <Typography variant="body2" sx={{ color: "#555", mt: 0.5, mb: 2.5 }}>
            Please enter your name and sign below.
          </Typography>

          {done && (
            <Alert
              icon={<CheckCircleIcon fontSize="inherit" />}
              severity="success"
              sx={{ mb: 2 }}
              onClose={() => setDone(false)}
            >
              Thank you — your signature has been received. You can sign again below if you need to.
            </Alert>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Stack spacing={2.5}>
            <TextField
              label="Name"
              required
              fullWidth
              size="small"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              inputProps={{ maxLength: 120, autoCapitalize: "words" }}
            />

            <Box>
              <Stack direction="row" alignItems="baseline" sx={{ mb: 0.75 }}>
                <Typography variant="subtitle2" sx={{ color: "#111", flex: 1 }}>
                  Signature
                </Typography>
                <Button
                  size="small"
                  onClick={() => sigRef.current?.clear()}
                  disabled={submitting}
                  sx={{ textTransform: "none" }}
                >
                  Clear
                </Button>
              </Stack>
              <SignaturePadField ref={sigRef} />
            </Box>

            <TextField
              label="Comment (optional)"
              fullWidth
              multiline
              minRows={3}
              size="small"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
              disabled={submitting}
              helperText={`${comment.length} / ${MAX_COMMENT}`}
            />

            <Button
              variant="contained"
              size="large"
              onClick={submit}
              disabled={submitting}
              sx={{ textTransform: "none", py: 1.25 }}
            >
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
