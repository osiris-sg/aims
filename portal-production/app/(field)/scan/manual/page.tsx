"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

interface ManualAsset {
  id: string;
  name: string;
  skuKey: string;
}

interface ResolveMatch {
  inventoryId: string;
  sku: string;
  status: string;
  assetId: string;
  assetName: string | null;
  skuKey: string | null;
}

const FIELD_BUTTON_SX = {
  py: 1.5,
  fontSize: "1rem",
  minHeight: 48,
} as const;

/**
 * Manual serial entry — the NFC-less path to the scan action chooser, for
 * assets that can't carry a tag (allowManualEntry=true; e.g. submersible
 * pumps that live underwater). Pick the asset, key in the unit serial, and
 * land on the SAME /scan/asset/[assetId]?inventoryId= page a physical tag
 * scan reaches — every action there (delivery, assign) is tag-independent.
 */
export default function ManualEntryPage() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [assets, setAssets] = useState<ManualAsset[] | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<ManualAsset | null>(null);
  const [serial, setSerial] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Multi-match disambiguation (theoretically possible after normalization).
  const [candidates, setCandidates] = useState<ResolveMatch[] | null>(null);

  // Load the org's manual-entry-enabled assets. Exactly one → preselect so
  // the tech goes straight to the serial field.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setError("Not signed in");
          setAssets([]);
          return;
        }
        const res = await request({ path: "/assets/manual-entry", method: "GET" }, {}, token);
        if (cancelled) return;
        const list: ManualAsset[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        setAssets(list);
        if (list.length === 1) setSelectedAsset(list[0]);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Failed to load assets");
          setAssets([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const goToUnit = (m: ResolveMatch) => {
    // Wrong-asset pick: serials are org-unique, so we trust the serial over
    // the picker and land on the real owner — with a heads-up.
    if (selectedAsset && m.assetId !== selectedAsset.id) {
      toast.info(`${m.sku} belongs to ${m.assetName ?? m.skuKey ?? "another asset"}`);
    }
    router.push(`/scan/asset/${m.assetId}?inventoryId=${encodeURIComponent(m.inventoryId)}`);
  };

  const resolve = async () => {
    const q = serial.trim();
    if (!q) return;
    setResolving(true);
    setError(null);
    setCandidates(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const params = new URLSearchParams({ serial: q });
      if (selectedAsset) params.set("assetId", selectedAsset.id);
      const res = await request(
        { path: `/inventories/field-resolve?${params.toString()}`, method: "GET" },
        {},
        token,
      );
      const matches: ResolveMatch[] = (res?.data ?? res)?.matches ?? [];
      if (matches.length === 0) {
        setError(`No unit found for "${q}" — check the serial and try again.`);
      } else if (matches.length === 1) {
        goToUnit(matches[0]);
      } else {
        setCandidates(matches);
      }
    } catch (e: any) {
      setError(e?.message ?? "Lookup failed");
    } finally {
      setResolving(false);
    }
  };

  if (assets === null) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (assets.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No assets are enabled for manual serial entry. An admin can enable it per asset
          (&quot;Allow manual serial entry&quot; in the asset editor).
        </Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <KeyboardIcon color="primary" sx={{ fontSize: 40 }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>Enter serial manually</Typography>
          <Typography variant="body2" color="text.secondary">
            For assets without an NFC tag — key in the unit&apos;s serial number.
          </Typography>
        </Box>
      </Stack>

      {assets.length === 1 ? (
        <Chip label={`${assets[0].name} (${assets[0].skuKey})`} sx={{ alignSelf: "flex-start" }} />
      ) : (
        <Autocomplete<ManualAsset, false, false, false>
          options={assets}
          value={selectedAsset}
          onChange={(_, picked) => setSelectedAsset(picked)}
          getOptionLabel={(o) => `${o.name} (${o.skuKey})`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => (
            <TextField {...params} label="Asset" placeholder="Pick the asset type" />
          )}
        />
      )}

      <TextField
        label="Unit serial"
        placeholder="e.g. BI2026167"
        value={serial}
        onChange={(e) => {
          setSerial(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !resolving) {
            e.preventDefault();
            void resolve();
          }
        }}
        inputProps={{ autoCapitalize: "characters", autoCorrect: "off", spellCheck: false }}
        fullWidth
        autoFocus={assets.length === 1}
      />

      {error && <Alert severity="error">{error}</Alert>}

      {candidates && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Multiple units match — pick one:
          </Typography>
          <Stack spacing={1}>
            {candidates.map((m) => (
              <Box
                key={m.inventoryId}
                onClick={() => goToUnit(m)}
                sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              >
                <Typography variant="body2" fontWeight={600}>{m.sku}</Typography>
                <Typography variant="caption" color="text.secondary">{m.assetName}</Typography>
                <Chip size="small" label={m.status} variant="outlined" />
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      <Button
        variant="contained"
        fullWidth
        disabled={resolving || !serial.trim()}
        onClick={() => void resolve()}
        sx={FIELD_BUTTON_SX}
      >
        {resolving ? "Looking up..." : "Find unit"}
      </Button>

      <Button variant="text" sx={{ color: "text.secondary", alignSelf: "center" }} onClick={() => router.push("/scan")}>
        Back to scan
      </Button>
    </Box>
  );
}
