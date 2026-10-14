"use client";

// Contract detail: header (contract no., supplier → customer, status + actions)
// and Overview / Steps / Shipments / Files tabs (?tab= keeps the tab in the URL).

import React from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, CircularProgress, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useContract, useContractGeneratedDocs, useTradeMutation } from "../../_lib/hooks";
import RecordHeader from "../../_components/RecordHeader";
import ContractOverview from "../../_components/ContractOverview";
import ContractShipments from "../../_components/ContractShipments";
import StepChecklist from "../../_components/StepChecklist";
import FilesTable from "../../_components/FilesTable";
import { recordFileCount } from "../../_lib/api";
import LinkedDocuments from "../../_components/LinkedDocuments";

const TABS = ["overview", "steps", "shipments", "files"] as const;

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = Math.max(0, TABS.indexOf((params?.get("tab") ?? "overview") as (typeof TABS)[number]));
  const q = useContract(id);
  // Invoice #1 (ADH 請求書) is made in-app on the contract.
  const generated = useContractGeneratedDocs(id);
  const complete = useTradeMutation((api, cid: string) => api.completeContract(cid));
  const reopen = useTradeMutation((api, cid: string) => api.reopenContract(cid));
  const cancel = useTradeMutation((api, cid: string) => api.updateContract(cid, { status: "CANCELLED" }));

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
        <Alert severity="error">{(q.error as Error)?.message || "Contract not found"}</Alert>
      </Box>
    );
  }

  const c = q.data;
  const owner = { kind: "contract" as const, id: c.id, label: `Contract ${c.contractNo}` };
  const here = `/portal/shipments/contracts/${c.id}`;
  const fileCount = recordFileCount(c);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <RecordHeader
        kind="contract"
        title={c.contractNo}
        status={c.status}
        backHref="/portal/shipments/contracts"
        progress={c.progress}
        currentStep={c.currentStep}
        steps={c.steps}
        onComplete={() => complete.mutateAsync(c.id)}
        onCancel={() => cancel.mutateAsync(c.id)}
        onReopen={() => reopen.mutateAsync(c.id)}
        subtitle={
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            {c.piNumber && (
              <Typography variant="body2" color="text.secondary">
                PI <b>{c.piNumber}</b>
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              Supplier <b>{c.supplier?.name ?? "—"}</b>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Customer <b>{c.customer?.name ?? "—"}</b>
            </Typography>
            {c.linesSummary && (
              <Typography variant="body2" color="text.secondary">
                Products <b>{c.linesSummary}</b>
              </Typography>
            )}
          </Stack>
        }
      />

      <Tabs value={tab} onChange={(_, v) => router.replace(`${pathname}?tab=${TABS[v]}`)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} variant="scrollable" allowScrollButtonsMobile>
        <Tab label="Overview" />
        <Tab label={`Steps (${c.progress.done}/${c.progress.total})`} />
        <Tab label={`Shipments (${c.shipments.length})`} />
        <Tab label={`Files${fileCount ? ` (${fileCount})` : ""}`} />
      </Tabs>

      {tab === 0 && <ContractOverview contract={c} />}
      {tab === 1 && (
        <StepChecklist
          steps={c.steps}
          fileLinks={c.fileLinks}
          docLinks={c.docLinks ?? []}
          owner={owner}
          recordOpen={c.status === "OPEN"}
          returnTo={`${here}?tab=steps`}
          generatedDocs={generated.data ?? []}
        />
      )}
      {tab === 2 && <ContractShipments contract={c} />}
      {tab === 3 && (
        <>
          <LinkedDocuments links={c.docLinks ?? []} returnTo={`${here}?tab=files`} canEdit={c.status === "OPEN"} />
          <FilesTable filter={{ contractId: c.id }} currentId={c.id} uploadTargets={[owner]} canUpload={c.status === "OPEN"} />
        </>
      )}
    </Box>
  );
}
