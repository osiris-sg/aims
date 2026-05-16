"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography, CircularProgress } from "@mui/material";
import { request } from "@/helpers/request";

interface AssetMatch {
  id: string;
  name: string;
  skuKey: string;
  description?: string | null;
  image?: string | null;
}

/**
 * First-tap binding screen. We arrive here when /assets/by-nfc-uid returned
 * 404 — the tag's hardware UID isn't bound to an asset yet. The technician
 * enters the SKU printed on the item, we look it up, confirm, then POST
 * /assets/:id/bind-nfc-tag and forward to the action chooser.
 */
export default function BindTagPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const uid = search?.get("uid") ?? "";

  const [sku, setSku] = useState("");
  const [match, setMatch] = useState<AssetMatch | null>(null);
  const [searching, setSearching] = useState(false);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const find = async () => {
    if (!sku.trim()) return;
    setError(null);
    setMatch(null);
    setSearching(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/assets/skuKey/${encodeURIComponent(sku.trim())}`, method: "GET" },
        {},
        token,
      );
      const asset = res.data ?? res;
      if (!asset?.id) {
        setError(`No asset found with SKU "${sku.trim()}"`);
        return;
      }
      setMatch(asset as AssetMatch);
    } catch (e: any) {
      setError(e?.message ?? "Lookup failed");
    } finally {
      setSearching(false);
    }
  };

  const confirm = async () => {
    if (!match || !uid) return;
    setBinding(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await request(
        { path: `/assets/${match.id}/bind-nfc-tag`, method: "POST" },
        { uid },
        token,
      );
      router.replace(`/scan/asset/${match.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to bind tag");
    } finally {
      setBinding(false);
    }
  };

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Missing tag UID — go back and tap again.</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.replace("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" fontWeight={700}>New tag</Typography>
      <Typography variant="body2" color="text.secondary">
        This tag isn&apos;t linked to anything yet. Type the SKU printed on the item to link them.
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
        Tag UID: {uid}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="e.g. AF-90"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && find()}
          autoFocus
        />
        <Button variant="contained" onClick={find} disabled={searching || !sku.trim()}>
          {searching ? <CircularProgress size={18} color="inherit" /> : "Find"}
        </Button>
      </Stack>

      {match && (
        <Card variant="outlined" sx={{ mt: 1 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600}>{match.name}</Typography>
            <Typography variant="body2" color="text.secondary">{match.skuKey}</Typography>
            {match.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{match.description}</Typography>
            )}
            <Button
              variant="contained"
              fullWidth
              sx={{ mt: 2 }}
              disabled={binding}
              onClick={confirm}
            >
              {binding ? "Linking..." : "Link this tag to this item"}
            </Button>
          </CardContent>
        </Card>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Button sx={{ mt: 2 }} onClick={() => router.replace("/scan")}>Cancel</Button>
    </Box>
  );
}
