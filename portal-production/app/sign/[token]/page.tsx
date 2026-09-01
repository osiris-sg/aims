"use client";

// PUBLIC (no login): the client-facing e-signature page for a quotation.
// Reached from the token URL the designer shares (WhatsApp / e-mail). Shows the
// rendered Letter of Intent exactly as the PDF, then a sign panel: name,
// signature canvas, T&C acceptance. Rendered on a light paper-like page on
// purpose — this is the client's document, not the portal UI.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Box, Button, Checkbox, CircularProgress, Container, FormControlLabel, Paper, Stack, TextField, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DownloadIcon from "@mui/icons-material/Download";
import SignatureCanvas from "react-signature-canvas";

type Payload = {
  state: "active" | "signed" | "revoked" | "expired" | "notfound";
  document: { number: string | null; clientName: string; address: string; designer: string; grandTotal: number; currency: string };
  organization: { name: string; logo: string | null; phoneNumber: string | null };
  expiresAt?: string | null;
  signedAt?: string | null;
  signerName?: string | null;
  html?: string;
  pdfUrl?: string | null;
};

const money = (n: number) => new Intl.NumberFormat("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }) : "");

export default function PublicSignPage() {
  const { token } = useParams<{ token: string }>();
  const base = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ signedAt: string } | null>(null);
  const sig = useRef<SignatureCanvas>(null);
  const [sigEmpty, setSigEmpty] = useState(true);
  const [canvasW, setCanvasW] = useState(560); // logical (CSS px) canvas width = container width
  const [dpr, setDpr] = useState(1); // devicePixelRatio; backing store = logical * dpr for a crisp signature
  const padRef = useRef<HTMLDivElement>(null);
  // Auto-size the quotation iframe to its content height (null until first
  // measured / if unreadable → the style falls back to 72vh).
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [iframeH, setIframeH] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${base}/public/sign/${token}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || "This link is not valid");
        const p: Payload = json?.data ?? json;
        setData(p);
        setName(p.document?.clientName || "");
      } catch (e: any) {
        setError(e.message || "This link is not valid");
      }
    })();
  }, [base, token]);

  useEffect(() => {
    // Logical width tracks the container EXACTLY (no 640 cap, no -2) so the
    // backing width (= logical * dpr, set on the canvas below) equals the
    // displayed width and the pen lands under the cursor. Re-read dpr too — it
    // changes on browser zoom / moving the window between monitors.
    const measure = () => {
      setCanvasW(padRef.current?.clientWidth || 600);
      setDpr(window.devicePixelRatio || 1);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [data]);

  // HiDPI + stale-drawing guard. Changing the canvas backing store (the
  // width/height attributes below, driven by canvasW/dpr) RESETS the 2D
  // transform and wipes the pixels, so after every such change we (1) re-apply
  // the dpr scale via setTransform, so signature_pad's CSS-pixel points render
  // crisp and in the right place, and (2) clear the pad and mark it empty —
  // keeping the old point buffer would redraw the stroke at the wrong scale.
  // On resize we deliberately CLEAR rather than replay: re-signing is trivial,
  // and replaying rescaled strokes for a legal signature is not worth the risk.
  useEffect(() => {
    const canvas = sig.current?.getCanvas();
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sig.current?.clear();
    setSigEmpty(true);
  }, [canvasW, dpr, data]);

  // Fit the quotation iframe to its own content height so it is not trapped in
  // a fixed 72vh scroll box. sandbox="allow-same-origin" keeps contentDocument
  // readable; if it is ever unreadable we leave the height null and the style
  // falls back to 72vh (with the iframe's own internal scroll).
  const measureFrame = useCallback(() => {
    try {
      const doc = frameRef.current?.contentDocument;
      const h = doc?.body?.scrollHeight || doc?.documentElement?.scrollHeight || 0;
      if (h > 0) setIframeH(h + 24); // small buffer so the last line never clips
    } catch {
      /* unreadable → keep null; CSS falls back to 72vh */
    }
  }, []);
  useEffect(() => {
    window.addEventListener("resize", measureFrame);
    return () => window.removeEventListener("resize", measureFrame);
  }, [measureFrame]);

  const submit = async () => {
    if (!sig.current || sig.current.isEmpty()) {
      setSigEmpty(true);
      return;
    }
    setSubmitting(true);
    try {
      const signatureDataUrl = sig.current.getTrimmedCanvas().toDataURL("image/png");
      const res = await fetch(`${base}/public/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName: name.trim(), signatureDataUrl, agreed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message?.message || json?.message || "Could not submit signature");
      const r = json?.data ?? json;
      setDone({ signedAt: r.signedAt });
      // Refresh so the rendered document shows the signature + PDF link.
      const again = await fetch(`${base}/public/sign/${token}`);
      const j2 = await again.json();
      setData(j2?.data ?? j2);
    } catch (e: any) {
      setError(e.message || "Could not submit signature");
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", color: "#111", py: { xs: 2, md: 5 } }}>
      <Container maxWidth="lg">{children}</Container>
    </Box>
  );

  if (error && !data) return shell(<Alert severity="error">{error}</Alert>);
  if (!data)
    return shell(
      <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
        <CircularProgress />
      </Box>,
    );

  const org = data.organization;
  const d = data.document;
  const header = (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
      {org.logo ? <img src={org.logo} alt={org.name} style={{ maxHeight: 44, maxWidth: 180, objectFit: "contain" }} /> : <Typography variant="h6" sx={{ fontWeight: 800 }}>{org.name}</Typography>}
      <Box sx={{ flex: 1 }} />
      <Box sx={{ textAlign: "right" }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Quotation {d.number}
        </Typography>
        <Typography variant="body2" sx={{ color: "#555" }}>
          {d.clientName}
          {d.address ? ` · ${d.address.split("\n")[0]}` : ""}
        </Typography>
      </Box>
    </Stack>
  );

  if (data.state === "revoked" || data.state === "expired" || data.state === "notfound") {
    return shell(
      <>
        {header}
        <Alert severity="warning">
          {data.state === "expired" ? `This quotation link expired on ${fmtDate(data.expiresAt)}.` : "This quotation link is no longer active."} Please contact {org.name}
          {org.phoneNumber ? ` at ${org.phoneNumber}` : ""} for an updated copy.
        </Alert>
      </>,
    );
  }

  const signed = data.state === "signed" || !!done;

  return shell(
    <>
      {header}
      {signed && (
        <Alert icon={<CheckCircleIcon fontSize="inherit" />} severity="success" sx={{ mb: 2, alignItems: "center" }} action={data.pdfUrl ? <Button color="inherit" size="small" startIcon={<DownloadIcon />} href={data.pdfUrl} target="_blank" rel="noreferrer">PDF</Button> : undefined}>
          Signed by <b>{data.signerName || name}</b> on {fmtDate(data.signedAt || done?.signedAt)}. Thank you — {org.name} has been notified.
        </Alert>
      )}

      <Paper elevation={0} sx={{ border: "1px solid #ddd", borderRadius: 2, overflow: "hidden", mb: 3, bgcolor: "#fff", p: { xs: 1.5, md: 3 } }}>
        {/* The srcDoc HTML is only <style> + <div class="idq"> — no <body>
            margin, no max-width — so the document renders flush; the Paper
            padding (12/24px) gives it breathing room. Height auto-fits the
            content (measureFrame on load + resize) and falls back to 72vh with
            the iframe's own scroll if the content height is ever unreadable. */}
        <iframe
          ref={frameRef}
          title="Quotation"
          srcDoc={data.html}
          sandbox="allow-same-origin"
          onLoad={measureFrame}
          style={{ display: "block", width: "100%", height: iframeH ? `${iframeH}px` : "72vh", minHeight: 200, border: 0, background: "#fff" }}
        />
      </Paper>

      {!signed && (
        <Paper elevation={0} sx={{ border: "1px solid #ddd", borderRadius: 2, p: { xs: 2, md: 3 }, bgcolor: "#fff" }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            Accept this quotation
          </Typography>
          <Typography variant="body2" sx={{ color: "#555", mb: 2 }}>
            Grand total <b>{d.currency} {money(d.grandTotal)}</b>. Sign below to accept the works and the General Terms &amp; Conditions on the last page.
            {data.expiresAt ? ` This link is valid until ${fmtDate(data.expiresAt)}.` : ""}
          </Typography>
          <TextField label="Your full name" fullWidth size="small" value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 2 }} />
          <Typography variant="caption" sx={{ color: "#555" }}>
            Draw your signature
          </Typography>
          <Box ref={padRef} sx={{ border: "1px dashed #bbb", borderRadius: 1.5, bgcolor: "#fafafa", mb: 1, position: "relative", touchAction: "none" }}>
            <SignatureCanvas
              ref={sig}
              penColor="#111"
              canvasProps={{
                // Backing store = logical * dpr (crisp on retina); CSS stays at
                // the logical size so displayed width === backing / dpr and the
                // pen tracks the cursor. The 2D context is scaled by dpr in the
                // effect above. Height stays 180 logical.
                width: Math.round(canvasW * dpr),
                height: Math.round(180 * dpr),
                style: { display: "block", width: `${canvasW}px`, height: "180px" },
              }}
              onBegin={() => setSigEmpty(false)}
            />
            <Button
              size="small"
              onClick={() => {
                sig.current?.clear();
                setSigEmpty(true);
              }}
              sx={{ position: "absolute", right: 6, top: 6, textTransform: "none", color: "#666" }}
            >
              Clear
            </Button>
          </Box>
          <FormControlLabel control={<Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />} label={<Typography variant="body2">I have read and agree to the quotation and the General Terms &amp; Conditions.</Typography>} sx={{ mb: 1.5, alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0.25 } }} />
          {error && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {error}
            </Alert>
          )}
          <Button variant="contained" size="large" disabled={submitting || !name.trim() || !agreed || sigEmpty} onClick={submit} sx={{ textTransform: "none", bgcolor: "#111", "&:hover": { bgcolor: "#333" } }}>
            {submitting ? "Submitting…" : "Sign & accept"}
          </Button>
          <Typography variant="caption" sx={{ display: "block", color: "#777", mt: 1.5 }}>
            By signing you agree that this electronic signature is the legal equivalent of your handwritten signature on this agreement. Your name, signature, time and IP address are recorded.
          </Typography>
        </Paper>
      )}
    </>,
  );
}
