"use client";

// "Discard changes?" (WCT group, 2026-11-25): asked by the Job and Note pop-ups before unsaved typing is thrown away.
import React from "react";
import { Button, Dialog, DialogActions, DialogTitle } from "@mui/material";
import { DISCARD_TEXT } from "@/helpers/calendarDiscard";

export default function DiscardChangesDialog({ open, onKeep, onDiscard }: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={open} onClose={onKeep} maxWidth="xs" fullWidth data-tour="discard-changes">
      <DialogTitle>{DISCARD_TEXT.title}</DialogTitle>
      <DialogActions>
        <Button onClick={onKeep} autoFocus>
          {DISCARD_TEXT.keep}
        </Button>
        <Button color="error" variant="contained" disableElevation onClick={onDiscard}>
          {DISCARD_TEXT.discard}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
