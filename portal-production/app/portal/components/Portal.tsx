"use client";

import React from "react";
import { SnackbarProvider } from "notistack";
import { usePortalRedirect } from "../hooks/usePortalRedirect";

interface Props {
  children: React.ReactNode;
}

export default function Portal({ children }: Props) {
  usePortalRedirect();

  return (
    <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} autoHideDuration={10000}>
      {children}
    </SnackbarProvider>
  );
}
