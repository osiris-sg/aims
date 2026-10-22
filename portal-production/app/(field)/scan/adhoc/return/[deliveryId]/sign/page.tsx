"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Divider, Stack, TextField, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { request } from "@/helpers/request";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import { useFieldAppBar } from "@/app/(field)/components/FieldAppBar";
import { FIELD_BUTTON_SX, ListCard, StatusChip } from "@/app/(field)/components/fieldUi";

/**
 * AD-HOC RETURN, screen 2 (2026-10-22): the review + the one customer
 * signature. Shows which typed IDs matched a unit (returned to stock) and
 * which stayed untagged (kept for the office), then the customer's name and
 * signature. Completing posts the ordinary finalize-return, which stamps the
 * proof, completes the lines and creates the Return Delivery Order, and lands
 * on the finished screen with Print / Download RDO.
 *
 * Reload-safe: everything shown is read back off the run, so a rider who
 * backs out finds the same run under In progress and can finish it from the
 * basket's "Ready to finish" card as well.
 */

interface RunItem {
  id: string;
  description: string | null;
  assetId: string | null;
  inventoryId: string | null;
  deliveryStatus: string;
  inventory: { sku: string | null; status?: string | null } | null;
  asset: { name: string | null } | null;
}

interface Run {
  id: string;
  deliveryNumber: number;
  status: string;
  direction?: "OUTBOUND" | "RETURN";
  siteAddress: string | null;
  items: RunItem[];
}

const untaggedId = (description: string | null) => (description ?? "").replace(/^Untagged item:\s*/i, "").trim();

export default function AdHocReturnSignPage() {
  const router = useRouter();
  const { deliveryId } = useParams() as { deliveryId: string };
  const { getToken } = useAuth();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [working, setWorking] = useState(false);
  const sigRef = useRef<SignaturePadHandle>(null);

  useFieldAppBar({
    title: "Finish return",
    subtitle: run ? `Return #${run.deliveryNumber}` : undefined,
    // The run already exists; leaving here parks it under In progress.
    onBack: () => router.replace("/scan?tab=progress"),
    backDisabled: working,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        if (res?.success === false) throw new Error(res?.message ?? "Could not load this return");
        const data: Run = res?.data ?? res;
        if (cancelled) return;
        if (data?.direction !== "RETURN") throw new Error("This is not a return");
        if (data.status === "completed") {
          router.replace(`/scan/deliveries/finished/${deliveryId}`);
          return;
        }
        setRun(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not load this return");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryId, getToken, router]);

  const matched = run?.items.filter((i) => i.inventoryId) ?? [];
  const untagged = run?.items.filter((i) => !i.inventoryId && !i.assetId) ?? [];

  const submit = async () => {
    if (!run) return;
    const name = customerName.trim();
    if (!name) {
      setError("Enter the customer's name.");
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("The customer needs to sign to complete the return.");
      return;
    }
    const signature = sigRef.current.toDataUrl();
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${run.id}/finalize-return`, method: "POST" },
        { signature, recipientName: name },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not complete the return");
      router.replace(`/scan/deliveries/finished/${run.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Could not complete the return");
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!run) {
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        <Alert severity="error">{error ?? "Return not found"}</Alert>
        <Button variant="outlined" onClick={() => router.replace("/scan?tab=progress")} fullWidth sx={FIELD_BUTTON_SX}>
          Back to Deliveries
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Check what was recognised, then take the customer&apos;s signature.
        {run.siteAddress ? ` Collected from ${run.siteAddress}.` : ""}
      </Typography>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
          Matched units ({matched.length})
        </Typography>
        {matched.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            None of the IDs matched a unit out on rental.
          </Typography>
        ) : (
          <ListCard>
            {matched.map((it, i) => (
              <React.Fragment key={it.id}>
                {i > 0 && <Divider sx={{ mx: 2 }} />}
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.5 }}>
                  <CheckCircleIcon color="success" fontSize="small" />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ fontFamily: "monospace" }}>
                      {it.inventory?.sku ?? "Unit"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {it.asset?.name ?? it.description ?? ""}
                    </Typography>
                  </Box>
                  <StatusChip label="BACK IN STOCK" tone="good" />
                </Stack>
              </React.Fragment>
            ))}
          </ListCard>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
          Untagged items ({untagged.length})
        </Typography>
        {untagged.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Every ID matched a unit.
          </Typography>
        ) : (
          <>
            <ListCard>
              {untagged.map((it, i) => (
                <React.Fragment key={it.id}>
                  {i > 0 && <Divider sx={{ mx: 2 }} />}
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.5 }}>
                    <HelpOutlineIcon color="warning" fontSize="small" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ fontFamily: "monospace" }}>
                        {untaggedId(it.description) || "Item"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Not a known unit out on rental
                      </Typography>
                    </Box>
                    <StatusChip label="FOR OFFICE" tone="warn" />
                  </Stack>
                </React.Fragment>
              ))}
            </ListCard>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              Untagged items go on the return note as typed. The office links them to real units later.
            </Typography>
          </>
        )}
      </Box>

      <Divider />

      <Typography variant="h6" fontWeight={700}>
        Customer signature
      </Typography>
      <Typography variant="body2" color="text.secondary">
        One signature covers the whole return. It completes the collection and creates the Return Delivery Order.
      </Typography>

      <TextField
        label="Customer name"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        required
        size="small"
        fullWidth
        disabled={working}
      />

      <SignaturePadField ref={sigRef} />

      {error && (
        <Alert severity="warning" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Button fullWidth variant="contained" color="success" onClick={() => void submit()} disabled={working} sx={FIELD_BUTTON_SX}>
        {working ? <CircularProgress size={22} color="inherit" /> : "Complete return"}
      </Button>
    </Box>
  );
}
