"use client";

// Shipment detail: header (B/L, contract, customer, status + actions) and
// Overview / Steps / Files tabs. The tab lives in ?tab= so links can target it.

import React from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, CircularProgress, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useGeneratedDocs, useShipment, useTradeMutation } from "../_lib/hooks";
import { blLabel } from "../_lib/format";
import RecordHeader from "../_components/RecordHeader";
import ShipmentOverview from "../_components/ShipmentOverview";
import StepChecklist from "../_components/StepChecklist";
import FilesTable from "../_components/FilesTable";
import { recordFileCount } from "../_lib/api";
import LinkedDocuments from "../_components/LinkedDocuments";

const TABS = ["overview", "steps", "files"] as const;

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = Math.max(0, TABS.indexOf((params?.get("tab") ?? "overview") as (typeof TABS)[number]));
  const q = useShipment(id);
  const generated = useGeneratedDocs(id);
  const complete = useTradeMutation((api, sid: string) => api.completeShipment(sid));
  const reopen = useTradeMutation((api, sid: string) => api.reopenShipment(sid));
  const cancel = useTradeMutation((api, sid: string) => api.updateShipment(sid, { status: "CANCELLED" }));

  if (q.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{(q.error as Error)?.message || "Shipment not found"}</Alert>
      </Box>
    );
  }

  const s = q.data;
  const title = blLabel(s.blNumber);
  const owner = { kind: "shipment" as const, id: s.id, label: `Shipment ${title}` };
  const fileCount = recordFileCount(s);
  const here = `/portal/shipments/${s.id}`;

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <RecordHeader
        kind="shipment"
        title={title}
        status={s.status}
        backHref="/portal/shipments"
        progress={s.progress}
        currentStep={s.currentStep}
        steps={s.steps}
        onComplete={() => complete.mutateAsync(s.id)}
        onCancel={() => cancel.mutateAsync(s.id)}
        onReopen={() => reopen.mutateAsync(s.id)}
        subtitle={
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Typography variant="body2" color="text.secondary">
              Contract{" "}
              {s.contract ? (
                <Link href={`/portal/shipments/contracts/${s.contract.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                  {s.contract.contractNo}
                </Link>
              ) : (
                "—"
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Customer <b>{s.customer?.name ?? "—"}</b>
            </Typography>
            {s.productLine && (
              <Typography variant="body2" color="text.secondary">
                Product <b>{s.productLine}</b>
              </Typography>
            )}
            {s.vessel && (
              <Typography variant="body2" color="text.secondary">
                Vessel <b>{[s.vessel, s.voyageNo].filter(Boolean).join(" / ")}</b>
              </Typography>
            )}
          </Stack>
        }
      />

      <Tabs value={tab} onChange={(_, v) => router.replace(`${pathname}?tab=${TABS[v]}`)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} variant="scrollable" allowScrollButtonsMobile>
        <Tab label="Overview" />
        <Tab label={`Steps (${s.progress.done}/${s.progress.total})`} />
        <Tab label={`Files${fileCount ? ` (${fileCount})` : ""}`} />
      </Tabs>

      {tab === 0 && <ShipmentOverview shipment={s} />}
      {tab === 1 && (
        <StepChecklist
          steps={s.steps}
          fileLinks={s.fileLinks}
          docLinks={s.docLinks ?? []}
          generatedDocs={generated.data ?? []}
          blCheck={s.blCheck}
          owner={owner}
          recordOpen={s.status === "OPEN"}
          returnTo={`${here}?tab=steps`}
        />
      )}
      {tab === 2 && (
        <>
          <LinkedDocuments links={s.docLinks ?? []} returnTo={`${here}?tab=files`} canEdit={s.status === "OPEN"} />
          <FilesTable filter={{ shipmentId: s.id }} currentId={s.id} uploadTargets={[owner]} canUpload={s.status === "OPEN"} />
        </>
      )}
    </Box>
  );
}
