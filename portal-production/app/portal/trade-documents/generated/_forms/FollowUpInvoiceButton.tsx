/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BO — on a FINAL single invoice (Kato): "Correction invoice" (正誤差額: one price field corrected × quantity,
// e.g. premium 235 → 260, as ADH's 202610_004) and "Actual-cost invoice" (実費差分: the actual customs / trucking
// costs filed on step 12 minus what the invoice billed). Each makes a DRAFT linked to this invoice; it opens next.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid2, Menu, MenuItem, Stack, TextField, Typography } from "@mui/material";
import PostAddIcon from "@mui/icons-material/PostAdd";
import { useTranslations } from "next-intl";
import { useShipmentsApi } from "@/app/portal/shipments/_lib/api";
import { toast } from "@/app/portal/shipments/_lib/toast";

type Line = { kind: string; quantity: number | null; lme?: number | null; qmjp?: number | null; premium?: number | null; upcharge?: number | null };
const FIELDS = ["premium", "lme", "qmjp", "upcharge"] as const;
const yen = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `¥${Math.round(v).toLocaleString("en-US")}`);

export default function FollowUpInvoiceButton({ docId, rows, number }: { docId: string; rows: Line[]; number: string | null }) {
  const t = useTranslations("invoices.followUp");
  const api = useShipmentsApi();
  const router = useRouter();
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState<"correction" | "actuals" | null>(null);
  const [busy, setBusy] = useState(false);
  const goods = useMemo(() => rows.find((r) => r.kind === "goods") ?? null, [rows]);
  // Correction
  const [field, setField] = useState<(typeof FIELDS)[number]>("premium");
  const [to, setTo] = useState("");
  const [qty, setQty] = useState("");
  // Actuals
  const [costs, setCosts] = useState<Awaited<ReturnType<typeof api.generatedActualCosts>> | null>(null);
  const [taxable, setTaxable] = useState("");
  const [nonTaxable, setNonTaxable] = useState("");
  const [source, setSource] = useState("");
  useEffect(() => {
    if (open !== "actuals") return;
    api
      .generatedActualCosts(docId)
      .then((c) => {
        setCosts(c);
        setTaxable(c.actual.taxable === null ? "" : String(c.actual.taxable));
        setNonTaxable(c.actual.nonTaxable === null ? "" : String(c.actual.nonTaxable));
      })
      .catch((e: any) => toast.error(e?.message || t("loadFailed")));
  }, [open, api, docId, t]);
  useEffect(() => {
    if (open === "correction") setQty(goods?.quantity === null || goods?.quantity === undefined ? "" : String(goods.quantity));
  }, [open, goods]);

  const create = async () => {
    setBusy(true);
    try {
      const g =
        open === "correction"
          ? await api.generatedCorrection(docId, { field, to: Number(to), quantity: qty === "" ? null : Number(qty) })
          : await api.generatedActuals(docId, { actualTaxableJpy: taxable === "" ? null : Number(taxable), actualNonTaxableJpy: nonTaxable === "" ? null : Number(nonTaxable), source: source || null });
      toast.success(t("created"));
      setOpen(null);
      router.push(`/portal/trade-documents/generated/${g.id}`);
    } catch (e: any) {
      toast.error(e?.message || t("createFailed"));
    } finally {
      setBusy(false);
    }
  };
  const cur = goods ? (goods as any)[field] : null;
  const ok = open === "correction" ? to !== "" && Number.isFinite(Number(to)) && Number(to) !== Number(cur ?? NaN) : taxable !== "" || nonTaxable !== "";

  return (
    <>
      <Button variant="outlined" startIcon={<PostAddIcon />} onClick={(e) => setMenu({ left: e.clientX, top: e.clientY })} data-tour="invoice-follow-up">
        {t("button")}
      </Button>
      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu ?? undefined}>
        <MenuItem
          disabled={!goods}
          onClick={() => {
            setMenu(null);
            setOpen("correction");
          }}
        >
          {t("correction")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenu(null);
            setOpen("actuals");
          }}
        >
          {t("actuals")}
        </MenuItem>
      </Menu>
      <Dialog open={!!open} onClose={() => !busy && setOpen(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{open === "correction" ? t("correctionTitle", { no: number ?? "" }) : t("actualsTitle", { no: number ?? "" })}</DialogTitle>
        <DialogContent>
          {open === "correction" ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {t("correctionHelp")}
              </Typography>
              <Grid2 container spacing={1.5}>
                <Grid2 size={{ xs: 12, sm: 5 }}>
                  <TextField select fullWidth size="small" label={t("field")} value={field} onChange={(e) => setField(e.target.value as any)}>
                    {FIELDS.map((f) => (
                      <MenuItem key={f} value={f}>
                        {t(`fields.${f}`)}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid2>
                <Grid2 size={{ xs: 6, sm: 3 }}>
                  <TextField fullWidth size="small" label={t("billed")} value={cur ?? "—"} disabled />
                </Grid2>
                <Grid2 size={{ xs: 6, sm: 4 }}>
                  <TextField fullWidth size="small" type="number" label={t("correct")} value={to} onChange={(e) => setTo(e.target.value)} inputProps={{ step: "any" }} autoFocus />
                </Grid2>
                <Grid2 size={{ xs: 6, sm: 4 }}>
                  <TextField fullWidth size="small" type="number" label={t("quantity")} value={qty} onChange={(e) => setQty(e.target.value)} inputProps={{ step: "any" }} />
                </Grid2>
              </Grid2>
              {to !== "" && cur !== null && cur !== undefined && Number.isFinite(Number(to)) && (
                <Alert severity="info" sx={{ py: 0 }}>
                  {t("diff", { diff: (Number(to) - Number(cur)).toFixed(2), qty: qty || "—" })}
                </Alert>
              )}
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {t("actualsHelp")}
              </Typography>
              {!costs ? (
                <CircularProgress size={18} />
              ) : (
                <>
                  {costs.actual.shipments === 0 && <Alert severity="warning">{t("noActuals")}</Alert>}
                  <Grid2 container spacing={1.5}>
                    <Grid2 size={{ xs: 12, sm: 6 }}>
                      <TextField fullWidth size="small" type="number" label={t("actualTaxable")} value={taxable} onChange={(e) => setTaxable(e.target.value)} helperText={t("billedYen", { v: yen(costs.billed.taxable) })} />
                    </Grid2>
                    <Grid2 size={{ xs: 12, sm: 6 }}>
                      <TextField fullWidth size="small" type="number" label={t("actualNonTaxable")} value={nonTaxable} onChange={(e) => setNonTaxable(e.target.value)} helperText={t("billedYen", { v: yen(costs.billed.nonTaxable) })} />
                    </Grid2>
                    <Grid2 size={12}>
                      <TextField fullWidth size="small" label={t("source")} value={source} onChange={(e) => setSource(e.target.value)} placeholder={t("sourcePh")} />
                    </Grid2>
                  </Grid2>
                </>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(null)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="contained" onClick={() => void create()} disabled={busy || !ok}>
            {busy ? "…" : t("create")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
