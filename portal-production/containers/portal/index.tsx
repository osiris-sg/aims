"use client";
import React from "react";
import usePoratalRedirectHandler from "./hooks/usePoratalRedirectHandler";
import { SnackbarProvider } from "notistack";
import { NotificationProvider } from "@/contexts/NotificationContext";

interface Props {
  children: React.ReactNode;
}

export default function Portal({ children }: Props) {
  usePoratalRedirectHandler();
  return (
    <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} autoHideDuration={10000}>
      <NotificationProvider>
        {children}
      </NotificationProvider>
    </SnackbarProvider>
  );
}
