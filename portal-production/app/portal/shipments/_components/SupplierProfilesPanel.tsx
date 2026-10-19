/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Supplier profiles: Vedanta issues a PI and takes a deposit (step 1) before
// the CI balance (step 6); Inalum / the Thai P1020 supplier don't — step 1 is
// N/A and step 6 pays the CI in full. A supplier's own document set replaces
// Vedanta's checklist on step 3b.

import React, { useEffect, useState } from "react";
import { Alert, Button, CircularProgress, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from "@mui/material";
import type { SupplierProfile } from "../_lib/api";
import { useSuppliers, useTradeMutation, useTradeSettings } from "../_lib/hooks";
import { toast } from "../_lib/toast";

export default function SupplierProfilesPanel() {
  const settings = useTradeSettings();
  const suppliers = useSuppliers();
  if (settings.isLoading || suppliers.isLoading) return <CircularProgress />;
  const list = (suppliers.data ?? []).filter((s) => !/mitsui soko|asia deal hub/i.test(s.name));
  if (!list.length) return <Alert severity="info">No suppliers yet — add them in Master Files.</Alert>;
  return (
    <Stack spacing={1.5} data-tour="settings-supplier-profiles">
      {list.map((s) => (
        <SupplierCard key={s.id} id={s.id} name={s.name} profile={settings.data?.supplierProfiles?.[s.id] ?? null} />
      ))}
    </Stack>
  );
}

function SupplierCard({ id, name, profile }: { id: string; name: string; profile: SupplierProfile | null }) {
  const save = useTradeMutation((a, body: Partial<SupplierProfile>) => a.updateSettings({ supplierProfiles: { [id]: body } }));
  // A supplier without a profile works like Vedanta (has a PI); a new non-Vedanta profile starts without one.
  const [hasPI, setHasPI] = useState(profile?.hasPI ?? /vedanta/i.test(name));
  const [docs, setDocs] = useState((profile?.shippingDocs ?? []).join(", "));
  useEffect(() => {
    setHasPI(profile?.hasPI ?? /vedanta/i.test(name));
    setDocs((profile?.shippingDocs ?? []).join(", "));
  }, [profile, name]);
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {name}
        {!profile && (
          <Typography component="span" variant="caption" color="text.secondary">
            {" "}
            — no profile yet (works like Vedanta until saved)
          </Typography>
        )}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} sx={{ mt: 1 }}>
        <FormControlLabel control={<Switch checked={hasPI} onChange={(e) => setHasPI(e.target.checked)} />} label={hasPI ? "Issues a PI (deposit on step 1)" : "No PI — step 1 N/A, CI paid in full"} />
        <TextField
          size="small"
          sx={{ flex: 1 }}
          label="Step 3b documents (codes; blank = Vedanta's set)"
          placeholder="BL, CI, PL"
          value={docs}
          onChange={(e) => setDocs(e.target.value)}
        />
        <Button
          variant="contained"
          disabled={save.isPending}
          onClick={async () => {
            try {
              const list = docs
                .split(/[,\s]+/)
                .map((d) => d.trim().toUpperCase())
                .filter(Boolean);
              await save.mutateAsync({ hasPI, shippingDocs: list.length ? list : null, label: name });
              toast.success(`${name}: profile saved — open supplier orders and shipments updated`);
            } catch (e: any) {
              toast.error(e?.message || "Could not save");
            }
          }}
        >
          Save
        </Button>
      </Stack>
    </Paper>
  );
}
