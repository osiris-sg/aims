"use client";

// PUBLIC (no login): the client's live project schedule. The token URL is
// shared by the designer on WhatsApp; every visit shows the LATEST calendar.
// Rendered responsively (agenda rows on phones, 7-day grid on desktop) —
// the A4 print layout stays behind the Print button. Paper-styled on purpose;
// deliberately a single light look (this is the client's document, not the
// portal UI).

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Box, Button, Chip, CircularProgress, Container, Paper, Stack, Typography, useMediaQuery } from "@mui/material";
import PrintIcon from "@mui/icons-material/PrintOutlined";

type Day = { iso: string; dow: string; holiday: string | null; work: string[]; notes: string[] };
type Payload = {
  header: { projectSite: string; contractNo: string | null; manager: string | null; contact: string | null; orgName: string; logo: string | null };
  weeks: Array<{ index: number; days: Day[] }>;
  html: string;
};

const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-SG", { day: "2-digit", month: "short" });
const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const C = {
  ink: "#1c1c1e",
  sub: "#6b6f76",
  line: "#e3e5e8",
  work: { bg: "#fff3c4", border: "#e8c96a", text: "#5c4a00" },
  note: { bg: "#e2f4d9", border: "#a4d38f", text: "#2c5e1a" },
  ph: { bg: "#fde2e2", border: "#e9a0a0", text: "#8a1f1f" },
};

