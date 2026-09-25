"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import DrawIcon from "@mui/icons-material/Draw";
import { ReportSummary, customerOf, fetchPendingSignReports, reportMatchesSearch } from "../lib/maintenanceReports";

/**
 * PENDING SIGN: maintenance reports awaiting a signature. Shared by
 * /scan/reports/ongoing and the Maintenance home's Pending tab so the two can
 * never drift.
 *
 * These are reports the technician submitted with Skip because the person who
 * signs was not on site. They are complete in every other respect: numbered,
 * with all findings stored. Server-side they sit at `status: draft` and carry
 * no signature.
 *
 * Grouped by customer on purpose. The whole reason Skip exists is that a
 * technician works several machines for one client and the signatory appears
 * once at the end, so the list they need is "everything this client still owes
 * me a signature for", not a flat chronological feed.
 *
 * BATCH SIGNING. Tapping a row opens that one report. Ticking rows instead
 * builds a batch: the bar at the bottom carries them to
 * /scan/reports/sign-batch, where ONE signature pair is captured and applied to
 * all of them. Selection is locked to a SINGLE CUSTOMER (the moment one group
 * has a tick, every other group's checkboxes go disabled) because a client can
 * only certify their own machines, and a batch that silently spanned two
 * customers would put one client's signature on another's report.
 *
 * `search` only narrows what is SHOWN; it never drops a ticked report from the
 * batch. `barBottom` lifts the batch bar clear of a bottom nav.
 */
export function PendingSignList({ search = "", barBottom = "0px" }: { search?: string; barBottom?: string }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Selected report ids, and the customer they belong to. The customer is held
  // explicitly rather than derived on every render so the "other groups are
  // disabled" rule survives the list being re-read on focus.
  const [selected, setSelected] = useState<string[]>([]);
  const [lockedCustomer, setLockedCustomer] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const list = await fetchPendingSignReports(token);
      setReports(list);
      // Drop any selection whose report has since been signed (by this
      // technician on another screen, or by the office), so the bar never
      // carries a stale id into the batch.
      setSelected((prev) => {
        const live = new Set(list.map((r) => r.id));
        const kept = prev.filter((id) => live.has(id));
        if (!kept.length) setLockedCustomer(null);
        return kept;
      });
    } catch (e: any) {
      setError(e?.message ?? "Could not load reports awaiting signature");
      setReports([]);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-read on focus: the technician signs one, comes back, and the list must
  // not still show it.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Customer first, newest first within each (see the docblock).
  const grouped = useMemo(() => {
    const by = new Map<string, ReportSummary[]>();
    for (const r of reports ?? []) {
      if (!reportMatchesSearch(r, search)) continue;
      const key = customerOf(r);
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(r);
    }
    Array.from(by.values()).forEach((list) => list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    return Array.from(by.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [reports, search]);

  // Ticked reports the current search hides. They stay in the batch; the bar
  // says how many so the rider isn't surprised by what gets signed.
  const hiddenSelected = useMemo(() => {
    const shown = new Set(grouped.flatMap(([, list]) => list.map((r) => r.id)));
    return selected.filter((id) => !shown.has(id)).length;
  }, [grouped, selected]);

  const toggle = (r: ReportSummary) => {
    const customer = customerOf(r);
    setSelected((prev) => {
      // First tick in an empty selection locks the batch to this customer.
      if (!prev.length) { setLockedCustomer(customer); return [r.id]; }
      if (customer !== lockedCustomer) return prev; // guarded by `disabled` too
      const next = prev.includes(r.id) ? prev.filter((id) => id !== r.id) : [...prev, r.id];
      if (!next.length) setLockedCustomer(null);
      return next;
    });
  };

  const toggleGroup = (customer: string, list: ReportSummary[]) => {
    const ids = list.map((r) => r.id);
    const allOn = ids.every((id) => selected.includes(id));
    if (allOn) { setSelected([]); setLockedCustomer(null); return; }
    setSelected(ids);
    setLockedCustomer(customer);
  };

  return (
    <>
      {error && <Alert severity="error">{error}</Alert>}

      {!reports ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : reports.length === 0 ? (
        <Alert severity="success">Nothing is waiting for a signature.</Alert>
      ) : grouped.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
          No report matches &quot;{search}&quot;.
        </Typography>
      ) : (
        grouped.map(([customer, list]) => {
          const locked = lockedCustomer !== null && customer !== lockedCustomer;
          const groupIds = list.map((r) => r.id);
          const allOn = groupIds.every((id) => selected.includes(id));
          const someOn = !allOn && groupIds.some((id) => selected.includes(id));
          return (
            <Box key={customer} sx={{ opacity: locked ? 0.45 : 1 }}>
              <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
                {/* Select-all for the client in front of you: the common case is
                    "everything this customer owes me", not a hand-picked subset. */}
                <Checkbox
                  size="small"
                  checked={allOn}
                  indeterminate={someOn}
                  disabled={locked}
                  onChange={() => toggleGroup(customer, list)}
                  sx={{ mr: 0.5 }}
                  inputProps={{ "aria-label": `Select all reports for ${customer}` }}
                />
                <Typography variant="subtitle2" fontWeight={700}>
                  {customer}
                  <Chip size="small" label={list.length} sx={{ ml: 1 }} />
                </Typography>
              </Stack>
              <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 0 }}>
                {list.map((r) => (
                  <ListItemButton
                    key={r.id}
                    onClick={() => router.push(`/scan/reports/${r.id}/sign`)}
                    sx={{ minHeight: 64 }}
                  >
                    {/* stopPropagation: ticking must not also OPEN the report. */}
                    <Checkbox
                      edge="start"
                      checked={selected.includes(r.id)}
                      disabled={locked}
                      onClick={(e) => { e.stopPropagation(); toggle(r); }}
                      sx={{ mr: 0.5 }}
                      inputProps={{ "aria-label": `Select report ${r.reportNumber ?? ""}` }}
                    />
                    <DrawIcon color="warning" sx={{ mr: 1.5 }} />
                    <ListItemText
                      primary={
                        <>
                          <strong>{r.reportNumber != null ? `#${r.reportNumber}` : "Draft"}</strong>
                          {"  "}
                          {r.serviceData?.model || r.asset?.name || "Report"}
                        </>
                      }
                      secondary={[
                        r.serviceData?.serial || r.inventory?.sku,
                        r.serviceData?.serviceDate,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          );
        })
      )}

      {/* Keeps the last group scrollable clear of the batch bar. */}
      {selected.length > 0 && <Box aria-hidden sx={{ flexShrink: 0, height: 72 }} />}

      {/* The batch bar. Appears only with a selection, sits above the thumb. */}
      {selected.length > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: "fixed", left: 0, right: 0, bottom: barBottom, zIndex: 1200,
            p: 1.5, borderRadius: 0, display: "flex", alignItems: "center", gap: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} noWrap>
              {selected.length} selected{hiddenSelected > 0 ? ` (${hiddenSelected} hidden)` : ""}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {lockedCustomer}
            </Typography>
          </Box>
          <Button size="small" onClick={() => { setSelected([]); setLockedCustomer(null); }}>
            Clear
          </Button>
          <Button
            variant="contained"
            startIcon={<DrawIcon />}
            onClick={() => router.push(`/scan/reports/sign-batch?ids=${selected.join(",")}`)}
            sx={{ minHeight: 48 }}
          >
            Sign {selected.length}
          </Button>
        </Paper>
      )}
    </>
  );
}
