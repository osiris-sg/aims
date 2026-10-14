/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Org settings for the documents made in-app (TradeSetting.docDefaults):
// bank accounts an invoice can print (one is the default), the issuer printed
// on each template (請求書 / customer documents / 出庫・納入依頼書), the company
// seal on 請求書, and customer delivery profiles for 出庫・納入依頼書. Existing
// documents keep what they were created with.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Grid2, IconButton, Radio, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import UploadIcon from "@mui/icons-material/UploadFile";
import type { BankAccount, DeliveryProfile } from "../_lib/api";
import { useTradeMutation, useTradeSettings } from "../_lib/hooks";
import { toast } from "../_lib/toast";

const SEAL_MAX = 1024 * 1024;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Issuers = { invoiceFromBlock: string; customerDocIssuerName: string; customerDocIssuerAddress: string; customerDocContact: string; siIssuerName: string };
const ISSUER_KEYS: Array<keyof Issuers> = ["invoiceFromBlock", "customerDocIssuerName", "customerDocIssuerAddress", "customerDocContact", "siIssuerName"];

const Section = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <Box sx={{ mb: 3 }}>
    <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Box sx={{ flex: 1 }} />
      {action}
    </Stack>
    {children}
  </Box>
);

export default function DocSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useTradeSettings(open);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [defaultBankId, setDefaultBankId] = useState<string>("");
  const [issuers, setIssuers] = useState<Issuers>({ invoiceFromBlock: "", customerDocIssuerName: "", customerDocIssuerAddress: "", customerDocContact: "", siIssuerName: "" });
  const [seal, setSeal] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<DeliveryProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const save = useTradeMutation((api, docDefaults: Record<string, unknown>) => api.updateSettings({ docDefaults }));

  useEffect(() => {
    if (!open || !settings.data) return;
    const d = settings.data.docDefaults ?? {};
    // Orgs set up before the bank list have one bank text: start the list from it.
    const list: BankAccount[] = Array.isArray(d.banks) && d.banks.length ? d.banks : d.invoiceBankBlock ? [{ id: "default", label: String(d.invoiceBankBlock).split("\n")[0], block: d.invoiceBankBlock }] : [];
    setBanks(list.map((b) => ({ ...b })));
    setDefaultBankId(d.defaultBankId && list.some((b) => b.id === d.defaultBankId) ? d.defaultBankId : (list[0]?.id ?? ""));
    setIssuers(Object.fromEntries(ISSUER_KEYS.map((k) => [k, String(d[k] ?? "")])) as Issuers);
    setSeal(typeof d.sealImage === "string" ? d.sealImage : null);
    setProfiles((d.deliveryProfiles ?? []).map((p) => ({ ...p })));
    setError(null);
  }, [open, settings.data]);

  const pickSeal = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setError("The seal must be a PNG or JPEG image");
    if (file.size > SEAL_MAX) return setError("The seal image must be 1 MB or smaller");
    const reader = new FileReader();
    reader.onload = () => {
      setSeal(String(reader.result));
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError(null);
    if (banks.some((b) => !b.label.trim() || !b.block.trim())) return setError("Every bank account needs a name and its text");
    if (profiles.some((p) => !p.siteName.trim())) return setError("Every delivery profile needs a site name");
    try {
      await save.mutateAsync({
        banks: banks.map((b) => ({ id: b.id, label: b.label.trim(), block: b.block })),
        defaultBankId: banks.some((b) => b.id === defaultBankId) ? defaultBankId : (banks[0]?.id ?? null),
        ...Object.fromEntries(ISSUER_KEYS.map((k) => [k, issuers[k].trim() ? issuers[k] : null])),
        sealImage: seal,
        deliveryProfiles: profiles.map((p) => ({ ...p, customerName: p.customerName.trim(), siteName: p.siteName.trim(), address: p.address.trim() })),
      });
      toast.success("Document settings saved");
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not save the settings");
    }
  };

  const loading = settings.isLoading;
  const mono = { style: { fontFamily: "monospace", fontSize: 12.5 } };
  const setBank = (i: number, patch: Partial<BankAccount>) => setBanks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const setProfile = (i: number, patch: Partial<DeliveryProfile>) => setProfiles((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const iss = (k: keyof Issuers, label: string, extra: Record<string, any> = {}) => (
    <TextField size="small" fullWidth label={label} value={issuers[k]} disabled={loading} onChange={(e) => setIssuers((x) => ({ ...x, [k]: e.target.value }))} {...extra} />
  );

  return (
    <Dialog open={open} onClose={() => !save.isPending && onClose()} maxWidth="md" fullWidth>
      <DialogTitle>Document settings</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {settings.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {(settings.error as Error)?.message || "Could not load the settings"}
          </Alert>
        )}

        <Section
          title="Bank accounts (弊社指定口座)"
          action={
            <Button size="small" startIcon={<AddIcon />} onClick={() => setBanks((bs) => [...bs, { id: newId("bank"), label: "", block: "" }])} disabled={loading}>
              Add bank
            </Button>
          }
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            One line per row; &quot;label&lt;Tab&gt;value&quot; prints as two columns. The selected default starts every new invoice.
          </Typography>
          <Stack spacing={1.5}>
            {banks.map((b, i) => (
              <Stack key={b.id} direction="row" spacing={1} alignItems="flex-start">
                <Tooltip title="Default for new invoices">
                  <Radio checked={defaultBankId === b.id} onChange={() => setDefaultBankId(b.id)} inputProps={{ "aria-label": `Default bank ${b.label}` }} />
                </Tooltip>
                <Grid2 container spacing={1} sx={{ flex: 1 }}>
                  <Grid2 size={12}>
                    <TextField size="small" fullWidth label="Name" value={b.label} onChange={(e) => setBank(i, { label: e.target.value })} />
                  </Grid2>
                  <Grid2 size={12}>
                    <TextField size="small" fullWidth multiline minRows={4} label="Printed text" value={b.block} onChange={(e) => setBank(i, { block: e.target.value })} inputProps={mono} />
                  </Grid2>
                </Grid2>
                <Tooltip title="Remove bank">
                  <IconButton aria-label="Remove bank" onClick={() => setBanks((bs) => bs.filter((_, j) => j !== i))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        </Section>
        <Divider sx={{ mb: 2 }} />

        <Section title="Issuer per document">
          <Grid2 container spacing={1.5}>
            <Grid2 size={12}>{iss("invoiceFromBlock", "請求書 — From block", { multiline: true, minRows: 3 })}</Grid2>
            <Grid2 size={{ xs: 12, sm: 6 }}>{iss("customerDocIssuerName", "計量検収票 / 納品書兼分析試験成績報告書 — issuer")}</Grid2>
            <Grid2 size={{ xs: 12, sm: 6 }}>{iss("customerDocContact", "担当 (contact)")}</Grid2>
            <Grid2 size={12}>{iss("customerDocIssuerAddress", "Issuer address", { multiline: true, minRows: 2 })}</Grid2>
            <Grid2 size={12}>{iss("siIssuerName", "出庫・納入依頼書 — issuer / 出荷主")}</Grid2>
          </Grid2>
        </Section>
        <Divider sx={{ mb: 2 }} />

        <Section title="Company seal (請求書)">
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ width: 96, height: 96, border: 1, borderColor: "divider", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "#fff" }}>
              {seal ? <Box component="img" src={seal} alt="Company seal" sx={{ maxWidth: 88, maxHeight: 88 }} /> : <Typography variant="caption" color="text.secondary">No seal</Typography>}
            </Box>
            <Button component="label" variant="outlined" startIcon={<UploadIcon />} disabled={loading}>
              {seal ? "Replace" : "Upload"} PNG / JPEG
              <input hidden type="file" accept="image/png,image/jpeg" onChange={(e) => pickSeal(e.target.files?.[0])} />
            </Button>
            {seal && (
              <Button color="error" onClick={() => setSeal(null)}>
                Remove
              </Button>
            )}
          </Stack>
        </Section>
        <Divider sx={{ mb: 2 }} />

        <Section
          title="Delivery profiles (出庫・納入依頼書)"
          action={
            <Button size="small" startIcon={<AddIcon />} onClick={() => setProfiles((ps) => [...ps, { id: newId("site"), customerName: "", siteName: "", address: "", notes: "" }])} disabled={loading}>
              Add profile
            </Button>
          }
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Picked automatically when the shipment&apos;s customer name contains &quot;Customer&quot;; fills 納入先 and the 備考 lines.
          </Typography>
          <Stack spacing={1.5}>
            {profiles.map((p, i) => (
              <Stack key={p.id} direction="row" spacing={1} alignItems="flex-start">
                <Grid2 container spacing={1} sx={{ flex: 1 }}>
                  <Grid2 size={{ xs: 12, sm: 4 }}>
                    <TextField size="small" fullWidth label="Customer" value={p.customerName} onChange={(e) => setProfile(i, { customerName: e.target.value })} />
                  </Grid2>
                  <Grid2 size={{ xs: 12, sm: 8 }}>
                    <TextField size="small" fullWidth label="Site name (納入先)" value={p.siteName} onChange={(e) => setProfile(i, { siteName: e.target.value })} />
                  </Grid2>
                  <Grid2 size={12}>
                    <TextField size="small" fullWidth label="Address" value={p.address} onChange={(e) => setProfile(i, { address: e.target.value })} />
                  </Grid2>
                  <Grid2 size={12}>
                    <TextField size="small" fullWidth multiline minRows={2} label="Notes (one 備考 line each)" value={p.notes} onChange={(e) => setProfile(i, { notes: e.target.value })} />
                  </Grid2>
                </Grid2>
                <Tooltip title="Remove profile">
                  <IconButton aria-label="Remove profile" onClick={() => setProfiles((ps) => ps.filter((_, j) => j !== i))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        </Section>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending || loading}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
