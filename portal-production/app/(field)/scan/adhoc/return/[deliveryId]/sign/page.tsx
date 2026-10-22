"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Divider, TextField, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import { useFieldAppBar } from "@/app/(field)/components/FieldAppBar";
import { FIELD_BUTTON_SX, ListCard } from "@/app/(field)/components/fieldUi";

/**
 * AD-HOC RETURN, screen 3 (2026-10-22): the items as typed, the customer name
 * (prefilled from screen 2) and the one signature. Completing posts the
 * ordinary finalize-return, which stamps the proof, completes the lines and
 * creates the Return Delivery Order, then lands on the finished screen with
 * Print / Download RDO. Matched vs untagged is the office's view, not shown
 * here.
 *
 * Reload-safe: everything is read back off the run (the typed IDs and the
 * customer live on its notes, one "Item:" / "Customer:" line each).
 */

interface RunItem {
  id: string;
  description: string | null;
  inventory: { sku: string | null } | null;
}

interface Run {
  id: string;
  deliveryNumber: number;
  status: string;
  direction?: "OUTBOUND" | "RETURN";
  notes: string | null;
  items: RunItem[];
}

/** The "Item:" / "Customer:" lines the run was born with (see the API's parseAdHocReturnNotes). */
function parseNotes(notes: string | null | undefined): { customer: string | null; items: string[] } {
  const out = { customer: null as string | null, items: [] as string[] };
  for (const line of (notes ?? "").split(/\r?\n/)) {
    const m = /^(Customer|Item):\s*(.*)$/.exec(line.trim());
    if (!m || !m[2].trim()) continue;
    if (m[1] === "Customer") out.customer = out.customer ?? m[2].trim();
    else out.items.push(m[2].trim());
  }
  return out;
}

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
        const typed = parseNotes(data.notes).customer;
        if (typed) setCustomerName(typed);
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

  // The IDs exactly as typed; a run without them (none born here) falls back
  // to its lines.
  const typedItems = parseNotes(run?.notes).items;
  const items: string[] = typedItems.length
    ? typedItems
    : (run?.items ?? []).map((i) => i.inventory?.sku || (i.description ?? "").replace(/^Untagged item:\s*/i, "") || "Item");

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
      <Box>
        <Typography variant="subtitle1" sx={{ mb: 0.75 }}>
          Items
        </Typography>
        <ListCard>
          {items.map((id, i) => (
            <React.Fragment key={`${id}-${i}`}>
              {i > 0 && <Divider sx={{ mx: 2 }} />}
              <Typography variant="body2" sx={{ px: 2, py: 1.5, fontFamily: "monospace", fontWeight: 600 }}>
                {id}
              </Typography>
            </React.Fragment>
          ))}
        </ListCard>
      </Box>

      <Typography variant="subtitle1">Customer signature</Typography>

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
