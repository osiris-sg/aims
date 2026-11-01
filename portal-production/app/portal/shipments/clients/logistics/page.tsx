/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY part 3 — Clients › Shipping lines; round AZ — Clients › Logistics: every logistics company ADH works with,
// each with one or more types (shipping line, forwarder / 乙仲, customs broker, warehouse, trucking, insurer — Mitsui
// Soko is warehouse + customs + trucking). Shipping lines are matched to shipments by the B/L prefix or the shipment's
// shipping line and keep their tracking link and free time; companies with e-mail domains show their e-mail count.
// "+ Add company" and the row open the same drawer.

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Box, Button, Checkbox, Chip, Divider, Drawer, FormControlLabel, FormGroup, Grid2, IconButton, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { LOGISTICS_TYPES, useShipmentsApi, type LogisticsType, type ShippingLine } from "../../_lib/api";
import { CLIENT_KEYS, useShippingLines } from "../../_lib/hooks";
import { fmtDay } from "../../_lib/format";
import { toast } from "../../_lib/toast";
import { ClientsHeader, useLang } from "../_components/ClientsBits";
import ClientsTable, { type ClientsColumn } from "../_components/ClientsTable";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

const stop = (e: React.MouseEvent) => e.stopPropagation();

export default function LogisticsPage() {
  const lang = useLang();
  const t = useTranslations("clients.logistics");
  const tt = useTranslations("clients.logistics.types");
  const q = useShippingLines();
  const { hasPermission, userRoles } = useUserPermissions();
  const canEdit = hasPermission("shipments", "update") || userRoles.length === 0;
  const [open, setOpen] = useState<ShippingLine | "new" | null>(null);
  const [type, setType] = useState<LogisticsType | "ALL">("ALL");
  const all = useMemo(() => q.data?.partners ?? q.data?.lines ?? [], [q.data]);
  const rows = useMemo(() => (type === "ALL" ? all : all.filter((p) => p.types?.includes(type))), [all, type]);
  const count = (k: LogisticsType) => all.filter((p) => p.types?.includes(k)).length;
  const columns: ClientsColumn<ShippingLine>[] = [
    {
      id: "name",
      label: t("company"),
      minWidth: 200,
      value: (l) => `${l.name} ${l.nameJa ?? ""}`,
      render: (l) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>{lang === "ja" && l.nameJa ? l.nameJa : l.name}</Typography>
          {(lang === "ja" ? l.nameJa && l.name : l.nameJa) && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{lang === "ja" ? l.name : l.nameJa}</Typography>}
          {l.known && <Typography variant="caption" color="text.secondary">{t("known")}</Typography>}
        </Box>
      ),
    },
    { id: "types", label: t("type"), value: (l) => (l.types ?? []).map((k) => tt(k)).join(", "), render: (l) => <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{(l.types ?? []).map((k) => <Chip key={k} size="small" variant="outlined" label={tt(k)} />)}</Stack> },
    {
      id: "contact",
      label: t("contacts"),
      value: (l) => l.agents.map((a) => `${a.company ?? ""} ${a.name}`).join(", "),
      render: (l) => (l.agents.length ? <Stack spacing={0.25} sx={{ maxWidth: 220 }}>{l.agents.slice(0, 2).map((a, i) => <Typography key={i} variant="body2" noWrap title={[a.name, a.company].filter(Boolean).join(" · ")}>{a.name}</Typography>)}{l.agents.length > 2 && <Typography variant="caption" color="text.secondary">{t("more", { n: l.agents.length - 2 })}</Typography>}</Stack> : "—"),
    },
    {
      id: "web",
      label: t("web"),
      value: (l) => l.website ?? l.trackingUrl ?? "",
      render: (l) => (
        <Stack spacing={0.25}>
          {l.website && <Box component="a" href={l.website} target="_blank" rel="noreferrer" onClick={stop} sx={{ color: "primary.main" }}>{l.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</Box>}
          {l.trackingUrl && <Box component="a" href={l.trackingUrl} target="_blank" rel="noreferrer" onClick={stop} sx={{ fontSize: 12, color: "primary.main" }}>{t("track")} <OpenInNewIcon sx={{ fontSize: 12, verticalAlign: "middle" }} /></Box>}
          {!l.website && !l.trackingUrl && "—"}
        </Stack>
      ),
    },
    { id: "free", label: t("free"), value: (l) => (l.freeTime ? `DET ${l.freeTime.detDays ?? "—"} DEM ${l.freeTime.demDays ?? "—"}` : ""), render: (l) => (l.freeTime ? `DET ${l.freeTime.detDays ?? "—"} · DEM ${l.freeTime.demDays ?? "—"}` : "—") },
    { id: "ships", label: t("ships"), align: "right", value: (l) => l.shipments, render: (l) => (l.types?.includes("SHIPPING_LINE") ? <Box component="span" sx={{ whiteSpace: "nowrap" }}>{l.shipments}{l.openShipments ? ` (${t("openN", { n: l.openShipments })})` : ""}</Box> : "—") },
    { id: "emails", label: t("emails"), align: "right", value: (l) => l.emails ?? 0, render: (l) => (l.emailDomains?.length ? String(l.emails ?? 0) : "—") },
    { id: "eta", label: t("lastEta"), value: (l) => l.lastEta?.slice(0, 10) ?? null, render: (l) => (l.lastEta ? fmtDay(l.lastEta) : "—") },
    { id: "clients", label: t("usedBy"), value: (l) => l.clients.map((c) => c.name).join(", "), render: (l) => (l.clients.length ? <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{l.clients.map((c) => <Chip key={`${c.kind}${c.id}`} size="small" variant="outlined" label={c.name} />)}</Stack> : "—") },
  ];
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }} data-tour="clients-logistics">
      <ClientsHeader active="logistics" />
      {q.isError && <Alert severity="error">{(q.error as Error)?.message || t("loadError")}</Alert>}
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }} data-tour="logistics-type-filter">
        <Chip label={`${t("allTypes")} (${all.length})`} color={type === "ALL" ? "primary" : "default"} variant={type === "ALL" ? "filled" : "outlined"} onClick={() => setType("ALL")} />
        {LOGISTICS_TYPES.map((k) => (
          <Chip key={k} label={`${tt(k)} (${count(k)})`} color={type === k ? "primary" : "default"} variant={type === k ? "filled" : "outlined"} onClick={() => setType(k)} />
        ))}
      </Stack>
      <ClientsTable
        rows={rows}
        columns={columns}
        rowKey={(l) => l.code}
        onOpen={(l) => setOpen(l)}
        loading={q.isLoading}
        csvName="logistics"
        lang={lang}
        initialSort={{ id: "ships", dir: "desc" }}
        dataTour="logistics-table"
        menu={(l) => [{ label: t("openEdit"), onClick: () => setOpen(l) }]}
        actions={canEdit ? <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setOpen("new")} data-tour="logistics-add">{t("add")}</Button> : null}
      />
      {!!q.data?.unmatched.length && (
        <Alert severity="info" sx={{ mt: 2 }}>
          <b>{t("unmatched")}:</b> {q.data.unmatched.map((u) => `${u.ref} ${u.blNumber ?? ""}${u.shippingLine ? ` (${u.shippingLine})` : ""}`).join(" · ")}
        </Alert>
      )}
      <PartnerDrawer partner={open} onClose={() => setOpen(null)} canEdit={canEdit} />
    </Box>
  );
}

