"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// SOW Builder — OSIRIS-INTERNAL tool (guru 2026-09-16). Not in the sidebar on
// purpose: direct URL /portal/admin/sow, and every API call is osirisadmin-
// gated server-side (403 for anyone else). Pick the AIMS modules a customer
// wants, give a rough context blurb (typed or dictated via the mic), and
// Claude drafts the Statement of Work in the house format (CIEL SOW layout).
// The draft is editable section-by-section, downloads as a PDF, and can spawn
// a draft QUOTATION or INVOICE in the Osiris Technology org from the fees.

import React, { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Divider, FormControlLabel,
  Grid, IconButton, Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DownloadIcon from "@mui/icons-material/Download";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import DescriptionIcon from "@mui/icons-material/Description";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

type Fee = { item: string; description: string; fee: string };
type ScopeSection = { letter: string; title: string; bullets: string[] };

export default function SowBuilderPage() {
  const { getToken } = useAuth();
  const router = useRouter();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [modules, setModules] = useState<Array<{ key: string; name: string }>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [customerName, setCustomerName] = useState("");
  const [customerUen, setCustomerUen] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [context, setContext] = useState("");
  const [termNote, setTermNote] = useState("");
  const [fees, setFees] = useState<Fee[]>([
    { item: "Setup & Customisation", description: "One-time setup and customisation of the AIMS platform per the Scope of Work in Section 5.1 (hosting and support included)", fee: "$2,800.00" },
  ]);
  const [paymentSchedule, setPaymentSchedule] = useState("On acceptance of this Agreement: 50% of the Setup & Customisation fee.\nOn project completion at the end of the initial term: the remaining 50%.");

  const [generating, setGenerating] = useState(false);
  const [sow, setSow] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  // ── Voice dictation (Web Speech API — Chrome) ──────────────────────────
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) {
      toast.error("Voice input needs Chrome (Web Speech API not available)");
      return;
    }
    const rec = new SR();
    rec.lang = "en-SG";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
      if (text.trim()) setContext((prev) => (prev ? `${prev.trim()} ${text.trim()}` : text.trim()));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const res = await request({ path: "/sow/modules", method: "GET" }, {}, token || undefined);
      if (res?.success && Array.isArray(res.data)) {
        setModules(res.data);
        setAllowed(true);
      } else {
        setAllowed(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleModule = (key: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const generate = async () => {
    if (!customerName.trim()) return toast.error("Customer name is required");
    if (picked.size === 0) return toast.error("Pick at least one module");
    setGenerating(true);
    try {
      const token = await getToken();
      const res = await request(
        { path: "/sow/generate", method: "POST", timeout: 120000 },
        {
          customerName, customerUen, effectiveDate: effectiveDate || undefined,
          modules: Array.from(picked), context, fees, paymentSchedule, termNote,
        },
        token || undefined
      );
      if (!res?.success || !res.data) throw new Error(res?.message || "Generation failed");
      setSow(res.data);
      toast.success("SOW drafted — review and edit below");
    } catch (e: any) {
      toast.error(e?.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const downloadPdf = async () => {
    if (!sow) return;
    setDownloading(true);
    try {
      const token = await getToken();
      const res = await request({ path: "/sow/pdf", method: "POST", timeout: 120000 }, sow, token || undefined);
      const payload = res?.data;
      if (!res?.success || !payload?.base64) throw new Error(res?.message || "PDF failed");
      const bytes = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = payload.filename || "SOW.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message || "PDF failed");
    } finally {
      setDownloading(false);
    }
  };

  const createDoc = async (type: "QUOTATION" | "INVOICE") => {
    if (!sow) return;
    setCreating(type);
    try {
      const token = await getToken();
      const res = await request(
        { path: "/sow/create-document", method: "POST", timeout: 60000 },
        { type, customerName: sow.customerName, customerUen: sow.customerUen, fees: sow.fees },
        token || undefined
      );
      const doc = res?.data;
      if (!res?.success || !doc?.id) throw new Error(res?.message || "Create failed");
      toast.success(`${type === "QUOTATION" ? "Quotation" : "Invoice"} ${doc.name || ""} created in the Osiris org`);
      router.push(`/portal/documents/${doc.type}/${doc.templateId}/${doc.id}?aorg=d068f159-e45a-4da8-beaf-62e903f44141`);
    } catch (e: any) {
      toast.error(e?.message || "Create failed");
    } finally {
      setCreating(null);
    }
  };

  // Helpers to edit list-sections as one-per-line textareas
  const lines = (arr?: string[]) => (arr || []).join("\n");
  const setLines = (field: string) => (e: any) =>
    setSow((prev: any) => ({ ...prev, [field]: e.target.value.split("\n").filter((s: string) => s.trim()) }));

  if (allowed === null)
    return <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}><CircularProgress /></Box>;
  if (allowed === false)
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="warning">Osiris internal tool — osirisadmin access only.</Alert>
      </Box>
    );

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1200, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>SOW Builder</Typography>
        <Chip size="small" label="Osiris internal" color="warning" variant="outlined" />
      </Stack>
      <Typography sx={{ color: "text.secondary", mb: 3 }}>
        Pick the AIMS modules the customer wants, describe the engagement (type or dictate), and generate a
        Statement of Work in the house format. Review, edit, download the PDF — or raise the quotation/invoice.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={5}>
            <TextField fullWidth size="small" label="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </Grid>
          <Grid item xs={6} md={4}>
            <TextField fullWidth size="small" label="Customer UEN (optional)" value={customerUen} onChange={(e) => setCustomerUen(e.target.value)} />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField fullWidth size="small" label="Effective date (dd-mm-yyyy)" placeholder="today" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Grid>
        </Grid>

        <Typography sx={{ fontWeight: 700, mt: 2.5, mb: 1 }}>Modules</Typography>
        <Grid container spacing={0.5}>
          {modules.map((m) => (
            <Grid item xs={12} sm={6} md={4} key={m.key}>
              <FormControlLabel
                control={<Checkbox size="small" checked={picked.has(m.key)} onChange={() => toggleModule(m.key)} />}
                label={<Typography variant="body2">{m.name}</Typography>}
              />
            </Grid>
          ))}
        </Grid>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2, mb: 0.5 }}>
          <Typography sx={{ fontWeight: 700 }}>Context / rough explanation</Typography>
          <Tooltip title={listening ? "Stop dictation" : "Dictate (Chrome)"}>
            <IconButton size="small" color={listening ? "error" : "primary"} onClick={toggleMic}>
              {listening ? <StopIcon /> : <MicIcon />}
            </IconButton>
          </Tooltip>
          {listening && <Chip size="small" color="error" label="listening…" />}
        </Stack>
        <TextField
          fullWidth multiline minRows={4} size="small"
          placeholder="Who the customer is, what they do, current pain points, workflows, rates, anything commercial — the rougher notes are fine."
          value={context} onChange={(e) => setContext(e.target.value)}
        />

        <Typography sx={{ fontWeight: 700, mt: 2.5, mb: 1 }}>Fees</Typography>
        {fees.map((f, i) => (
          <Grid container spacing={1} key={i} sx={{ mb: 1 }}>
            <Grid item xs={12} md={3}><TextField fullWidth size="small" label="Item" value={f.item} onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} /></Grid>
            <Grid item xs={12} md={6}><TextField fullWidth size="small" label="Description" value={f.description} onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></Grid>
            <Grid item xs={9} md={2}><TextField fullWidth size="small" label="Fee (SGD)" value={f.fee} onChange={(e) => setFees(fees.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))} /></Grid>
            <Grid item xs={3} md={1}><IconButton onClick={() => setFees(fees.filter((_, j) => j !== i))}><DeleteIcon /></IconButton></Grid>
          </Grid>
        ))}
        <Button size="small" startIcon={<AddIcon />} onClick={() => setFees([...fees, { item: "", description: "", fee: "" }])} sx={{ textTransform: "none" }}>
          Add fee row
        </Button>

        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid item xs={12} md={7}>
            <TextField fullWidth multiline minRows={2} size="small" label="Payment schedule (one bullet per line)" value={paymentSchedule} onChange={(e) => setPaymentSchedule(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={5}>
            <TextField fullWidth multiline minRows={2} size="small" label="Commercial / term notes for the AI (optional)" value={termNote} onChange={(e) => setTermNote(e.target.value)} />
          </Grid>
        </Grid>

        <Button
          variant="contained" startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
          disabled={generating} onClick={generate} sx={{ mt: 2.5, textTransform: "none" }}
        >
          {generating ? "Drafting SOW…" : sow ? "Regenerate SOW" : "Generate SOW"}
        </Button>
      </Paper>

      {sow && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1} sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>Draft SOW — {sow.customerName}</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: { xs: "wrap", md: "nowrap" } }}>
              <Button variant="outlined" startIcon={downloading ? <CircularProgress size={14} /> : <DownloadIcon />} disabled={downloading} onClick={downloadPdf} sx={{ textTransform: "none" }}>
                Download PDF
              </Button>
              <Button variant="outlined" startIcon={creating === "QUOTATION" ? <CircularProgress size={14} /> : <DescriptionIcon />} disabled={!!creating} onClick={() => createDoc("QUOTATION")} sx={{ textTransform: "none" }}>
                Create quotation
              </Button>
              <Button variant="outlined" startIcon={creating === "INVOICE" ? <CircularProgress size={14} /> : <ReceiptLongIcon />} disabled={!!creating} onClick={() => createDoc("INVOICE")} sx={{ textTransform: "none" }}>
                Create invoice
              </Button>
            </Stack>
          </Stack>
          <Divider sx={{ mb: 2 }} />

          <Stack spacing={2}>
            <TextField fullWidth size="small" label="Version description" value={sow.versionDescription || ""} onChange={(e) => setSow({ ...sow, versionDescription: e.target.value })} />
            <TextField fullWidth multiline minRows={3} size="small" label="1. Agreement Overview (first paragraph)" value={sow.overview || ""} onChange={(e) => setSow({ ...sow, overview: e.target.value })} />
            <TextField fullWidth size="small" label="2. Goals intro sentence" value={sow.goalsIntro || ""} onChange={(e) => setSow({ ...sow, goalsIntro: e.target.value })} />
            <TextField fullWidth multiline minRows={4} size="small" label="2. Goals (one per line)" value={lines(sow.goals)} onChange={setLines("goals")} />

            <Typography sx={{ fontWeight: 700 }}>5.1 Scope of Work</Typography>
            {(sow.scopeSections || []).map((s: ScopeSection, i: number) => (
              <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                  <TextField size="small" label="Letter" value={s.letter} sx={{ width: 80 }}
                    onChange={(e) => setSow({ ...sow, scopeSections: sow.scopeSections.map((x: any, j: number) => (j === i ? { ...x, letter: e.target.value } : x)) })} />
                  <TextField fullWidth size="small" label="Section title" value={s.title}
                    onChange={(e) => setSow({ ...sow, scopeSections: sow.scopeSections.map((x: any, j: number) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <IconButton onClick={() => setSow({ ...sow, scopeSections: sow.scopeSections.filter((_: any, j: number) => j !== i) })}><DeleteIcon /></IconButton>
                </Stack>
                <TextField fullWidth multiline minRows={3} size="small" label="Bullets (one per line)" value={lines(s.bullets)}
                  onChange={(e) => setSow({ ...sow, scopeSections: sow.scopeSections.map((x: any, j: number) => (j === i ? { ...x, bullets: e.target.value.split("\n").filter((b: string) => b.trim()) } : x)) })} />
              </Paper>
            ))}
            <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: "flex-start", textTransform: "none" }}
              onClick={() => setSow({ ...sow, scopeSections: [...(sow.scopeSections || []), { letter: String.fromCharCode(65 + (sow.scopeSections?.length || 0)), title: "", bullets: [] }] })}>
              Add scope section
            </Button>

            <TextField fullWidth multiline minRows={2} size="small" label="Delivery approach & timeline (one per line)" value={lines(sow.delivery)} onChange={setLines("delivery")} />
            <TextField fullWidth size="small" label="Out of scope" value={sow.outOfScope || ""} onChange={(e) => setSow({ ...sow, outOfScope: e.target.value })} />
            <TextField fullWidth multiline minRows={2} size="small" label="5.2 Extra customer requirements (one per line)" value={lines(sow.customerRequirements)} onChange={setLines("customerRequirements")} />
            <TextField fullWidth multiline minRows={2} size="small" label="5.4 Extra assumptions (one per line)" value={lines(sow.assumptions)} onChange={setLines("assumptions")} />
            <TextField fullWidth multiline minRows={2} size="small" label="5.5 Payment schedule (one per line)" value={lines(sow.paymentSchedule)} onChange={setLines("paymentSchedule")} />
          </Stack>
        </Paper>
      )}
    </Box>
  );

}
