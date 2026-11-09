"use client";

// Settings → Hotkeys (guru 2026-11-09): the common actions and the key that
// fires each one, legacy-software style (F2 = look up, F9 = save…). Click a
// key box and press the new combination; Backspace switches the action off;
// the arrow resets it to the default. Saved per organisation — everyone in
// the org gets the same keys. Enter-to-next-field is always on and listed
// under "Always on" so the whole keyboard story is in one place.

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import KeyboardIcon from "@mui/icons-material/KeyboardOutlined";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { useConfiguration } from "../../context/ConfigurationContext";
import {
  HOTKEY_ACTIONS,
  FIXED_KEYS,
  comboFromEvent,
  comboProblem,
  resolveHotkeyMap,
  type HotkeyMap,
} from "@/helpers/hotkeys";

const keycapSx = {
  display: "inline-block",
  px: 1,
  py: 0.25,
  minWidth: 36,
  textAlign: "center" as const,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 1,
  border: 1,
  borderColor: "divider",
  bgcolor: "surfaceTones.low",
  lineHeight: 1.6,
};

function Keycap({ combo }: { combo: string | null }) {
  if (!combo) return <Chip size="small" variant="outlined" label="Off" sx={{ height: 22 }} />;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" component="span">
      {combo.split("+").map((k, i) => (
        <React.Fragment key={k}>
          {i > 0 && <Box component="span" sx={{ color: "text.secondary", fontSize: 12 }}>+</Box>}
          <Box component="span" sx={keycapSx}>{k}</Box>
        </React.Fragment>
      ))}
    </Stack>
  );
}

export default function HotkeysSettingsPage() {
  const { getToken } = useAuth();
  const { uiConfig, loading, refreshConfiguration } = useConfiguration();
  const saved = useMemo(() => resolveHotkeyMap((uiConfig as any)?.hotkeys ?? null), [uiConfig]);
  const [map, setMap] = useState<HotkeyMap>(saved);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setMap(saved), [saved]);

  const dirty = HOTKEY_ACTIONS.some((a) => (map[a.id] ?? null) !== (saved[a.id] ?? null));

  // Same key on two actions — flagged on both rows and blocks Save.
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const a of HOTKEY_ACTIONS) {
      const k = map[a.id];
      if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [map]);

  const onCaptureKey = (actionId: string) => (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setCapturing(null);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      setMap((m) => ({ ...m, [actionId]: null }));
      setCapturing(null);
      return;
    }
    const combo = comboFromEvent(e.nativeEvent as KeyboardEvent);
    if (!combo) return; // a bare modifier — keep waiting for the key
    const problem = comboProblem(combo);
    if (problem) {
      toast.warn(problem);
      return;
    }
    setMap((m) => ({ ...m, [actionId]: combo }));
    setCapturing(null);
  };

  const save = async () => {
    if (duplicates.size) return toast.error("Two actions share the same key. Change one of them first");
    setSaving(true);
    try {
      const token = await getToken();
      // Send only the actions that differ from their defaults; the rest stay on defaults.
      const body: HotkeyMap = {};
      for (const a of HOTKEY_ACTIONS) if ((map[a.id] ?? null) !== a.defaultKey) body[a.id] = map[a.id] ?? null;
      await request({ path: "/configuration/hotkeys", method: "PATCH" }, { hotkeys: body }, token ?? undefined);
      await refreshConfiguration();
      toast.success("Hotkeys saved for everyone in the organisation");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !uiConfig)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <Box sx={{ p: { xs: 2, md: 8 }, maxWidth: 980 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <KeyboardIcon color="primary" />
        <Typography variant="h4" sx={{ fontWeight: "bold", color: "primary.main" }}>
          Hotkeys
        </Typography>
      </Stack>
      <Typography variant="subtitle1" sx={{ color: "text.secondary", mb: 3 }}>
        Keyboard shortcuts for the common actions, the legacy way. Click a key box and press the new combination.
        Backspace switches an action off. The keys apply to everyone in the organisation.
      </Typography>

      <Table size="small" sx={{ mb: 3, "& td, & th": { borderColor: "divider" } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, width: 170 }}>Action</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>What it does</TableCell>
            <TableCell sx={{ fontWeight: 700, width: 220 }}>Key</TableCell>
            <TableCell sx={{ width: 48 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {HOTKEY_ACTIONS.map((a) => {
            const combo = map[a.id] ?? null;
            const isCapturing = capturing === a.id;
            const dup = combo ? duplicates.has(combo) : false;
            const changed = combo !== a.defaultKey;
            return (
              <TableRow key={a.id} hover>
                <TableCell sx={{ fontWeight: 600 }}>{a.label}</TableCell>
                <TableCell sx={{ color: "text.secondary" }}>{a.description}</TableCell>
                <TableCell>
                  <Box
                    role="button"
                    tabIndex={0}
                    data-enter-ignore=""
                    onClick={() => setCapturing(a.id)}
                    onFocus={() => setCapturing(a.id)}
                    onBlur={() => setCapturing((c) => (c === a.id ? null : c))}
                    onKeyDown={isCapturing ? onCaptureKey(a.id) : undefined}
                    title="Click, then press the new key"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      minHeight: 36,
                      px: 1,
                      borderRadius: 1,
                      border: 1,
                      cursor: "pointer",
                      borderColor: dup ? "error.main" : isCapturing ? "primary.main" : "divider",
                      outline: "none",
                      "&:focus-visible": { borderColor: "primary.main" },
                    }}
                  >
                    {isCapturing ? (
                      <Typography variant="body2" sx={{ color: "primary.main", fontStyle: "italic" }}>
                        Press the new key…
                      </Typography>
                    ) : (
                      <Keycap combo={combo} />
                    )}
                  </Box>
                  {dup && (
                    <Typography variant="caption" sx={{ color: "error.main" }}>
                      Also used by another action
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  {changed && (
                    <Tooltip title={`Reset to ${a.defaultKey ?? "off"}`}>
                      <IconButton size="small" onClick={() => setMap((m) => ({ ...m, [a.id]: a.defaultKey }))}>
                        <RestartAltIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Stack direction="row" spacing={1} sx={{ mb: 4 }}>
        <Button variant="contained" onClick={save} disabled={!dirty || saving || duplicates.size > 0} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
          Save
        </Button>
        <Button variant="text" onClick={() => setMap(saved)} disabled={!dirty || saving}>
          Discard changes
        </Button>
      </Stack>

      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Always on
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
        These work on every form and cannot be changed.
      </Typography>
      <Table size="small" sx={{ maxWidth: 640, mb: 3, "& td": { borderColor: "divider" } }}>
        <TableBody>
          {FIXED_KEYS.map((f) => (
            <TableRow key={f.key}>
              <TableCell sx={{ width: 170 }}>
                <Keycap combo={f.key} />
              </TableCell>
              <TableCell sx={{ color: "text.secondary" }}>{f.what}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Alert severity="info" variant="outlined">
        A hotkey presses the matching button on the screen you are on. If that screen has no such button (say, Confirm on a
        customer form) the key does nothing. Browser keys F5, F11 and F12 cannot be used.
      </Alert>
    </Box>
  );
}
