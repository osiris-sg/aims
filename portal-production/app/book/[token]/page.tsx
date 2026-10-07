"use client";

// PUBLIC (no login): book an appointment with a designer. The client sees ONLY
// which slots are free — taken slots are greyed out with no detail (guru
// 2026-10-08). Light, paper-styled on purpose: this is the client's page, not
// the portal UI.

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Box, Button, CircularProgress, Container, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography } from "@mui/material";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

type Slot = { startAt: string; free: boolean };
type Payload = { designerName: string; orgName: string; orgLogo: string | null; slotMinutes: number; days: Array<{ date: string; slots: Slot[] }> };

const fmtDay = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-SG", { weekday: "short", day: "2-digit", month: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });

export default function PublicBookingPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/public/booking/${token}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message || "This booking link is not valid");
      setData(j?.data ?? j);
    } catch (e: any) {
      setError(e.message || "This booking link is not valid");
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);

  const book = async () => {
    if (!pick || !form.name.trim() || !form.phone.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/public/booking/${token}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), phone: form.phone.trim(), note: form.note.trim() || null, startAt: pick.startAt }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.message?.message || j?.message || "Could not book that slot");
      setDone(pick.startAt);
      setPick(null);
    } catch (e: any) {
      alert(e.message);
      setPick(null);
      load(); // slot may have just been taken — refresh the grid
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", p: 3 }}>
        <Container maxWidth="sm">
          <Alert severity="warning">{error}</Alert>
        </Container>
      </Box>
    );
  if (!data)
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  if (done)
    return (
      <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", p: 3 }}>
        <Container maxWidth="sm">
          <Paper sx={{ p: 4, borderRadius: 3, textAlign: "center" }}>
            <EventAvailableIcon sx={{ fontSize: 48, color: "#2e7d32", mb: 1 }} />
            <Typography variant="h5" sx={{ fontWeight: 800, color: "#1c1c1e" }}>
              Appointment booked
            </Typography>
            <Typography sx={{ mt: 1, color: "#444" }}>
              {fmtDay(done.slice(0, 10))} · {fmtTime(done)} with {data.designerName}
            </Typography>
            <Typography variant="body2" sx={{ mt: 2, color: "#6b6f76" }}>
              {data.designerName} has been notified and will confirm with you on WhatsApp.
            </Typography>
          </Paper>
        </Container>
      </Box>
    );

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", py: 3 }}>
      <Container maxWidth="md">
        <Paper sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {data.orgLogo && <img src={data.orgLogo} alt="" style={{ maxHeight: 34, maxWidth: 120, objectFit: "contain" }} />}
            <Typography variant="h5" sx={{ fontWeight: 800, color: "#1c1c1e" }}>
              Book an appointment
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: "#6b6f76", mb: 2 }}>
            with {data.designerName} · {data.orgName} · {data.slotMinutes} min — pick any available time
          </Typography>
          <Stack spacing={1.5}>
            {data.days.map((d) => {
              const anyFree = d.slots.some((s) => s.free);
              return (
                <Box key={d.date}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: anyFree ? "#1c1c1e" : "#9aa0a6", mb: 0.5 }}>
                    {fmtDay(d.date)}
                    {!anyFree && <Typography component="span" variant="caption" sx={{ ml: 1, color: "#9aa0a6" }}>fully booked</Typography>}
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {d.slots.map((s) => (
                      <Button
                        key={s.startAt}
                        size="small"
                        variant={s.free ? "outlined" : "text"}
                        disabled={!s.free}
                        onClick={() => setPick(s)}
                        sx={{
                          textTransform: "none",
                          minWidth: 72,
                          fontVariantNumeric: "tabular-nums",
                          color: s.free ? "#1c1c1e" : "#c3c6cb",
                          borderColor: "#d6d9dd",
                          textDecoration: s.free ? "none" : "line-through",
                        }}
                      >
                        {fmtTime(s.startAt)}
                      </Button>
                    ))}
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Paper>
        <Typography variant="caption" sx={{ display: "block", textAlign: "center", color: "#9aa0a6", mt: 2 }}>
          Times shown in Singapore time · slots refresh live
        </Typography>
      </Container>

      <Dialog open={!!pick} onClose={() => setPick(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {pick ? `${fmtDay(pick.startAt.slice(0, 10))} · ${fmtTime(pick.startAt)}` : ""} with {data.designerName}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Your name" size="small" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus fullWidth />
            <TextField label="Mobile number" size="small" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputProps={{ inputMode: "tel" }} fullWidth />
            <TextField label="Anything to prepare? (optional)" size="small" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} multiline minRows={2} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPick(null)} sx={{ textTransform: "none" }}>Back</Button>
          <Button variant="contained" disabled={busy || !form.name.trim() || !form.phone.trim()} onClick={book} sx={{ textTransform: "none" }}>
            {busy ? "Booking…" : "Confirm booking"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
