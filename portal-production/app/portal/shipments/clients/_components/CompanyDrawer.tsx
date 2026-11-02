/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY part 3 — "+ Add customer / supplier" and Details → Edit: one drawer with the company (names EN / JA,
// address, country, phone, e-mail, website, tax / registration no., currency), payment terms and bank (the account
// number is shown masked; typing a new one replaces it), contacts (name, role, e-mail, phone, language, main contact —
// added or edited, never deleted here), shipping lines and logistics, and notes. Saved through the Clients API.
// Round BA: adding is a 4-step flow — Basic (this form; saving creates the company and stays open) → Products →
// Packing → Contract; the steps after Basic are optional and "Save and finish later" closes at any step.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Divider, Drawer, FormControlLabel, Grid2, IconButton, MenuItem, Radio, Stack, Step, StepButton, Stepper, TextField, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type ClientCatalog, type CompanyForm, type ContactInfo } from "../../_lib/api";
import { CLIENT_KEYS, SHIPMENT_KEYS, useShippingLines } from "../../_lib/hooks";
import { toast } from "../../_lib/toast";
import ContractFormDialog from "../../_components/ContractFormDialog";
import { AddFlowContractStep, AddFlowPackingStep, AddFlowProductsStep, EMPTY_PHOTO, EMPTY_PRODUCT, productBody, productPending, type PhotoDraft, type ProductDraft } from "./AddFlowSteps";

export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const CURRENCIES = ["USD", "JPY", "SGD", "INR", "THB", "IDR", "EUR"];
const STEPS = ["basic", "products", "packing", "contract"] as const;

export type CompanyDrawerInitial = CompanyForm & { id?: string };

export default function CompanyDrawer({ kind, open, initial, onClose, onSaved }: { kind: "customer" | "supplier"; open: boolean; initial: CompanyDrawerInitial | null; onClose: () => void; onSaved?: (id: string) => void; lang?: "en" | "ja" }) {
  const t = useTranslations("clients.drawer");
  const ta = useTranslations("addflow");
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const lines = useShippingLines();
  const [f, setF] = useState<CompanyDrawerInitial>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Add flow: the step, the company once Basic is saved, its products / packing as saved, and the drafts.
  const [step, setStep] = useState(0);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ClientCatalog | null>(null);
  const [product, setProduct] = useState<ProductDraft>(EMPTY_PRODUCT);
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [photo, setPhoto] = useState<PhotoDraft>(EMPTY_PHOTO);
  const [contractOpen, setContractOpen] = useState(false);
  const [contracts, setContracts] = useState(0);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (open) {
      setF(initial ?? { currency: "USD", company: {}, logistics: {}, contacts: [] });
      setErr(null);
      setStep(0);
      setCreatedId(null);
      setCatalog(null);
      setProduct(EMPTY_PRODUCT);
      setNotes("");
      setSavedNotes("");
      setPhoto(EMPTY_PHOTO);
      setContracts(0);
      setDoneSteps(new Set());
    }
  }, [open, initial]);
  const set = (k: keyof CompanyForm, v: any) => setF((x) => ({ ...x, [k]: v }));
  const setC = (k: string, v: any) => setF((x) => ({ ...x, company: { ...(x.company ?? {}), [k]: v } }));
  const setB = (k: string, v: any) => setF((x) => ({ ...x, company: { ...(x.company ?? {}), bank: { ...(x.company?.bank ?? {}), [k]: v } } }));
  const setLg = (k: string, v: any) => setF((x) => ({ ...x, logistics: { ...(x.logistics ?? {}), [k]: v } }));
  const contacts = f.contacts ?? [];
  const setContact = (i: number, k: keyof ContactInfo, v: any) => set("contacts", contacts.map((c, j) => (j === i ? { ...c, [k]: v } : k === "isPrimary" && v ? { ...c, isPrimary: false } : c)));
  const editing = !!initial?.id;
  const apiKind = kind === "customer" ? "customers" : "suppliers";
  const markDone = (i: number) => setDoneSteps((d) => new Set(d).add(i));

  // Closing once the company exists hands its id to the caller (the list pages open it).
  const close = () => {
    if (busy) return;
    if (createdId) onSaved?.(createdId);
    onClose();
  };

  // One save on a step after Basic; errors stay on screen and keep the drawer where it is.
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const addProduct = () =>
    run(async () => {
      setCatalog(await api.clientSaveProduct(apiKind, createdId!, null, productBody(product)));
      setProduct(EMPTY_PRODUCT);
      markDone(1);
      toast.success(ta("products.added"));
    });
  const saveNotes = () =>
    run(async () => {
      setCatalog(await api.clientSavePacking(apiKind, createdId!, { notes: notes.trim() || null }));
      setSavedNotes(notes);
      markDone(2);
      toast.success(ta("packing.notesSaved"));
    });
  const uploadPhoto = () =>
    run(async () => {
      setCatalog(await api.clientUploadProfileFile(apiKind, createdId!, null, "packing", photo.file!, { caption: photo.caption.trim() || undefined, takenOn: photo.takenOn || undefined }));
      setPhoto(EMPTY_PHOTO);
      markDone(2);
      toast.success(ta("packing.uploaded"));
    });
  // What is typed on the step and not saved yet (saved by Next / Save and finish later).
  const pending = step === 1 ? productPending(product) : step === 2 ? notes !== savedNotes || !!photo.file : false;
  const flush = async () => {
    if (step === 1 && productPending(product)) return addProduct();
    if (step === 2) {
      if (notes !== savedNotes && !(await saveNotes())) return false;
      if (photo.file) return uploadPhoto();
    }
    return true;
  };
  const next = async () => {
    if (await flush()) setStep((x) => Math.min(x + 1, STEPS.length - 1));
  };
  const finish = async () => {
    if (await flush()) close();
  };

  const save = async (later = false) => {
    if (createdId) return;
    setBusy(true);
    setErr(null);
    try {
      const body: CompanyForm = { ...f, contacts: contacts.filter((c) => c.name?.trim()) };
      delete (body as any).id;
      const r: any = editing
        ? kind === "customer" ? await api.clientUpdateCustomer(initial!.id!, body) : await api.clientUpdateSupplier(initial!.id!, body)
        : kind === "customer" ? await api.clientCreateCustomer(body) : await api.clientCreateSupplier(body);
      await Promise.all([qc.invalidateQueries({ queryKey: CLIENT_KEYS.all }), qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders }), ...(editing ? [] : [qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.parties })])]);
      const id = (r?.customer?.id ?? r?.supplier?.id) as string;
      if (!editing && id && !later) {
        // Add flow: stay open on Products with the new company (onSaved runs when the drawer closes).
        toast.success(ta("nav.createdToast", { name: f.name?.trim() ?? "" }));
        setCreatedId(id);
        markDone(0);
        setStep(1);
        return;
      }
      toast.success(t("saved"));
      onSaved?.(id);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tf = (label: string, value: any, onChange: (v: string) => void, extra: any = {}) => <TextField size="small" fullWidth label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...extra} />;
  return (
    <Drawer anchor="right" open={open} onClose={close} slotProps={{ paper: { sx: { width: { xs: "100vw", sm: 600 }, p: 2 } } }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>{editing ? `${t("edit")} · ${initial?.name ?? ""}` : kind === "customer" ? t("addC") : t("addS")}</Typography>
        <IconButton onClick={close} aria-label={t("close")} disabled={busy}><CloseIcon /></IconButton>
      </Stack>
      {!editing && (
        <Stepper nonLinear activeStep={step} alternativeLabel sx={{ mb: 2 }} data-tour="addflow-stepper">
          {STEPS.map((k, i) => (
            <Step key={k} completed={doneSteps.has(i)} data-tour={`addflow-step-${k}`}>
              {/* Basic is done once the company exists (later edits go through Details → Edit); the others need it. */}
              <StepButton disabled={busy || (i === 0 ? !!createdId : !createdId)} onClick={() => setStep(i)} optional={i > 0 ? <Typography variant="caption" color="text.secondary">{ta("steps.optional")}</Typography> : undefined}>
                {ta(`steps.${k}`)}
              </StepButton>
            </Step>
          ))}
        </Stepper>
      )}
      {createdId && step > 0 && <Alert severity="success" sx={{ mb: 1.5 }}>{ta("nav.created", { name: f.name?.trim() ?? "" })}</Alert>}
      {step === 1 && createdId && (
        <Box sx={{ overflowY: "auto", flex: 1, pr: 0.5 }}>
          <AddFlowProductsStep kind={kind} draft={product} setDraft={setProduct} products={catalog?.products ?? []} busy={busy} onAdd={() => void addProduct()} />
        </Box>
      )}
      {step === 2 && createdId && (
        <Box sx={{ overflowY: "auto", flex: 1, pr: 0.5 }}>
          <AddFlowPackingStep notes={notes} setNotes={setNotes} notesDirty={notes !== savedNotes} photo={photo} setPhoto={setPhoto} images={catalog?.packing.images ?? []} busy={busy} onSaveNotes={() => void saveNotes()} onUpload={() => void uploadPhoto()} />
        </Box>
      )}
      {step === 3 && createdId && (
        <Box sx={{ overflowY: "auto", flex: 1, pr: 0.5 }}>
          <AddFlowContractStep kind={kind} count={contracts} onAdd={() => setContractOpen(true)} />
        </Box>
      )}
      {step > 0 && err && <Typography color="error" variant="body2" sx={{ mt: 1.5 }}>{err}</Typography>}
      {step === 0 && (
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
      )}
      {editing ? (
        <Stack direction="row" spacing={1} sx={{ pt: 1.5 }}>
          <Button variant="contained" onClick={() => void save()} disabled={busy || !f.name?.trim()} data-tour="company-save">{t("save")}</Button>
          <Button onClick={onClose} disabled={busy}>{t("cancel")}</Button>
        </Stack>
      ) : step === 0 ? (
        <Stack direction="row" spacing={1} sx={{ pt: 1.5 }} flexWrap="wrap" useFlexGap>
          <Button variant="contained" onClick={() => void save()} disabled={busy || !f.name?.trim()} data-tour="company-save">{ta("nav.saveContinue")}</Button>
          <Button variant="outlined" onClick={() => void save(true)} disabled={busy || !f.name?.trim()} data-tour="addflow-finish-later">{ta("nav.finishLater")}</Button>
          <Button onClick={onClose} disabled={busy}>{t("cancel")}</Button>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} sx={{ pt: 1.5 }} flexWrap="wrap" useFlexGap>
          {step < STEPS.length - 1 ? (
            <Button variant="contained" onClick={() => void next()} disabled={busy} data-tour="addflow-next">{pending || doneSteps.has(step) ? ta("nav.next") : ta("nav.skip")}</Button>
          ) : (
            <Button variant="contained" onClick={() => void finish()} disabled={busy} data-tour="addflow-finish">{ta("nav.finish")}</Button>
          )}
          {step < STEPS.length - 1 && <Button variant="outlined" onClick={() => void finish()} disabled={busy} data-tour="addflow-finish-later">{ta("nav.finishLater")}</Button>}
          {step > 1 && <Button onClick={() => setStep((x) => x - 1)} disabled={busy}>{ta("nav.back")}</Button>}
        </Stack>
      )}
      {createdId && (
        <ContractFormDialog
          open={contractOpen}
          onClose={() => setContractOpen(false)}
          party={kind === "customer" ? { customerId: createdId } : { supplierId: createdId }}
          onSaved={(c) => {
            setContracts((n) => n + 1);
            markDone(3);
            void qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
            toast.success(ta("contract.saved", { no: c.contractNo ?? "" }));
          }}
        />
      )}
    </Drawer>
  );
}
