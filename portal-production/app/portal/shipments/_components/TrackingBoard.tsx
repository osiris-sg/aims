/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BX (Sayaka, ETA tracking): Sales › Shipments › Tracking — every open shipment arriving in the next ~21 days
// (and late ones with no arrival date yet), one row each, sorted by ETA: #n-s, customer, vessel / voyage, carrier,
// the latest ETA (typed in place, history under it), T/S, and Track / Paste tracking. A row whose ETA moved later
// than first known is orange. A row click opens the shipment's tracking card (Details tab).

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Chip, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import LaunchIcon from "@mui/icons-material/Launch";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import { useTranslations } from "next-intl";
import PageTable from "@/components/PageTable";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import type { TrackingRow } from "../_lib/api";
import { useShipmentTracking, useTradeMutation } from "../_lib/hooks";
import { fmtDay, shortCustomer } from "../_lib/format";
import { toast } from "../_lib/toast";
import { EmptyState } from "./bits";
import TrackingPasteDialog from "./TrackingPasteDialog";
import { useTrackCarrier } from "./useTrackCarrier";

export const trackingHref = (r: { id: string; orderId: string | null }) => (r.orderId ? `/portal/shipments/orders/${r.orderId}?shipment=${r.id}&tab=details` : `/portal/shipments/${r.id}`);

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** The ETA, typed in place: saved when it changes (kept in the ETA history as MANUAL). */
function EtaCell({ row, canEdit }: { row: TrackingRow; canEdit: boolean }) {
  const t = useTranslations("orders.shipmentsList.tracking");
  const [v, setV] = useState(row.eta ?? "");
  useEffect(() => setV(row.eta ?? ""), [row.eta]);
  const save = useTradeMutation((a, eta: string) => a.updateShipment(row.id, { eta, etaSource: "MANUAL" }));
  const commit = async () => {
    if (!v || v === row.eta) return;
    try {
      await save.mutateAsync(v);
      toast.success(t("saved", { ref: row.ref, eta: fmtDay(v) }));
    } catch (e: any) {
      setV(row.eta ?? "");
      toast.error(e?.message || t("saveError"));
    }
  };
  const history = row.etaHistory.length ? (
    <Box>
      {row.etaHistory.map((h, i) => (
        <div key={i}>{t("historyLine", { date: fmtDay(h.at), eta: h.eta ? fmtDay(h.eta) : "—", by: h.by ?? "—", source: h.source })}</div>
      ))}
    </Box>
  ) : null;
  return (
    <Stack spacing={0.25} onClick={stop} sx={{ minWidth: 160, position: "relative", zIndex: 1 }}>
      <Stack direction="row" spacing={0.75} alignItems="center">
        {canEdit ? (
          <TextField
            type="date"
            size="small"
            value={v}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            disabled={save.isPending}
            inputProps={{ "aria-label": t("editEta", { ref: row.ref }), "data-tour": "tracking-eta-input" }}
            sx={{ width: 160, "& input": { py: 0.5 } }}
          />
        ) : (
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {fmtDay(row.eta)}
          </Typography>
        )}
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Typography variant="caption" color={row.daysToEta != null && row.daysToEta < 0 ? "error.main" : "text.secondary"} sx={{ whiteSpace: "nowrap" }}>
          {row.daysToEta == null ? null : row.daysToEta < 0 ? t("late", { n: -row.daysToEta }) : row.daysToEta === 0 ? t("today") : t("inDays", { n: row.daysToEta })}
        </Typography>
        {row.delayed && (
          <Tooltip title={t("delayedTip", { first: fmtDay(row.firstEta), now: fmtDay(row.eta) })}>
            <Chip size="small" color="warning" label={t("delayed", { n: row.delayDays })} data-tour="tracking-delayed" sx={{ height: 20, fontSize: 11 }} />
          </Tooltip>
        )}
      </Stack>
      {row.etaTrail && (
        <Tooltip title={history ?? ""}>
          <Typography variant="caption" color="text.secondary" sx={{ cursor: "help" }} data-tour="tracking-eta-history">
            {t("history", { trail: row.etaTrail })}
          </Typography>
        </Tooltip>
      )}
    </Stack>
  );
}

