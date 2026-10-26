"use client";

/**
 * Remote customer signature for SERVICE REPORTS (2026-10-26).
 *
 * The service-report twin of the guest DO page (/guest/do/[token]): a no-login
 * customer opens the tokenised link the technician or office sent, sees which
 * report(s) they are signing for (each with its PDF), reads the same
 * certification the field app shows, and signs ONCE. One link may cover
 * several reports of one customer — the field's "Sign all N".
 *
 * The write is a single token-scoped POST carrying a name and a PNG and
 * nothing addressable; the server runs the same sign() as the on-site flow.
 * Afterwards the link reads "already signed" with the signed PDFs. A revoked,
 * expired or unknown token shows one neutral message.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { request } from "@/helpers/request";
import SignaturePadField, { type SignaturePadHandle } from "@/components/delivery/SignaturePadField";

type LinkState = "active" | "signed" | "revoked" | "expired" | "notfound";

interface ReportSummary {
  id: string;
  reportNumber: number | null;
  model: string | null;
  serial: string | null;
  serviceDate: string | null;
  jobLocation: string | null;
  technicianName: string | null;
  signed: boolean;
  signedByName: string | null;
}

interface View {
  state: LinkState;
  organization?: { name: string; logo: string | null; phoneNumber: string | null };
  customerName?: string | null;
  suggestedSignerName?: string | null;
  reports?: ReportSummary[];
  signedAt?: string | null;
  signerName?: string | null;
}

const API = (process.env.NEXT_PUBLIC_BACKEND_API_URL || "").replace(/\/$/, "");
const RESOURCE = process.env.NEXT_PUBLIC_RESOURCE_URL || "";
const logoSrc = (logo: string | null | undefined) => (!logo ? null : /^(https?:|data:)/i.test(logo) ? logo : `${RESOURCE}${logo}`);

function NeutralMessage() {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Card sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>
          Link not available
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This link is not available. Please ask the sender for a current one.
        </Typography>
      </Card>
    </Container>
  );
}

export default function ServiceReportSignPage() {
  const params = useParams();
  const token = params?.token as string;

  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const load = useCallback(async () => {
    try {
      const res: any = await request({ path: `/public/service-report/${token}`, method: "GET" }, {});
      const v = (res?.data ?? res) as View;
      if (!v || (v as any).success === false || !v.state) throw new Error("bad");
      setView(v);
      setName((prev) => prev || v.suggestedSignerName || "");
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = useCallback(async () => {
    setError(null);
    const signer = name.trim();
    if (!signer) return setError("Please enter your name.");
    if (!padRef.current || padRef.current.isEmpty()) return setError("Please sign in the box.");
    setSigning(true);
    try {
      const res: any = await request(
        { path: `/public/service-report/${token}/sign`, method: "POST" },
        { name: signer, signature: padRef.current.toDataUrl() },
      );
      const body = res?.data ?? res;
      // request() resolves (never throws) on an HTTP error: branch on it first.
      if (body?.success === false) {
        setError(body?.message || "Could not save the signature. Please try again.");
        return;
      }
      if (body?.ok === false) {
        setError(body?.message || "These reports could not be signed.");
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not save the signature. Please try again.");
    } finally {
      setSigning(false);
    }
  }, [name, token, load]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (failed || !view || view.state === "notfound" || view.state === "revoked" || view.state === "expired") {
    return <NeutralMessage />;
  }

  const reports = view.reports ?? [];
  const n = reports.length;
  const logo = logoSrc(view.organization?.logo);
  const signed = view.state === "signed";
  const pdfUrl = (id: string) => `${API}/public/service-report/${token}/pdf/${id}`;
  const label = (r: ReportSummary) => `Report #${r.reportNumber ?? "—"} · ${[r.model, r.serial].filter(Boolean).join(" · ") || "Service report"}`;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", py: { xs: 2, sm: 5 } }}>
      <Container maxWidth="sm">
        <Card sx={{ p: { xs: 2.5, sm: 4 } }}>
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={2} alignItems="center">
              {logo && <Box component="img" src={logo} alt="" sx={{ maxHeight: 40, maxWidth: 140, objectFit: "contain" }} />}
              <Box>
                <Typography variant="subtitle1" fontWeight={700}>{view.organization?.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {signed ? "Service report signed" : `Service report${n === 1 ? "" : "s"} for your signature`}
                </Typography>
              </Box>
            </Stack>

            {view.customerName && (
              <Typography variant="body2">
                <strong>Customer:</strong> {view.customerName}
              </Typography>
            )}

            <List disablePadding sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
              {reports.map((r, i) => (
                <React.Fragment key={r.id}>
                  {i > 0 && <Divider component="li" />}
                  <ListItem
                    secondaryAction={
                      <Button size="small" startIcon={<PictureAsPdfIcon />} href={pdfUrl(r.id)} target="_blank" rel="noopener">
                        PDF
                      </Button>
                    }
                  >
                    <ListItemText
                      primary={label(r)}
                      secondary={[r.serviceDate, r.jobLocation, r.technicianName ? `Technician: ${r.technicianName}` : null].filter(Boolean).join(" · ")}
                    />
                  </ListItem>
                </React.Fragment>
              ))}
            </List>

            {signed ? (
              <Alert severity="success" icon={<CheckCircleIcon />}>
                Already signed{view.signerName ? ` by ${view.signerName}` : ""}
                {view.signedAt ? ` on ${new Date(view.signedAt).toLocaleString()}` : ""}. Thank you. The signed report
                {n === 1 ? " is" : "s are"} available above.
              </Alert>
            ) : (
              <Stack spacing={1.5}>
                <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                  I / WE, the undersigned, certify that the above services are satisfied &amp; have examined the said
                  machines are in good and proper condition.
                </Typography>
                {n > 1 && (
                  <Typography variant="caption" color="text.secondary">
                    One signature covers all {n} reports.
                  </Typography>
                )}
                {error && <Alert severity="error">{error}</Alert>}
                <TextField
                  label="Client name"
                  size="small"
                  fullWidth
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={signing}
                  inputProps={{ maxLength: 120 }}
                />
                <Box sx={{ "& > div": { borderStyle: "solid", borderWidth: "1px", borderColor: "text.secondary" } }}>
                  <SignaturePadField ref={padRef} />
                </Box>
                <Stack direction="row" justifyContent="space-between">
                  <Button size="small" onClick={() => padRef.current?.clear()} disabled={signing}>
                    Clear
                  </Button>
                  <Button variant="contained" onClick={submit} disabled={signing} sx={{ minWidth: 140, minHeight: 44 }}>
                    {signing ? <CircularProgress size={20} color="inherit" /> : n > 1 ? `Sign all ${n}` : "Sign"}
                  </Button>
                </Stack>
              </Stack>
            )}
          </Stack>
        </Card>
        {view.organization?.phoneNumber && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 2 }}>
            Questions? Call {view.organization.name} at {view.organization.phoneNumber}
          </Typography>
        )}
      </Container>
    </Box>
  );
}
