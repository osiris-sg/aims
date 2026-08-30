"use client";

// PUBLIC (no login): the client-facing e-signature page for a quotation.
// Reached from the token URL the designer shares (WhatsApp / e-mail). Shows the
// rendered Letter of Intent exactly as the PDF, then a sign panel: name,
// signature canvas, T&C acceptance. Rendered on a light paper-like page on
// purpose — this is the client's document, not the portal UI.

import React, { useEffect, useRef, useState } from "react";
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
  const [canvasW, setCanvasW] = useState(560);
  const padRef = useRef<HTMLDivElement>(null);

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
    const measure = () => setCanvasW(Math.min(640, (padRef.current?.clientWidth || 600) - 2));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [data]);

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
      <Container maxWidth="md">{children}</Container>
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

      <Paper elevation={0} sx={{ border: "1px solid #ddd", borderRadius: 2, overflow: "hidden", mb: 3, bgcolor: "#fff" }}>
        <iframe title="Quotation" srcDoc={data.html} sandbox="allow-same-origin" style={{ width: "100%", height: "72vh", border: 0, background: "#fff" }} />
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
            <SignatureCanvas ref={sig} penColor="#111" canvasProps={{ width: canvasW, height: 180, style: { display: "block", width: "100%" } }} onBegin={() => setSigEmpty(false)} />
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
