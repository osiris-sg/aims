"use client";

import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { listBondedDevices, type SavedPrinter } from "../lib/btPrinter";
import {
  DOT_WIDTH_PRESETS,
  getDotWidth,
  normaliseDotWidth,
  saveDotWidth,
} from "../lib/a4Print";

/**
 * Printer picker for the A4 raster flow.
 *
 * Lists EVERY paired Bluetooth device, deliberately unfiltered: the 小象 unit's
 * advertised name is unknown, SPP printers rarely advertise a printer class,
 * and a name filter would hide the one device the rider needs. Pairing itself
 * happens in Android Settings — normal for SPP, and the plugin only ever reads
 * the bonded list.
 *
 * The dot-width field is here, and not in code, because it is the one value
 * that can only be found by trying: too small prints a narrow page with a blank
 * margin, too large clips the right edge or smears. Putting it beside the
 * device list means a rider on site can correct a wrong guess without waiting
 * for a release.
 */
export default function PrinterPickerDialog({
  open,
  onClose,
  onPick,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (printer: SavedPrinter) => void;
  busy?: boolean;
}) {
  const [devices, setDevices] = useState<SavedPrinter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dotWidth, setDotWidth] = useState<string>(String(getDotWidth()));

  useEffect(() => {
    if (!open) return;
    setDevices(null);
    setError(null);
    setDotWidth(String(getDotWidth()));
    (async () => {
      try {
        setDevices(await listBondedDevices());
      } catch (e: any) {
        setError(e?.message ?? "Could not list Bluetooth devices");
      }
    })();
  }, [open]);

  // Persist on every edit rather than on pick: the rider often changes the
  // width to re-test a failed print and taps the SAME device, and a value that
  // only saved on some other path would silently not apply.
  const commitDotWidth = (raw: string) => {
    setDotWidth(raw);
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 384) saveDotWidth(n);
  };

  const normalised = normaliseDotWidth(Number(dotWidth));
  const isPreset = DOT_WIDTH_PRESETS.some((p) => p.value === normalised);

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="xs">
      <DialogTitle>Choose printer</DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Showing every device already paired in Android Settings. Pair the
          printer there first if it isn&apos;t listed.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}

        {!devices ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={26} />
          </Box>
        ) : devices.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No paired Bluetooth devices found.
          </Typography>
        ) : (
          <List dense>
            {devices.map((d) => (
              <ListItemButton key={d.mac} disabled={busy} onClick={() => onPick(d)}>
                <ListItemText primary={d.name} secondary={d.mac} />
              </ListItemButton>
            ))}
          </List>
        )}

        <Divider sx={{ my: 1.5 }} />

        <TextField
          select={isPreset}
          label="Print width (dots)"
          value={isPreset ? String(normalised) : dotWidth}
          onChange={(e) => commitDotWidth(e.target.value)}
          size="small"
          fullWidth
          helperText={
            isPreset
              ? "If the page prints narrow or clipped, this is the wrong width."
              : `Custom — rounded to ${normalised} (must be a multiple of 8).`
          }
        >
          {DOT_WIDTH_PRESETS.map((p) => (
            <MenuItem key={p.value} value={String(p.value)}>
              {p.label}
            </MenuItem>
          ))}
        </TextField>
        {isPreset && (
          <Button size="small" sx={{ mt: 0.5 }} onClick={() => commitDotWidth(String(normalised + 8))}>
            Enter a custom width
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