export default function TrackingBoard({ header, canEdit: canEditOverride }: { header?: React.ReactNode; canEdit?: boolean }) {
  const t = useTranslations("orders.shipmentsList");
  const tt = useTranslations("orders.shipmentsList.tracking");
  const tp = useTranslations("shipments.portStoragePanel");
  const router = useRouter();
  const { hasPermission } = useUserPermissions();
  const canEdit = canEditOverride ?? hasPermission("shipments", "update");
  const q = useShipmentTracking();
  const track = useTrackCarrier();
  const [paste, setPaste] = useState<TrackingRow | null>(null);
  const [search, setSearch] = useState("");
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((r) => [r.ref, r.customerName, r.blNumber, r.vessel, r.voyageNo, r.carrier?.name, r.shippingLine, r.tsPort].some((x) => (x ?? "").toLowerCase().includes(s)));
  }, [items, search]);

  const columns = useMemo(
    () => [
      { id: "ref", header: "#", nowrap: true, cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 800 }}>{row.original.ref || "—"}</Typography> },
      { id: "customer", header: t("customer"), cell: ({ row }: any) => <span title={row.original.customerName ?? undefined}>{shortCustomer(row.original.customerName) || "—"}</span> },
      {
        id: "vessel",
        header: t("vessel"),
        cell: ({ row }: any) => {
          const r: TrackingRow = row.original;
          return (
            <Box>
              <div>{[r.vessel, r.voyageNo].filter(Boolean).join(" / ") || "—"}</div>
              {r.arrivingVessel && (
                <Typography variant="caption" color="text.secondary">
                  {tt("arriving", { vessel: [r.arrivingVessel, r.arrivingVoyageNo].filter(Boolean).join(" / ") })}
                </Typography>
              )}
            </Box>
          );
        },
      },
      {
        id: "carrier",
        header: t("carrier"),
        cell: ({ row }: any) => {
          const r: TrackingRow = row.original;
          return (
            <Box>
              <div>{r.carrier?.name ?? r.shippingLine ?? "—"}</div>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {r.blNumber ? `B/L ${r.blNumber}` : tt("noBl")}
              </Typography>
            </Box>
          );
        },
      },
      { id: "eta", header: tt("eta"), cell: ({ row }: any) => <EtaCell row={row.original} canEdit={canEdit} /> },
      {
        id: "ts",
        header: tt("ts"),
        cell: ({ row }: any) => {
          const r: TrackingRow = row.original;
          if (!r.tsPort) return "—";
          return (
            <Box>
              <div>{r.tsPort}</div>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {[r.tsEta ? tp("arr", { date: fmtDay(r.tsEta) }).trim() : null, r.tsEtd ? tp("dep", { date: fmtDay(r.tsEtd) }).trim() : null].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
          );
        },
      },
      {
        id: "actions",
        header: tt("actions"),
        cell: ({ row }: any) => {
          const r: TrackingRow = row.original;
          return (
            <Stack direction="row" spacing={0.75} onClick={stop} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
              {r.carrier ? (
                <Tooltip title={tp("track", { carrier: r.carrier.name })}>
                  <Button size="small" variant="outlined" startIcon={<LaunchIcon />} onClick={() => void track(r.carrier, r.blNumber)} data-tour="tracking-track" sx={{ whiteSpace: "nowrap" }}>
                    {tt("track")}
                  </Button>
                </Tooltip>
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                  {tt("noCarrier")}
                </Typography>
              )}
              {canEdit && (
                <Button size="small" variant="outlined" startIcon={<ContentPasteIcon />} onClick={() => setPaste(r)} data-tour="tracking-paste" sx={{ whiteSpace: "nowrap" }}>
                  {tp("paste")}
                </Button>
              )}
            </Stack>
          );
        },
      },
    ],
    [t, tt, tp, canEdit, track],
  );

  return (
    <>
      <PageTable
        tableName={t("title")}
        columns={columns}
        data={shown}
        loading={q.isLoading}
        search={search}
        setSearch={setSearch}
        noPagination
        noSelectionColumn
        onRowClick={(r: TrackingRow) => router.push(trackingHref(r))}
        rowHref={(r: TrackingRow) => trackingHref(r)}
        rowSx={(r: TrackingRow) => (r.delayed ? { bgcolor: (th: any) => alpha(th.palette.warning.main, th.palette.mode === "dark" ? 0.16 : 0.1) } : {})}
        hideTable={!q.isLoading && !q.isError && !shown.length}
        headerContent={
          <>
            {header}
            {q.isError ? (
              <Alert severity="error">{(q.error as Error)?.message || t("loadError")}</Alert>
            ) : !q.isLoading && !shown.length ? (
              <EmptyState title={search ? t("emptySearch") : t("empty.tracking")} />
            ) : null}
          </>
        }
      />
      {paste && <TrackingPasteDialog shipmentId={paste.id} blNumber={paste.blNumber} open onClose={() => setPaste(null)} />}
    </>
  );
}
