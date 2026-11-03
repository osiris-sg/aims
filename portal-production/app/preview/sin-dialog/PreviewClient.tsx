"use client";

// The shipping SIN dialog with the org's feature flags seeded into the same React Query cache entry the portal
// fills from /configuration/ui (signed out here, so the key's org id is undefined).
import React, { useMemo, useState } from "react";
import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { ToastContainer } from "react-toastify";
import lightTheme from "@/themes/lightTheme";
import darkTheme from "@/themes/darkTheme";
import BillEditorDialog from "@/app/portal/accounting/bills/_components/BillEditorDialog";

export default function PreviewClient({ wct, mode }: { wct: boolean; mode: "light" | "dark" }) {
  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);
  const qc = useQueryClient();
  useState(() => qc.setQueryData(["organizationUIConfig", undefined], { features: { enableWctOrders: wct } }));
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ToastContainer />
      <BillEditorDialog open editing={null} kind="SIN" onClose={() => undefined} onSaved={() => undefined} />
    </ThemeProvider>
  );
}
