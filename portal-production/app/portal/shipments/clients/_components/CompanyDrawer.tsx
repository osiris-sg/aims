/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY part 3 — "+ Add customer / supplier" and Details → Edit: one drawer with the company (names EN / JA,
// address, country, phone, e-mail, website, tax / registration no., currency), payment terms and bank (the account
// number is shown masked; typing a new one replaces it), contacts (name, role, e-mail, phone, language, main contact —
// added or edited, never deleted here), shipping lines and logistics, and notes. Saved through the Clients API.

import React, { useEffect, useState } from "react";
import { Box, Button, Chip, Divider, Drawer, FormControlLabel, Grid2, IconButton, MenuItem, Radio, Stack, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type CompanyForm, type ContactInfo } from "../../_lib/api";
import { CLIENT_KEYS, SHIPMENT_KEYS, useShippingLines } from "../../_lib/hooks";
import { toast } from "../../_lib/toast";

export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const CURRENCIES = ["USD", "JPY", "SGD", "INR", "THB", "IDR", "EUR"];

export type CompanyDrawerInitial = CompanyForm & { id?: string };

export default function CompanyDrawer({ kind, open, initial, onClose, onSaved }: { kind: "customer" | "supplier"; open: boolean; initial: CompanyDrawerInitial | null; onClose: () => void; onSaved?: (id: string) => void; lang?: "en" | "ja" }) {
  const t = useTranslations("clients.drawer");
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const lines = useShippingLines();
  const [f, setF] = useState<CompanyDrawerInitial>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF(initial ?? { currency: "USD", company: {}, logistics: {}, contacts: [] });
      setErr(null);
    }
  }, [open, initial]);
  const set = (k: keyof CompanyForm, v: any) => setF((x) => ({ ...x, [k]: v }));
  const setC = (k: string, v: any) => setF((x) => ({ ...x, company: { ...(x.company ?? {}), [k]: v } }));
  const setB = (k: string, v: any) => setF((x) => ({ ...x, company: { ...(x.company ?? {}), bank: { ...(x.company?.bank ?? {}), [k]: v } } }));
  const setLg = (k: string, v: any) => setF((x) => ({ ...x, logistics: { ...(x.logistics ?? {}), [k]: v } }));
  const contacts = f.contacts ?? [];
  const setContact = (i: number, k: keyof ContactInfo, v: any) => set("contacts", contacts.map((c, j) => (j === i ? { ...c, [k]: v } : k === "isPrimary" && v ? { ...c, isPrimary: false } : c)));
  const editing = !!initial?.id;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: CompanyForm = { ...f, contacts: contacts.filter((c) => c.name?.trim()) };
      delete (body as any).id;
      const r: any = editing
        ? kind === "customer" ? await api.clientUpdateCustomer(initial!.id!, body) : await api.clientUpdateSupplier(initial!.id!, body)
        : kind === "customer" ? await api.clientCreateCustomer(body) : await api.clientCreateSupplier(body);
      await Promise.all([qc.invalidateQueries({ queryKey: CLIENT_KEYS.all }), qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders })]);
      toast.success(t("saved"));
      onSaved?.(r?.customer?.id ?? r?.supplier?.id);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tf = (label: string, value: any, onChange: (v: string) => void, extra: any = {}) => <TextField size="small" fullWidth label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...extra} />;
  return (
    <Drawer anchor="right" open={open} onClose={() => !busy && onClose()} slotProps={{ paper: { sx: { width: { xs: "100vw", sm: 600 }, p: 2 } } }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>{editing ? `${t("edit")} · ${initial?.name ?? ""}` : kind === "customer" ? t("addC") : t("addS")}</Typography>
        <IconButton onClick={onClose} aria-label={t("close")} disabled={busy}><CloseIcon /></IconButton>
      </Stack>
      <Box sx={{ overflowY: "auto", flex: 1, pr: 0.5 }} data-tour="company-drawer">
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t("company")}</Typography>
        <Grid2 container spacing={1.25}>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("nameEn"), f.name, (v) => set("name", v), { required: true })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{kind === "customer" ? tf(t("nameJa"), f.jpName, (v) => set("jpName", v)) : tf(t("nameJa"), f.company?.legalNameJa, (v) => setC("legalNameJa", v))}</Grid2>
          <Grid2 size={12}>{tf(t("address"), f.address, (v) => set("address", v), { multiline: true, minRows: 2 })}</Grid2>
          {kind === "customer" && <Grid2 size={12}>{tf(t("addressJa"), f.jpAddress, (v) => set("jpAddress", v), { multiline: true, minRows: 2 })}</Grid2>}
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf(t("country"), f.company?.country, (v) => setC("country", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf(t("phone"), f.phone, (v) => set("phone", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf(t("email"), f.email, (v) => set("email", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("website"), f.company?.website, (v) => setC("website", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf(t("tax"), f.gstRegNo, (v) => set("gstRegNo", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 2 }}>
            <TextField select size="small" fullWidth label={t("currency")} value={f.currency ?? "USD"} onChange={(e) => set("currency", e.target.value)}>
              {[...new Set([...(f.currency ? [f.currency] : []), ...CURRENCIES])].map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Grid2>
        </Grid2>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t("pay")}</Typography>
        <Grid2 container spacing={1.25}>
          <Grid2 size={12}>{tf(t("terms"), f.company?.paymentTerms, (v) => setC("paymentTerms", v), { placeholder: t("termsPlaceholder") })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("bank"), f.company?.bank?.bankName, (v) => setB("bankName", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("branch"), f.company?.bank?.branch, (v) => setB("branch", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("acctName"), f.company?.bank?.accountName, (v) => setB("accountName", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf(t("acctNo"), f.company?.bank?.accountNo, (v) => setB("accountNo", v), { helperText: t("acctHint"), onFocus: (e: any) => e.target.value.startsWith("••••") && setB("accountNo", "") })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 2 }}>{tf(t("swift"), f.company?.bank?.swift, (v) => setB("swift", v))}</Grid2>
        </Grid2>

        <Divider sx={{ my: 2 }} />
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>{t("contacts")}</Typography>
          <Button size="small" startIcon={<AddIcon />} onClick={() => set("contacts", [...contacts, { name: "", isPrimary: !contacts.length }])}>{t("addContact")}</Button>
        </Stack>
        {contacts.map((c, i) => (
          <Grid2 container spacing={1} key={c.id ?? `new-${i}`} sx={{ mb: 1 }} alignItems="center">
            <Grid2 size={{ xs: 12, sm: 3 }}>{tf(t("cName"), c.name, (v) => setContact(i, "name", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 2 }}>{tf(t("role"), c.role, (v) => setContact(i, "role", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 3 }}>{tf(t("email"), c.email, (v) => setContact(i, "email", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 2 }}>{tf(t("phone"), c.phone, (v) => setContact(i, "phone", v))}</Grid2>
            <Grid2 size={{ xs: 4, sm: 1 }}>
              <TextField select size="small" fullWidth label={t("lang")} value={c.lang ?? ""} onChange={(e) => setContact(i, "lang", e.target.value || undefined)}>
                <MenuItem value="">—</MenuItem>
                <MenuItem value="ja">JA</MenuItem>
                <MenuItem value="en">EN</MenuItem>
              </TextField>
            </Grid2>
            <Grid2 size={{ xs: 2, sm: 1 }}>
              <FormControlLabel sx={{ m: 0 }} control={<Radio size="small" checked={!!c.isPrimary} onChange={() => setContact(i, "isPrimary", true)} />} label={<Typography variant="caption">{t("main")}</Typography>} labelPlacement="top" />
            </Grid2>
          </Grid2>
        ))}
        {editing && contacts.length > 0 && <Typography variant="caption" color="text.secondary">{t("keep")}</Typography>}

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t("logistics")}</Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }} data-tour="company-carriers">
          {(lines.data?.partners ?? lines.data?.lines ?? []).filter((l) => (l.types ?? ["SHIPPING_LINE"]).includes("SHIPPING_LINE")).map((l) => {
            const on = (f.logistics?.carriers ?? []).includes(l.code);
            return <Chip key={l.code} size="small" label={l.name} color={on ? "primary" : "default"} variant={on ? "filled" : "outlined"} onClick={() => setLg("carriers", on ? (f.logistics?.carriers ?? []).filter((x) => x !== l.code) : [...(f.logistics?.carriers ?? []), l.code])} />;
          })}
        </Stack>
        <Grid2 container spacing={1.25}>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("bl"), f.logistics?.blPattern, (v) => setLg("blPattern", v), { helperText: t("patternHint", { p: "^198[A-Z]{2}\\d{5}$" }) })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("booking"), f.logistics?.bookingPattern, (v) => setLg("bookingPattern", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 5 }}>{tf(t("pol"), f.logistics?.portOfLoading, (v) => setLg("portOfLoading", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 5 }}>{tf(t("pod"), f.logistics?.portOfDischarge, (v) => setLg("portOfDischarge", v))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 2 }}>
            <TextField select size="small" fullWidth label={t("inc")} value={f.logistics?.incoterm ?? ""} onChange={(e) => setLg("incoterm", e.target.value || undefined)}>
              <MenuItem value="">—</MenuItem>
              {INCOTERMS.map((x) => <MenuItem key={x} value={x}>{x}</MenuItem>)}
            </TextField>
          </Grid2>
        </Grid2>

        <Divider sx={{ my: 2 }} />
        {tf(t("notes"), f.company?.notes, (v) => setC("notes", v), { multiline: true, minRows: 3 })}
        {err && <Typography color="error" variant="body2" sx={{ mt: 1.5 }}>{err}</Typography>}
      </Box>
      <Stack direction="row" spacing={1} sx={{ pt: 1.5 }}>
        <Button variant="contained" onClick={save} disabled={busy || !f.name?.trim()} data-tour="company-save">{t("save")}</Button>
        <Button onClick={onClose} disabled={busy}>{t("cancel")}</Button>
      </Stack>
    </Drawer>
  );
}
