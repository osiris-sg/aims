"use client";

// Jobs calendar "Settings" (WCT group, 2026-11-25): the Calendar colours settings in a dialog, the same editor as Org
// Settings > Calendar colours (which stays in the menu). Only for Org Settings edit (the button is hidden otherwise
// and the server checks it). Saving reloads the calendar so the new colours show.

import React from "react";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, useMediaQuery } from "@mui/material";
import { CalendarColoursTables, useCalendarColours } from "@/app/portal/settings/calendar-colours/_components/CalendarColoursEditor";

export default function CalendarColoursDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const phone = useMediaQuery((t: any) => t.breakpoints.down("sm"));
  const state = useCalendarColours(open);
  const { page, error, setError, denied, saving, changes, save } = state;
  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm" fullScreen={phone} data-tour="jobs-calendar-settings-dialog">
      <DialogTitle>Calendar colours</DialogTitle>
      <DialogContent dividers>
        {denied ? (
          <Alert severity="info">Only people with Org Settings edit can change the calendar colours.</Alert>
        ) : (
          <>
            {error && (
              <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}
            {!page ? <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>{!error && <CircularProgress size={24} />}</Box> : <CalendarColoursTables state={state} />}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Close
        </Button>
        {!denied && (
          <Button
            variant="contained"
            disableElevation
            disabled={!changes || saving}
            onClick={async () => {
              if (await save()) onSaved();
            }}
            data-tour="calendar-colours-save"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
