"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import {
  COMPLETED_REPORTS_WINDOW_DAYS,
  ReportSummary,
  fetchRecentCompletedReports,
  reportMatchesSearch,
} from "../../lib/maintenanceReports";
import { FieldHomeHeader } from "../../components/FieldHomeHeader";
import { PendingSignList } from "../../components/PendingSignList";
import { CompletedReportList } from "../../components/CompletedReportList";
import { FIELD_BOTTOM_NAV_OFFSET, FieldBottomNav, FieldBottomNavSpacer } from "../../components/FieldBottomNav";

/**
 * Maintenance home: the field app's second home tab.
 *
 *   Pending    reports awaiting a signature, org-wide. Exactly Pending Sign
 *              (/scan/reports/ongoing): same fetch, customer grouping, focus
 *              re-read, tap to sign, tick-to-batch-sign. Shared component.
 *   Completed  signed reports CREATED in the last 30 days (see
 *              fetchRecentCompletedReports for the createdAt caveat).
 *
 * "+" opens /scan/new: a report is always about one unit, so it starts from a
 * scan, then the asset page's Maintenance Service Report action. There is no
 * separate creation route.
 *
 * The selected tab lives in the query string (?tab=…), switched with replace,
 * so Back from a report lands on the same tab.
 */

type MaintenanceTab = "pending" | "completed";
const TABS: { value: MaintenanceTab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
];
const isTab = (v: string | null): v is MaintenanceTab => TABS.some((t) => t.value === v);

export default function MaintenanceHomePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { getToken } = useAuth();
  const rawTab = params?.get("tab") ?? null;
  const tab: MaintenanceTab = isTab(rawTab) ? rawTab : "pending";
  const [q, setQ] = useState("");
  const [completed, setCompleted] = useState<ReportSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Completed is (re)loaded each time its tab is shown. Pending loads itself
  // (and re-reads on window focus) inside PendingSignList.
  useEffect(() => {
    if (tab !== "completed") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const rows = await fetchRecentCompletedReports(token);
        if (!cancelled) setCompleted(rows);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not load completed reports");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, getToken]);

  const selectTab = (next: MaintenanceTab) => {
    if (next === tab) return;
    router.replace(next === "pending" ? "/scan/maintenance" : `/scan/maintenance?tab=${next}`, { scroll: false });
  };

  const shownCompleted = useMemo(() => (completed ?? []).filter((r) => reportMatchesSearch(r, q)), [completed, q]);

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <FieldHomeHeader
        title="Maintenance"
        search={q}
        onSearch={setQ}
        placeholder="Search report #, customer, model, serial"
        addLabel="Scan a unit"
        onAdd={() => router.push("/scan/new")}
        tabs={TABS}
        tab={tab}
        onTab={selectTab}
      />

      <Box sx={{ flex: 1, p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        {tab === "pending" ? (
          <PendingSignList search={q} barBottom={FIELD_BOTTOM_NAV_OFFSET} />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              Signed reports created in the last {COMPLETED_REPORTS_WINDOW_DAYS} days. Tap one to view or print it.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {completed === null ? (
              loading && (
                <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                  <CircularProgress />
                </Box>
              )
            ) : completed.length === 0 ? (
              <Typography variant="body1" color="text.secondary" sx={{ textAlign: "center", py: 6 }}>
                No reports completed in the last {COMPLETED_REPORTS_WINDOW_DAYS} days.
              </Typography>
            ) : shownCompleted.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                No report matches &quot;{q}&quot;.
              </Typography>
            ) : (
              <CompletedReportList reports={shownCompleted} />
            )}
          </>
        )}
      </Box>

      <FieldBottomNavSpacer />
      <FieldBottomNav value="maintenance" />
    </Box>
  );
}
