"use client";

import React from "react";
import { Alert, Button } from "@mui/material";

/** A load that failed: its message and a Retry (instead of a blank screen, a spinner forever or a crash). */
export default function LoadErrorAlert({ message, onRetry, sx }: { message: string; onRetry: () => void; sx?: object }) {
  return (
    <Alert
      severity="error"
      sx={sx}
      action={
        <Button color="inherit" size="small" onClick={onRetry} sx={{ textTransform: "none" }}>
          Retry
        </Button>
      }
    >
      {message}
    </Alert>
  );
}
