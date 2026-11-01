/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY part 3 — Clients › a customer / supplier › Details: the company, payment & bank (account masked), contacts
// (on record, with role and language; plus who e-mails us), shipping lines & logistics, notes — with "Edit details"
// (the same drawer as "+ Add"). ?edit=1 opens the drawer (the list's row menu → Edit details).

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Box, Button, Chip, Grid2, Paper, Stack, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import { useTranslations } from "next-intl";
import type { CompanyInfo, ContactInfo, LogisticsInfo } from "../../_lib/api";
import { useShippingLines } from "../../_lib/hooks";
import { KV } from "./ClientsBits";
import CompanyDrawer, { type CompanyDrawerInitial } from "./CompanyDrawer";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

type Rec = { id: string; name: string; jpName?: string | null; address?: string | null; jpAddress?: string | null; email?: string | null; phone?: string | null; gstRegNo?: string | null; currency: string };

export default function CompanyDetails({ kind, rec, company, logistics, contacts, lang = "en", children }: { kind: "customer" | "supplier"; rec: Rec; company?: CompanyInfo; logistics?: LogisticsInfo; contacts: ContactInfo[]; lang?: "en" | "ja"; children?: React.ReactNode }) {
  const t = useTranslations("clients.details");
  const params = useSearchParams();
  const lines = useShippingLines();
  const { hasPermission, userRoles } = useUserPermissions();
  const canEdit = hasPermission(kind === "customer" ? "customers" : "suppliers", "update") || userRoles.length === 0;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (params?.get("edit") === "1" && canEdit) setOpen(true);
  }, [params, canEdit]);
  const c = company ?? {};
  const lg = logistics ?? {};
  const lineName = (code: string) => (lines.data?.partners ?? lines.data?.lines ?? []).find((l) => l.code === code)?.name ?? code;
  const initial: CompanyDrawerInitial = useMemo(
    () => ({ id: rec.id, name: rec.name, jpName: rec.jpName ?? null, address: rec.address ?? null, jpAddress: rec.jpAddress ?? null, email: rec.email ?? null, phone: rec.phone ?? null, gstRegNo: rec.gstRegNo ?? null, currency: rec.currency, company: c, logistics: lg, contacts }),
    [rec, c, lg, contacts],
  );
  const bank = [c.bank?.bankName, c.bank?.branch].filter(Boolean).join(" · ");
  return (
    <Box data-tour="client-company-details">
      <Stack direction="row" sx={{ mb: 1 }}>
        <Box sx={{ flex: 1 }} />
        {canEdit && <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => setOpen(true)} data-tour="client-edit-details">{t("edit")}</Button>}
      </Stack>
      <Grid2 container spacing={2}>
        <Grid2 size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t("company")}</Typography>
            <KV k={t("nameEn")} v={rec.name} />
            <KV k={t("nameJa")} v={(kind === "customer" ? rec.jpName : c.legalNameJa) || "—"} />
            <KV k={t("address")} v={rec.address || "—"} />
            {kind === "customer" && <KV k={t("addressJa")} v={rec.jpAddress || "—"} />}
            <KV k={t("country")} v={c.country || "—"} />
            <KV k={t("phone")} v={rec.phone || "—"} />
            <KV k={t("email")} v={rec.email || "—"} />
            <KV k={t("website")} v={c.website ? <a href={/^https?:/.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website}</a> : "—"} />
            <KV k={t("tax")} v={rec.gstRegNo || "—"} />
            <KV k={t("currency")} v={rec.currency} />
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t("pay")}</Typography>
            <KV k={t("terms")} v={c.paymentTerms || "—"} />
            <KV k={t("bank")} v={bank || "—"} />
            <KV k={t("acct")} v={[c.bank?.accountName, c.bank?.accountNo].filter(Boolean).join(" · ") || "—"} />
            <KV k={t("swift")} v={c.bank?.swift || "—"} />
          </Paper>
        </Grid2>
        <Grid2 size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-tour="client-contacts">
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t("contacts")}</Typography>
            {contacts.length ? (
              contacts.map((k, i) => (
                <Box key={k.id ?? i} sx={{ mb: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {k.name}
                    {k.role ? <Typography component="span" variant="body2" color="text.secondary"> · {k.role}</Typography> : null}
                    {k.isPrimary ? <Chip size="small" label={t("main")} sx={{ ml: 0.75, height: 18 }} /> : null}
                    {k.lang ? <Chip size="small" variant="outlined" label={k.lang.toUpperCase()} sx={{ ml: 0.5, height: 18 }} /> : null}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{[k.email, k.phone].filter(Boolean).join(" · ") || "—"}</Typography>
                </Box>
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">{t("none")}</Typography>
            )}
            {children}
          </Paper>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-tour="client-logistics">
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t("logistics")}</Typography>
            <KV k={t("lines")} v={lg.carriers?.length ? <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{lg.carriers.map((x) => <Chip key={x} size="small" label={lineName(x)} />)}</Stack> : "—"} />
            <KV k={t("bl")} v={lg.blPattern ? <code>{lg.blPattern}</code> : "—"} />
            <KV k={t("booking")} v={lg.bookingPattern ? <code>{lg.bookingPattern}</code> : "—"} />
            <KV k={t("pol")} v={lg.portOfLoading || "—"} />
            <KV k={t("pod")} v={lg.portOfDischarge || "—"} />
            <KV k={t("inc")} v={lg.incoterm || "—"} />
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t("notes")}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{c.notes || "—"}</Typography>
          </Paper>
        </Grid2>
      </Grid2>
      <CompanyDrawer kind={kind} open={open} initial={initial} onClose={() => setOpen(false)} lang={lang} />
    </Box>
  );
}