type Form = Partial<Omit<ShippingLine, "emailDomains">> & { emailDomains?: string };

function PartnerDrawer({ partner, onClose, canEdit }: { partner: ShippingLine | "new" | null; onClose: () => void; canEdit: boolean }) {
  const t = useTranslations("clients.logistics");
  const tt = useTranslations("clients.logistics.types");
  const tc = useTranslations("common");
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const isNew = partner === "new";
  const cur = partner && partner !== "new" ? partner : null;
  const [f, setF] = useState<Form>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (partner) {
      setF(
        cur
          ? { name: cur.name, nameJa: cur.nameJa ?? "", types: cur.types ?? ["SHIPPING_LINE"], website: cur.website ?? "", phone: cur.phone ?? "", address: cur.address ?? "", emailDomains: (cur.emailDomains ?? []).join(", "), trackingUrl: cur.trackingUrl ?? "", agents: cur.agents, freeTime: cur.freeTime ?? {}, notes: cur.notes ?? "" }
          : { name: "", types: [], agents: [], freeTime: {} },
      );
      setErr(null);
    }
  }, [partner]); // eslint-disable-line react-hooks/exhaustive-deps
  const agents = f.agents ?? [];
  const types = f.types ?? [];
  const isLine = types.includes("SHIPPING_LINE");
  const setAgent = (i: number, k: string, v: string) => setF((x) => ({ ...x, agents: agents.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }));
  const toggleType = (k: LogisticsType) => setF((x) => ({ ...x, types: (x.types ?? []).includes(k) ? (x.types ?? []).filter((y) => y !== k) : [...(x.types ?? []), k] }));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { ...f, emailDomains: (f.emailDomains ?? "").split(/[\s,]+/).filter(Boolean), agents: agents.filter((a) => a.name?.trim()) };
      if (!isLine) {
        delete body.trackingUrl;
        delete body.freeTime;
      }
      if (isNew) await api.addShippingLine(body as any);
      else await api.updateShippingLine(cur!.code, body as any);
      await qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
      toast.success(tc("saved"));
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const tf = (label: string, value: any, onChange: (v: string) => void, extra: any = {}) => <TextField size="small" fullWidth label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={!canEdit} {...extra} />;
  const recent = useMemo(() => cur?.recent ?? [], [cur]);
  return (
    <Drawer anchor="right" open={!!partner} onClose={() => !busy && onClose()} slotProps={{ paper: { sx: { width: { xs: "100vw", sm: 600 }, p: 2 } } }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>{isNew ? t("add") : cur?.name}</Typography>
        <IconButton onClick={onClose} aria-label={tc("close")} disabled={busy}><CloseIcon /></IconButton>
      </Stack>
      <Box sx={{ overflowY: "auto", flex: 1 }} data-tour="logistics-drawer">
        <Grid2 container spacing={1.25}>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("name"), f.name, (v) => setF((x) => ({ ...x, name: v })), { required: true })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("nameJa"), f.nameJa, (v) => setF((x) => ({ ...x, nameJa: v })))}</Grid2>
        </Grid2>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 2 }}>{t("type")}</Typography>
        <Typography variant="caption" color="text.secondary">{t("typeHint")}</Typography>
        <FormGroup row data-tour="logistics-types">
          {LOGISTICS_TYPES.map((k) => (
            <FormControlLabel key={k} control={<Checkbox size="small" checked={types.includes(k)} onChange={() => toggleType(k)} disabled={!canEdit || (k === "SHIPPING_LINE" && !!cur?.known)} />} label={tt(k)} />
          ))}
        </FormGroup>
        <Grid2 container spacing={1.25} sx={{ mt: 0.5 }}>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("website"), f.website, (v) => setF((x) => ({ ...x, website: v })), { placeholder: "https://" })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(tc("phone"), f.phone, (v) => setF((x) => ({ ...x, phone: v })))}</Grid2>
          <Grid2 size={12}>{tf(tc("address"), f.address, (v) => setF((x) => ({ ...x, address: v })), { multiline: true, minRows: 1 })}</Grid2>
          <Grid2 size={12}>{tf(t("emailDomains"), f.emailDomains, (v) => setF((x) => ({ ...x, emailDomains: v })), { placeholder: "mitsui-soko.co.jp", helperText: t("emailDomainsHint") })}</Grid2>
          {isLine && <Grid2 size={12}>{tf(t("tracking"), f.trackingUrl, (v) => setF((x) => ({ ...x, trackingUrl: v })), { placeholder: "https://" })}</Grid2>}
        </Grid2>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>{t("contacts")}</Typography>
          {canEdit && <Button size="small" startIcon={<AddIcon />} onClick={() => setF((x) => ({ ...x, agents: [...agents, { name: "" }] }))}>{t("addContact")}</Button>}
        </Stack>
        {agents.map((a, i) => (
          <Grid2 container spacing={1} key={i} sx={{ mb: 1 }}>
            <Grid2 size={{ xs: 12, sm: 4 }}>{tf(t("office"), a.company, (v) => setAgent(i, "company", v), { placeholder: t("officeHint") })}</Grid2>
            <Grid2 size={{ xs: 6, sm: 4 }}>{tf(tc("name"), a.name, (v) => setAgent(i, "name", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 4 }}>{tf(tc("role"), a.role, (v) => setAgent(i, "role", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 6 }}>{tf(tc("email"), a.email, (v) => setAgent(i, "email", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 6 }}>{tf(tc("phone"), a.phone, (v) => setAgent(i, "phone", v))}</Grid2>
          </Grid2>
        ))}
        {isLine && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t("free")}</Typography>
            <Grid2 container spacing={1.25}>
              <Grid2 size={{ xs: 6, sm: 3 }}>{tf(t("det"), f.freeTime?.detDays, (v) => setF((x) => ({ ...x, freeTime: { ...(x.freeTime ?? {}), detDays: v === "" ? undefined : (v as any) } })), { type: "number" })}</Grid2>
              <Grid2 size={{ xs: 6, sm: 3 }}>{tf(t("dem"), f.freeTime?.demDays, (v) => setF((x) => ({ ...x, freeTime: { ...(x.freeTime ?? {}), demDays: v === "" ? undefined : (v as any) } })), { type: "number" })}</Grid2>
              <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t("ftNote"), f.freeTime?.note, (v) => setF((x) => ({ ...x, freeTime: { ...(x.freeTime ?? {}), note: v } })), { placeholder: t("ftNoteHint") })}</Grid2>
            </Grid2>
          </>
        )}
        <Divider sx={{ my: 2 }} />
        {tf(tc("notes"), f.notes, (v) => setF((x) => ({ ...x, notes: v })), { multiline: true, minRows: 3 })}
        {cur && isLine && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t("recent", { n: cur.shipments })}</Typography>
            {recent.length ? recent.map((s) => (
              <Typography key={s.id} variant="body2" sx={{ mb: 0.25 }}>
                {s.orderId ? <Link href={`/portal/shipments/orders/${s.orderId}?shipment=${s.id}`}>{s.ref}</Link> : s.ref} · {s.blNumber ?? "—"} · {s.customer ?? "—"} · ETA {s.eta ? fmtDay(s.eta) : "—"}{s.status !== "OPEN" ? ` · ${s.status.toLowerCase()}` : ""}
              </Typography>
            )) : <Typography variant="body2" color="text.secondary">—</Typography>}
          </>
        )}
        {cur && !!cur.emailDomains?.length && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{t("emailsFrom", { n: cur.emails ?? 0, domains: cur.emailDomains.join(", ") })}</Typography>
        )}
        {err && <Typography color="error" variant="body2" sx={{ mt: 1.5 }}>{err}</Typography>}
      </Box>
      {canEdit && (
        <Stack direction="row" spacing={1} sx={{ pt: 1.5 }}>
          <Button variant="contained" onClick={save} disabled={busy || !f.name?.trim() || !types.length} data-tour="logistics-save">{tc("save")}</Button>
          <Button onClick={onClose} disabled={busy}>{tc("cancel")}</Button>
        </Stack>
      )}
    </Drawer>
  );
}