export default function PublicSchedulePage() {
  const { token } = useParams<{ token: string }>();
  const base = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width:900px)");
  const today = isoToday();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${base}/public/schedule/${token}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || "This link is not valid");
        setData(json?.data ?? json);
      } catch (e: any) {
        setError(e.message || "This link is not valid");
      }
    })();
  }, [base, token]);

  const doPrint = () => {
    if (!data?.html) return;
    const f = document.createElement("iframe");
    f.style.position = "fixed";
    f.style.right = "0";
    f.style.bottom = "0";
    f.style.width = "0";
    f.style.height = "0";
    f.style.border = "0";
    document.body.appendChild(f);
    f.srcdoc = data.html;
    f.onload = () => {
      f.contentWindow?.print();
      setTimeout(() => document.body.removeChild(f), 60000);
    };
  };

  // Weeks with anything on them (skip fully-empty trailing weeks visually).
  const weeks = useMemo(() => (data?.weeks || []).filter((w) => w.days.some((d) => d.work.length || d.notes.length || d.holiday)), [data]);

  if (error)
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", p: 2 }}>
        <Alert severity="warning">{error} — please ask your designer for an updated link.</Alert>
      </Box>
    );
  if (!data)
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", display: "flex", justifyContent: "center", pt: 12 }}>
        <CircularProgress />
      </Box>
    );

  const h = data.header;

  const DayChips = ({ d }: { d: Day }) => (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      {d.holiday && (
        <Chip size="small" label={`${d.holiday} · Public holiday`} sx={{ bgcolor: C.ph.bg, color: C.ph.text, border: `1px solid ${C.ph.border}`, height: "auto", "& .MuiChip-label": { whiteSpace: "normal", py: 0.4, px: 0.9, fontSize: 11.5, lineHeight: 1.3, fontWeight: 700 } }} />
      )}
      {d.dow === "Sun" && (
        <Typography sx={{ color: "#9aa0a6", fontWeight: 700, fontSize: 10, letterSpacing: 0.5 }}>WORKERS' OFF DAY</Typography>
      )}
      {d.work.map((l, i) => (
        <Chip key={`w${i}`} size="small" label={l} sx={{ bgcolor: C.work.bg, color: C.work.text, border: `1px solid ${C.work.border}`, height: "auto", justifyContent: "flex-start", "& .MuiChip-label": { whiteSpace: "normal", py: 0.4, px: 0.9, fontSize: 12, lineHeight: 1.35, fontWeight: 600 } }} />
      ))}
      {d.notes.map((n, i) => (
        <Chip key={`n${i}`} size="small" label={n} sx={{ bgcolor: C.note.bg, color: C.note.text, border: `1px solid ${C.note.border}`, height: "auto", justifyContent: "flex-start", "& .MuiChip-label": { whiteSpace: "normal", py: 0.4, px: 0.9, fontSize: 11.5, lineHeight: 1.35, fontStyle: "italic" } }} />
      ))}
    </Stack>
  );

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", color: C.ink, pb: 6 }}>
      {/* header */}
      <Box sx={{ bgcolor: "#ffffff", borderBottom: `2px solid ${C.ink}` }}>
        <Container maxWidth="lg" sx={{ py: 2 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {h.logo ? <img src={h.logo} alt={h.orgName} style={{ maxHeight: 36, maxWidth: 160, objectFit: "contain", marginBottom: 6 }} /> : <Typography sx={{ fontWeight: 800 }}>{h.orgName}</Typography>}
              <Typography sx={{ fontWeight: 800, fontSize: { xs: 16, sm: 18 }, lineHeight: 1.25 }}>PROJECT SITE: {h.projectSite}</Typography>
              <Typography sx={{ color: C.sub, fontSize: 13 }}>
                {h.contractNo ? `(${h.contractNo}) · ` : ""}Project Manager: {h.manager || "—"}
                {h.contact ? ` · ${h.contact}` : ""}
              </Typography>
            </Box>
            <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={doPrint} sx={{ textTransform: "none", alignSelf: { xs: "flex-start", sm: "center" }, color: C.ink, borderColor: C.line }}>
              Print / PDF
            </Button>
          </Stack>
          <Typography sx={{ color: C.sub, fontStyle: "italic", fontSize: 11.5, mt: 0.75 }}>
            Proposed schedule may be subjected to changes due to unforeseen circumstances on site — this page always shows the latest version.
          </Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ pt: 2.5 }}>
        {weeks.length === 0 && <Alert severity="info">No activities scheduled yet — check back soon.</Alert>}
        <Stack spacing={2}>
          {weeks.map((w) => (
            <Paper key={w.index} elevation={0} sx={{ border: `1px solid ${C.line}`, borderRadius: 2.5, overflow: "hidden", bgcolor: "#ffffff" }}>
              <Box sx={{ px: 2, py: 1, bgcolor: "#f0f1f3", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <Typography sx={{ fontWeight: 800, fontSize: 13.5 }}>Week {w.index}</Typography>
                <Typography sx={{ color: C.sub, fontSize: 12 }}>
                  {fmt(w.days[0].iso)} – {fmt(w.days[6].iso)}
                </Typography>
              </Box>

              {wide ? (
                /* desktop: 7-column grid */
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))" }}>
                  {w.days.map((d) => {
                    const isToday = d.iso === today;
                    return (
                      <Box key={d.iso} sx={{ borderLeft: `1px solid ${C.line}`, "&:first-of-type": { borderLeft: 0 }, minHeight: 110, bgcolor: d.dow === "Sun" ? "#fafafa" : "#fff" }}>
                        <Box sx={{ px: 1, py: 0.5, borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", bgcolor: isToday ? C.ink : "transparent", color: isToday ? "#fff" : C.ink }}>
                          <Typography sx={{ fontWeight: 700, fontSize: 11.5 }}>{d.dow}</Typography>
                          <Typography sx={{ fontSize: 11.5, color: isToday ? "#fff" : C.sub }}>{fmt(d.iso)}</Typography>
                        </Box>
                        <Box sx={{ p: 0.75 }}>
                          <DayChips d={d} />
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                /* mobile: agenda rows, one per day with content (Sundays kept for the off-day note) */
                <Stack divider={<Box sx={{ borderBottom: `1px solid ${C.line}` }} />}>
                  {w.days
                    .filter((d) => d.work.length || d.notes.length || d.holiday || d.dow === "Sun")
                    .map((d) => {
                      const isToday = d.iso === today;
                      return (
                        <Stack key={d.iso} direction="row" spacing={1.25} sx={{ px: 1.5, py: 1, bgcolor: isToday ? "#f5f8ff" : "transparent" }}>
                          <Box sx={{ width: 58, flexShrink: 0, textAlign: "center", pt: 0.25 }}>
                            <Typography sx={{ fontWeight: 800, fontSize: 12, color: isToday ? "#1a56db" : C.ink }}>{d.dow}</Typography>
                            <Typography sx={{ fontSize: 11, color: C.sub }}>{fmt(d.iso)}</Typography>
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <DayChips d={d} />
                            {!d.work.length && !d.notes.length && !d.holiday && d.dow !== "Sun" && <Typography sx={{ color: "#c0c4c9", fontSize: 12 }}>—</Typography>}
                          </Box>
                        </Stack>
                      );
                    })}
                </Stack>
              )}
            </Paper>
          ))}
        </Stack>
        <Typography sx={{ textAlign: "center", color: "#b0b4ba", fontSize: 11, mt: 3 }}>
          {h.orgName} · live project schedule
        </Typography>
      </Container>
    </Box>
  );
}
