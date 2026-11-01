/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Org settings for the documents made in-app (TradeSetting.docDefaults), shown
// in Org Settings → Shipping & documents: bank accounts an invoice can print
// (one is the default), the issuer printed on each template (請求書 / customer
// documents / 出庫・納入依頼書) and the 出庫・納入依頼書 宛先, the company seal on
// 請求書, customer delivery profiles for 出庫・納入依頼書, and QMJP by quarter
// (the invoices' price helper). Existing documents keep what they were created with.

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Divider, Grid2, IconButton, MenuItem, Radio, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import UploadIcon from "@mui/icons-material/UploadFile";
import { bankEntity, type BankAccount, type DeliveryProfile, type IssuingEntity } from "../_lib/api";
import { useTradeMutation, useTradeSettings } from "../_lib/hooks";
import { toast } from "../_lib/toast";
import LmeFeedPanel from "./LmeFeedPanel";
import { useTranslations } from "next-intl";

const SEAL_MAX = 1024 * 1024;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Issuers = { invoiceFromBlock: string; customerDocIssuerName: string; customerDocIssuerAddress: string; customerDocContact: string; siIssuerName: string; siAddressee: string };
const ISSUER_KEYS: Array<keyof Issuers> = ["invoiceFromBlock", "customerDocIssuerName", "customerDocIssuerAddress", "customerDocContact", "siIssuerName", "siAddressee"];

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

