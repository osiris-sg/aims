"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import {
  RunSummary,
  fetchCompletedRuns,
  fetchInProgressRuns,
  fetchScheduledRuns,
  resolveInProgressHref,
  runMatchesSearch,
} from "../lib/deliveryLists";
import { CompletedRunCard, InProgressRunCard, ScheduledRunCard } from "../components/DeliveryRunCards";
import { FieldBottomNav, FieldBottomNavSpacer } from "../components/FieldBottomNav";
import { FieldHomeHeader } from "../components/FieldHomeHeader";

/**
 * Deliveries home: the field app's landing screen.
 *
 *   Pending      office-scheduled runs, org-wide (was /scan/deliveries/scheduled)
 *   In progress  the rider's own unfinished runs (was /scan/deliveries)
 *   Completed    the rider's runs completed in the last 7 days
 *                (was /scan/deliveries/finished)
 *
 * Each tab reuses the list page's exact fetch and tap target (lib/
 * deliveryLists + components/DeliveryRunCards), so the two surfaces can't
 * drift. The old list pages stay: resume links and back buttons still target
 * them.
 *
 * The selected tab lives in the query string (?tab=…) so Back from a run lands
 * on the same tab. "+" opens /scan/new, which is where scanning now lives:
 * this page deliberately does NOT listen for NFC.
 */

type DeliveriesTab = "pending" | "progress" | "completed";
const TABS: { value: DeliveriesTab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];
const isTab = (v: string | null): v is DeliveriesTab => TABS.some((t) => t.value === v);

const FETCHERS: Record<DeliveriesTab, (token: string) => Promise<RunSummary[]>> = {
  pending: fetchScheduledRuns,
  progress: fetchInProgressRuns,
  completed: fetchCompletedRuns,
};

const EMPTY_COPY: Record<DeliveriesTab, string> = {
  pending: "Nothing scheduled right now.",
  progress: "Nothing in progress. You're all caught up.",
  completed: "No deliveries completed in the last 7 days.",
};

export default function DeliveriesHomePage() {
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const { features, isLoading } = useOrganizationFeatures();
  const rawTab = search?.get("tab") ?? null;
  const tab: DeliveriesTab = isTab(rawTab) ? rawTab : "pending";
  const [q, setQ] = useState("");
  // Per-tab cache: switching back to a tab shows its last list at once while
  // the refetch runs. undefined = never loaded.
  const [lists, setLists] = useState<Partial<Record<DeliveriesTab, RunSummary[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In-progress row being opened: the list payload omits assetId/inventoryId/
  // reports, so a tap fetches the full run and resolves the exact step.
  const [opening, setOpening] = useState<string | null>(null);

  // (Re)load the active tab every time it is shown, so a run finished or
  // claimed elsewhere doesn't linger.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const runs = await FETCHERS[tab](token);
        if (!cancelled) setLists((prev) => ({ ...prev, [tab]: runs }));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load deliveries");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, getToken]);

  // replace, not push: tabs are a view of one screen, so they shouldn't stack
  // up in history. The URL still carries the tab, which is what Back restores.
  const selectTab = (next: DeliveriesTab) => {
    if (next === tab) return;
    router.replace(next === "pending" ? "/scan" : `/scan?tab=${next}`, { scroll: false });
  };

  const openInProgress = useCallback(
    async (id: string) => {
      setOpening(id);
      try {
        const token = await getToken().catch(() => null);
        router.push(await resolveInProgressHref(id, token));
      } finally {
        setOpening(null);
      }
    },
    [getToken, router],
  );

  const runs = lists[tab];
  const filtered = useMemo(() => (runs ?? []).filter((r) => runMatchesSearch(r, q)), [runs, q]);

  if (isLoading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (features.enableFieldScanApp === false) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          Field scan is not enabled for your organization. Ask an admin to enable it under Admin → Configuration → Feature Flags.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <FieldHomeHeader
        title="Deliveries"
        search={q}
        onSearch={setQ}
        placeholder="Search delivery #, project, customer, address"
        addLabel="Scan a unit"
        onAdd={() => router.push("/scan/new")}
        tabs={TABS}
        tab={tab}
        onTab={selectTab}
      />

      <Box sx={{ flex: 1, p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {error && <Alert severity="error">{error}</Alert>}

        {runs === undefined ? (
          loading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          )
        ) : runs.length === 0 ? (
          <Typography variant="body1" color="text.secondary" sx={{ textAlign: "center", py: 6 }}>
            {EMPTY_COPY[tab]}
          </Typography>
        ) : filtered.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
            No delivery matches &quot;{q}&quot;.
          </Typography>
        ) : (
          filtered.map((r) =>
            tab === "pending" ? (
              <ScheduledRunCard
                key={r.id}
                run={r}
                onStart={() => router.push(`/scan/delivery/${r.id}`)}
                onViewDo={(assetId, docId) => router.push(`/scan/asset/${assetId}/do/${docId}/view`)}
              />
            ) : tab === "progress" ? (
              <InProgressRunCard
                key={r.id}
                run={r}
                opening={opening === r.id}
                disabled={opening !== null}
                onOpen={() => void openInProgress(r.id)}
              />
            ) : (
              <CompletedRunCard key={r.id} run={r} onOpen={() => router.push(`/scan/deliveries/finished/${r.id}`)} />
            ),
          )
        )}
      </Box>

      <FieldBottomNavSpacer />
      <FieldBottomNav value="deliveries" />
    </Box>
  );
}
