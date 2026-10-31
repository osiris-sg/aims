/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY part 3 — Clients › Shipping lines: the lines on ADH's shipments (Wan Hai, Maersk, SITC, KMTC, RCL, MSC,
// Evergreen — matched by the B/L prefix or the shipment's shipping line — plus lines added here). Per line: website /
// tracking link, local agents (e.g. Wan Hai Japan), free time at the port, notes, the shipments using it and the
// customers / suppliers that list it. "+ Add shipping line" and the row open the same drawer.

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Box, Button, Chip, Divider, Drawer, Grid2, IconButton, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type ShippingLine } from "../../_lib/api";
import { CLIENT_KEYS, useShippingLines } from "../../_lib/hooks";
import { fmtDay } from "../../_lib/format";
import { toast } from "../../_lib/toast";
import { ClientsHeader, useLang } from "../_components/ClientsBits";
import ClientsTable, { type ClientsColumn } from "../_components/ClientsTable";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

const L = {
  en: { line: "Shipping line", web: "Website / tracking", agents: "Local agents", free: "Free time", ships: "Shipments", open: "open", lastEta: "Last ETA", clients: "Used by", add: "Add shipping line", edit: "Shipping line", name: "Name", website: "Website", tracking: "Tracking page", agent: "Agent", company: "Company", role: "Role", email: "E-mail", phone: "Phone", addAgent: "Add agent", det: "DET free days", dem: "DEM free days", ftNote: "Free-time terms", notes: "Notes", save: "Save", cancel: "Cancel", saved: "Saved", recent: "Shipments on this line", unmatched: "Shipments whose line AIMS can't tell (B/L prefix unknown)", known: "known by its B/L" },
  ja: { line: "船会社", web: "ウェブ・追跡", agents: "代理店", free: "フリータイム", ships: "出荷", open: "未完了", lastEta: "最新ETA", clients: "利用取引先", add: "船会社を追加", edit: "船会社", name: "名称", website: "ウェブサイト", tracking: "追跡ページ", agent: "代理店", company: "会社", role: "役職", email: "メール", phone: "電話", addAgent: "代理店を追加", det: "DETフリー日数", dem: "DEMフリー日数", ftNote: "フリータイム条件", notes: "備考", save: "保存", cancel: "キャンセル", saved: "保存しました", recent: "この船会社の出荷", unmatched: "船会社が判別できない出荷（B/L接頭辞不明）", known: "B/Lで判別" },
};