type QmjpRow = { key: string; quarter: string; value: string };
const QUARTER = /^\d{4}-[1-4]Q$/;
type LmeRow = { key: string; month: string; value: string };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function DocSettingsForm() {
  const t = useTranslations("settings.docSettings");
  const settings = useTradeSettings(true);
  // Edits are kept while the settings refetch in the background; a save reloads them.
  const [dirty, setDirty] = useState(false);
  const [qmjp, setQmjp] = useState<QmjpRow[]>([]);
  const [lme, setLme] = useState<LmeRow[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [defaultBankId, setDefaultBankId] = useState<string>("");
  const [issuers, setIssuers] = useState<Issuers>({ invoiceFromBlock: "", customerDocIssuerName: "", customerDocIssuerAddress: "", customerDocContact: "", siIssuerName: "", siAddressee: "" });
  const [seal, setSeal] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<DeliveryProfile[]>([]);
  const [keepDomains, setKeepDomains] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useTradeMutation((api, docDefaults: Record<string, unknown>) => api.updateSettings({ docDefaults }));

  useEffect(() => {
    if (!settings.data || dirty) return;
    const d = settings.data.docDefaults ?? {};
    // Orgs set up before the bank list have one bank text: start the list from it.
    const list: BankAccount[] = Array.isArray(d.banks) && d.banks.length ? d.banks : d.invoiceBankBlock ? [{ id: "default", label: String(d.invoiceBankBlock).split("\n")[0], block: d.invoiceBankBlock }] : [];
    setBanks(list.map((b) => ({ ...b })));
    setDefaultBankId(d.defaultBankId && list.some((b) => b.id === d.defaultBankId) ? d.defaultBankId : (list[0]?.id ?? ""));
    setIssuers(Object.fromEntries(ISSUER_KEYS.map((k) => [k, String(d[k] ?? "")])) as Issuers);
    setSeal(typeof d.sealImage === "string" ? d.sealImage : null);
    setProfiles((d.deliveryProfiles ?? []).map((p) => ({ ...p })));
    const table = (d.qmjpByQuarter ?? {}) as Record<string, number>;
    setQmjp(Object.keys(table).sort().map((q) => ({ key: q, quarter: q, value: String(table[q]) })));
    const lt = (d.lmeByMonth ?? {}) as Record<string, number>;
    setLme(Object.keys(lt).sort().map((m) => ({ key: m, month: m, value: String(lt[m]) })));
    setKeepDomains(Array.isArray(d.intakeKeepDomains) ? d.intakeKeepDomains.join("\n") : "");
    setError(null);
  }, [settings.data, dirty]);

  const pickSeal = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return setError(t("errSealType"));
    if (file.size > SEAL_MAX) return setError(t("errSealSize"));
    const reader = new FileReader();
    reader.onload = () => {
      setSeal(String(reader.result));
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError(null);
    if (banks.some((b) => !b.label.trim() || !b.block.trim())) return setError(t("errBank"));
    if (profiles.some((p) => !p.siteName.trim())) return setError(t("errProfile"));
    const q = qmjp.filter((r) => r.quarter.trim() || r.value.trim());
    if (q.some((r) => !QUARTER.test(r.quarter.trim()))) return setError(t("errQmjpQuarter"));
    if (q.some((r) => r.value.trim() === "" || !Number.isFinite(Number(r.value)) || Number(r.value) < 0)) return setError(t("errQmjpValue"));
    if (new Set(q.map((r) => r.quarter.trim())).size !== q.length) return setError(t("errQmjpDup"));
    const l = lme.filter((r) => r.month.trim() || r.value.trim());
    if (l.some((r) => !MONTH.test(r.month.trim()))) return setError(t("errLmeMonth"));
    if (l.some((r) => !(Number(r.value) > 0))) return setError(t("errLmeValue"));
    if (new Set(l.map((r) => r.month.trim())).size !== l.length) return setError(t("errLmeDup"));
    const keep = keepDomains
      .split(/[,\s]+/)
      .map((x) => x.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    const badDomain = keep.find((x) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(x));
    if (badDomain) return setError(t("errDomain", { domain: badDomain }));
    try {
      await save.mutateAsync({
        banks: banks.map((b) => ({ id: b.id, label: b.label.trim(), block: b.block, entity: bankEntity(b) })),
        defaultBankId: banks.some((b) => b.id === defaultBankId) ? defaultBankId : (banks[0]?.id ?? null),
        ...Object.fromEntries(ISSUER_KEYS.map((k) => [k, issuers[k].trim() ? issuers[k] : null])),
        sealImage: seal,
        deliveryProfiles: profiles.map((p) => ({ ...p, customerName: p.customerName.trim(), siteName: p.siteName.trim(), address: p.address.trim() })),
        qmjpByQuarter: Object.fromEntries(q.map((r) => [r.quarter.trim(), Number(r.value)])),
        lmeByMonth: Object.fromEntries(l.map((r) => [r.month.trim(), Number(r.value)])),
        intakeKeepDomains: keep.length ? keep : null,
      });
      setDirty(false);
      toast.success(t("saved"));
    } catch (e: any) {
      setError(e?.message || t("couldNotSave"));
    }
  };

  const loading = settings.isLoading;
  const mono = { style: { fontFamily: "monospace", fontSize: 12.5 } };
  const setBank = (i: number, patch: Partial<BankAccount>) => setBanks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const iss = (k: keyof Issuers, label: string, extra: Record<string, any> = {}) => (
    <TextField size="small" fullWidth label={label} value={issuers[k]} disabled={loading} onChange={(e) => setIssuers((x) => ({ ...x, [k]: e.target.value }))} {...extra} />
  );

  return (
    <Box onChangeCapture={() => setDirty(true)} onClickCapture={(e) => (e.target as HTMLElement).closest("button") && setDirty(true)}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {settings.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {(settings.error as Error)?.message || t("couldNotLoad")}
          </Alert>
        )}

        <Section
          title={t("banks")}
          action={
            <Button size="small" startIcon={<AddIcon />} onClick={() => setBanks((bs) => [...bs, { id: newId("bank"), label: "", block: "" }])} disabled={loading}>
              {t("addBank")}
            </Button>
          }
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {t("banksHint")}
          </Typography>
          <Stack spacing={1.5}>
            {banks.map((b, i) => (
              <Stack key={b.id} direction="row" spacing={1} alignItems="flex-start">
                <Tooltip title={t("defaultBank")}>
                  <Radio checked={defaultBankId === b.id} onChange={() => setDefaultBankId(b.id)} inputProps={{ "aria-label": t("defaultBankAria", { label: b.label }) }} />
                </Tooltip>
                <Grid2 container spacing={1} sx={{ flex: 1 }}>
                  <Grid2 size={{ xs: 12, sm: 8 }}>
                    <TextField size="small" fullWidth label={t("name")} value={b.label} onChange={(e) => setBank(i, { label: e.target.value })} />
                  </Grid2>
                  <Grid2 size={{ xs: 12, sm: 4 }}>
                    <TextField select size="small" fullWidth label={t("entity")} value={bankEntity(b)} onChange={(e) => setBank(i, { entity: e.target.value as IssuingEntity })} data-tour="settings-bank-entity">
                      <MenuItem value="ADH_SG">ADH SG (Asia Deal Hub Pte. Ltd.)</MenuItem>
                      <MenuItem value="ADH_JP">ADH JP (アジアディールハブジャパン合同会社)</MenuItem>
                    </TextField>
                  </Grid2>
                  <Grid2 size={12}>
                    <TextField size="small" fullWidth multiline minRows={4} label={t("printedText")} value={b.block} onChange={(e) => setBank(i, { block: e.target.value })} inputProps={mono} />
                  </Grid2>
                </Grid2>
                <Tooltip title={t("removeBank")}>
                  <IconButton aria-label={t("removeBank")} onClick={() => setBanks((bs) => bs.filter((_, j) => j !== i))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        </Section>
        <Divider sx={{ mb: 2 }} />

        <Section title={t("issuers")}>
          <Grid2 container spacing={1.5}>
            <Grid2 size={12}>{iss("invoiceFromBlock", t("invoiceFromBlock"), { multiline: true, minRows: 3 })}</Grid2>
            <Grid2 size={{ xs: 12, sm: 6 }}>{iss("customerDocIssuerName", t("customerDocIssuerName"))}</Grid2>
            <Grid2 size={{ xs: 12, sm: 6 }}>{iss("customerDocContact", t("customerDocContact"))}</Grid2>
            <Grid2 size={12}>{iss("customerDocIssuerAddress", t("customerDocIssuerAddress"), { multiline: true, minRows: 2 })}</Grid2>
            <Grid2 size={12}>{iss("siIssuerName", t("siIssuerName"))}</Grid2>
            <Grid2 size={12}>{iss("siAddressee", t("siAddressee"), { placeholder: "三井倉庫 株式会社 御中", helperText: t("siAddresseeHint") })}</Grid2>
          </Grid2>
        </Section>
        <Divider sx={{ mb: 2 }} />

        <Section title={t("seal")}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ width: 96, height: 96, border: 1, borderColor: "divider", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "#fff" }}>
              {seal ? <Box component="img" src={seal} alt={t("sealAlt")} sx={{ maxWidth: 88, maxHeight: 88 }} /> : <Typography variant="caption" color="text.secondary">{t("noSeal")}</Typography>}
            </Box>
            <Button component="label" variant="outlined" startIcon={<UploadIcon />} disabled={loading}>
              {seal ? t("replaceSeal") : t("uploadSeal")}
              <input hidden type="file" accept="image/png,image/jpeg" onChange={(e) => pickSeal(e.target.files?.[0])} />
            </Button>
            {seal && (
              <Button color="error" onClick={() => setSeal(null)}>
                {t("remove")}
              </Button>
            )}
          </Stack>
        </Section>
        <Divider sx={{ mb: 2 }} />

        <Section title={t("sites")}>
          <Typography variant="body2" color="text.secondary">
            {t("sitesHint")}{" "}
            <Link href="/portal/settings/customers">{t("sitesLink")}</Link>
            {profiles.length ? t("sitesOlder", { n: profiles.length }) : t("sitesEnd")}
          </Typography>
        </Section>
        <Divider sx={{ mb: 2 }} />

        <Section
          title={t("qmjp")}
          action={
            <Button size="small" startIcon={<AddIcon />} onClick={() => setQmjp((rs) => [...rs, { key: newId("q"), quarter: "", value: "" }])} disabled={loading}>
              {t("addQuarter")}
            </Button>
          }
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {t("qmjpHint")}
          </Typography>
          <Stack spacing={1} data-tour="settings-qmjp">
            {qmjp.map((r, i) => (
              <Stack key={r.key} direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  label={t("quarter")}
                  placeholder="2026-3Q"
                  value={r.quarter}
                  error={!!r.quarter.trim() && !QUARTER.test(r.quarter.trim())}
                  onChange={(e) => setQmjp((rs) => rs.map((x, j) => (j === i ? { ...x, quarter: e.target.value.toUpperCase() } : x)))}
                  sx={{ width: 160 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="QMJP"
                  value={r.value}
                  inputProps={{ step: "0.01", min: 0, style: { textAlign: "right" } }}
                  onChange={(e) => setQmjp((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  sx={{ width: 160 }}
                />
                <Tooltip title={t("removeQuarter")}>
                  <IconButton aria-label={t("removeQuarter")} onClick={() => setQmjp((rs) => rs.filter((_, j) => j !== i))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
            {!qmjp.length && (
              <Typography variant="body2" color="text.secondary">
                {t("noQuarters")}
              </Typography>
            )}
          </Stack>
        </Section>

        <Divider sx={{ mb: 2 }} />
        <Section
          title={t("lme")}
          action={
            <Button size="small" startIcon={<AddIcon />} onClick={() => setLme((rs) => [...rs, { key: newId("l"), month: "", value: "" }])} disabled={loading}>
              {t("addMonth")}
            </Button>
          }
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {t("lmeHint")}
          </Typography>
          <Stack spacing={1} data-tour="settings-lme">
            {lme.map((r, i) => (
              <Stack key={r.key} direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  label={t("month")}
                  placeholder="2026-07"
                  value={r.month}
                  error={!!r.month.trim() && !MONTH.test(r.month.trim())}
                  onChange={(e) => setLme((rs) => rs.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))}
                  sx={{ width: 160 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="LME"
                  value={r.value}
                  inputProps={{ step: "0.01", min: 0, style: { textAlign: "right" } }}
                  onChange={(e) => setLme((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  sx={{ width: 160 }}
                />
                <Tooltip title={t("removeMonth")}>
                  <IconButton aria-label={t("removeMonth")} onClick={() => setLme((rs) => rs.filter((_, j) => j !== i))}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
            {!lme.length && (
              <Typography variant="body2" color="text.secondary">
                {t("noMonths")}
              </Typography>
            )}
          </Stack>
          <LmeFeedPanel />
        </Section>

        <Section title={t("keep")}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            {t("keepHint")}
          </Typography>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={4}
            label={t("keepDomains")}
            value={keepDomains}
            disabled={loading}
            onChange={(e) => setKeepDomains(e.target.value)}
            placeholder={"vedanta.co.in\nsus.co.jp\nkatokei.co.jp\nmitsui-soko.co.jp\nwanhai.com"}
            inputProps={{ style: { fontFamily: "monospace", fontSize: 12.5 } }}
            data-tour="settings-intake-keep-domains"
          />
        </Section>

        <Stack direction="row" justifyContent="flex-end" spacing={1}>
          <Button
            disabled={save.isPending || !dirty}
            onClick={() => {
              setDirty(false);
              void settings.refetch();
            }}
          >
            {t("discard")}
          </Button>
          <Button variant="contained" onClick={submit} disabled={save.isPending || loading}>
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </Stack>
    </Box>
  );
}
