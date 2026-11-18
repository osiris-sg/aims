"use client";

// Round BW — ADH books: small shared pieces (the (i) next to a heading, the money-only gate).

import React from "react";
import { Alert, Box, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useTranslations } from "next-intl";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

export function InfoTip({ text }: { text: React.ReactNode }) {
  return (
    <Tooltip title={text} placement="bottom-start">
      <InfoOutlinedIcon fontSize="small" color="action" sx={{ verticalAlign: "middle", cursor: "help", ml: 0.75 }} />
    </Tooltip>
  );
}

/** Books are for shipments:money holders (ADH Admin / Manager); ADH Sales sees a short notice. */
export function BooksGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations("books");
  const { hasPermission, isLoading } = useUserPermissions();
  if (isLoading) return null;
  if (!hasPermission("shipments", "money"))
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">{t("noAccess")}</Alert>
      </Box>
    );
  return <>{children}</>;
}

export const fmtMoney = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