export default function ShippingLinesPage() {
  const lang = useLang();
  const t = L[lang];
  const q = useShippingLines();
  const { hasPermission, userRoles } = useUserPermissions();
  const canEdit = hasPermission("shipments", "update") || userRoles.length === 0;
  const [open, setOpen] = useState<ShippingLine | "new" | null>(null);
  const columns: ClientsColumn<ShippingLine>[] = [
    { id: "name", label: t.line, minWidth: 180, value: (l) => l.name, render: (l) => (<Box><Typography variant="body2" sx={{ fontWeight: 800 }}>{l.name}</Typography>{l.known && <Typography variant="caption" color="text.secondary">{t.known}</Typography>}</Box>) },
    { id: "web", label: t.web, value: (l) => l.website ?? l.trackingUrl ?? "", render: (l) => (<Stack spacing={0.25}>{l.website && <a href={l.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{l.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>}{l.trackingUrl && <a href={l.trackingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 12 }}>{lang === "ja" ? "追跡" : "Tracking"} <OpenInNewIcon sx={{ fontSize: 12, verticalAlign: "middle" }} /></a>}{!l.website && !l.trackingUrl && "—"}</Stack>) },
    { id: "agents", label: t.agents, value: (l) => l.agents.map((a) => `${a.company ?? ""} ${a.name}`).join(", "), render: (l) => (l.agents.length ? l.agents.map((a, i) => <Typography key={i} variant="body2">{[a.company, a.name].filter(Boolean).join(" · ")}</Typography>) : "—") },
    { id: "free", label: t.free, value: (l) => (l.freeTime ? `DET ${l.freeTime.detDays ?? "—"} DEM ${l.freeTime.demDays ?? "—"}` : ""), render: (l) => (l.freeTime ? `DET ${l.freeTime.detDays ?? "—"} · DEM ${l.freeTime.demDays ?? "—"}` : "—") },
    { id: "ships", label: t.ships, align: "right", value: (l) => l.shipments, render: (l) => `${l.shipments}${l.openShipments ? ` (${l.openShipments} ${t.open})` : ""}` },
    { id: "eta", label: t.lastEta, value: (l) => l.lastEta?.slice(0, 10) ?? null, render: (l) => (l.lastEta ? fmtDay(l.lastEta) : "—") },
    { id: "clients", label: t.clients, value: (l) => l.clients.map((c) => c.name).join(", "), render: (l) => (l.clients.length ? <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{l.clients.map((c) => <Chip key={`${c.kind}${c.id}`} size="small" variant="outlined" label={c.name} />)}</Stack> : "—") },
  ];
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }} data-tour="clients-shipping-lines">
      <ClientsHeader active="shipping-lines" />
      {q.isError && <Alert severity="error">{(q.error as Error)?.message || "Could not load the shipping lines"}</Alert>}
      <ClientsTable
        rows={q.data?.lines ?? []}
        columns={columns}
        rowKey={(l) => l.code}
        onOpen={(l) => setOpen(l)}
        loading={q.isLoading}
        csvName="shipping-lines"
        lang={lang}
        initialSort={{ id: "ships", dir: "desc" }}
        dataTour="shipping-lines-table"
        menu={(l) => [{ label: lang === "ja" ? "開く・編集" : "Open / edit", onClick: () => setOpen(l) }]}
        actions={canEdit ? <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setOpen("new")} data-tour="shipping-lines-add">{t.add}</Button> : null}
      />
      {!!q.data?.unmatched.length && (
        <Alert severity="info" sx={{ mt: 2 }}>
          <b>{t.unmatched}:</b> {q.data.unmatched.map((u) => `${u.ref} ${u.blNumber ?? ""}${u.shippingLine ? ` (${u.shippingLine})` : ""}`).join(" · ")}
        </Alert>
      )}
      <LineDrawer line={open} onClose={() => setOpen(null)} canEdit={canEdit} lang={lang} />
    </Box>
  );
}

function LineDrawer({ line, onClose, canEdit, lang }: { line: ShippingLine | "new" | null; onClose: () => void; canEdit: boolean; lang: "en" | "ja" }) {
  const t = L[lang];
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const isNew = line === "new";
  const cur = line && line !== "new" ? line : null;
  const [f, setF] = useState<Partial<ShippingLine>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (line) {
      setF(cur ? { name: cur.name, website: cur.website ?? "", trackingUrl: cur.trackingUrl ?? "", agents: cur.agents, freeTime: cur.freeTime ?? {}, notes: cur.notes ?? "" } : { name: "", agents: [], freeTime: {} });
      setErr(null);
    }
  }, [line]); // eslint-disable-line react-hooks/exhaustive-deps
  const agents = f.agents ?? [];
  const setAgent = (i: number, k: string, v: string) => setF((x) => ({ ...x, agents: agents.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }));
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { ...f, agents: agents.filter((a) => a.name?.trim()) };
      if (isNew) await api.addShippingLine(body);
      else await api.updateShippingLine(cur!.code, body);
      await qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
      toast.success(t.saved);
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
    <Drawer anchor="right" open={!!line} onClose={() => !busy && onClose()} slotProps={{ paper: { sx: { width: { xs: "100vw", sm: 560 }, p: 2 } } }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>{isNew ? t.add : `${t.edit} · ${cur?.name}`}</Typography>
        <IconButton onClick={onClose} aria-label="Close" disabled={busy}><CloseIcon /></IconButton>
      </Stack>
      <Box sx={{ overflowY: "auto", flex: 1 }} data-tour="shipping-line-drawer">
        <Grid2 container spacing={1.25}>
          <Grid2 size={12}>{tf(t.name, f.name, (v) => setF((x) => ({ ...x, name: v })), { required: true })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t.website, f.website, (v) => setF((x) => ({ ...x, website: v })), { placeholder: "https://" })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t.tracking, f.trackingUrl, (v) => setF((x) => ({ ...x, trackingUrl: v })), { placeholder: "https://" })}</Grid2>
        </Grid2>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>{t.agents}</Typography>
          {canEdit && <Button size="small" startIcon={<AddIcon />} onClick={() => setF((x) => ({ ...x, agents: [...agents, { name: "" }] }))}>{t.addAgent}</Button>}
        </Stack>
        {agents.map((a, i) => (
          <Grid2 container spacing={1} key={i} sx={{ mb: 1 }}>
            <Grid2 size={{ xs: 12, sm: 4 }}>{tf(t.company, a.company, (v) => setAgent(i, "company", v), { placeholder: "Wan Hai Lines (Japan)" })}</Grid2>
            <Grid2 size={{ xs: 6, sm: 4 }}>{tf(t.agent, a.name, (v) => setAgent(i, "name", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 4 }}>{tf(t.role, a.role, (v) => setAgent(i, "role", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 6 }}>{tf(t.email, a.email, (v) => setAgent(i, "email", v))}</Grid2>
            <Grid2 size={{ xs: 6, sm: 6 }}>{tf(t.phone, a.phone, (v) => setAgent(i, "phone", v))}</Grid2>
          </Grid2>
        ))}
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t.free}</Typography>
        <Grid2 container spacing={1.25}>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf(t.det, f.freeTime?.detDays, (v) => setF((x) => ({ ...x, freeTime: { ...(x.freeTime ?? {}), detDays: v === "" ? undefined : (v as any) } })), { type: "number" })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf(t.dem, f.freeTime?.demDays, (v) => setF((x) => ({ ...x, freeTime: { ...(x.freeTime ?? {}), demDays: v === "" ? undefined : (v as any) } })), { type: "number" })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf(t.ftNote, f.freeTime?.note, (v) => setF((x) => ({ ...x, freeTime: { ...(x.freeTime ?? {}), note: v } })), { placeholder: lang === "ja" ? "例: 揚地 暦日" : "e.g. calendar days at discharge" })}</Grid2>
        </Grid2>
        <Divider sx={{ my: 2 }} />
        {tf(t.notes, f.notes, (v) => setF((x) => ({ ...x, notes: v })), { multiline: true, minRows: 3 })}
        {cur && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>{t.recent} ({cur.shipments})</Typography>
            {recent.length ? recent.map((s) => (
              <Typography key={s.id} variant="body2" sx={{ mb: 0.25 }}>
                {s.orderId ? <Link href={`/portal/shipments/orders/${s.orderId}?shipment=${s.id}`}>{s.ref}</Link> : s.ref} · {s.blNumber ?? "—"} · {s.customer ?? "—"} · ETA {s.eta ? fmtDay(s.eta) : "—"}{s.status !== "OPEN" ? ` · ${s.status.toLowerCase()}` : ""}
              </Typography>
            )) : <Typography variant="body2" color="text.secondary">—</Typography>}
          </>
        )}
        {err && <Typography color="error" variant="body2" sx={{ mt: 1.5 }}>{err}</Typography>}
      </Box>
      {canEdit && (
        <Stack direction="row" spacing={1} sx={{ pt: 1.5 }}>
          <Button variant="contained" onClick={save} disabled={busy || !f.name?.trim()} data-tour="shipping-line-save">{t.save}</Button>
          <Button onClick={onClose} disabled={busy}>{t.cancel}</Button>
        </Stack>
      )}
    </Drawer>
  );
}
