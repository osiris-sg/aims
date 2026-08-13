"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import MemoryIcon from "@mui/icons-material/Memory";
import NfcIcon from "@mui/icons-material/Nfc";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import AddIcon from "@mui/icons-material/Add";
import { request } from "@/helpers/request";
import { capturePosition } from "@/helpers/geolocation";
import { useNfcScan } from "../../../../hooks/useNfcScan";

/**
 * Child-component tagging (SIDS → TSS / Sim Card). Lists the scanned parent
 * unit's UNTAGGED children and lets the tech bind a fresh NFC tag to each —
 * with an optional real serial that completes the placeholder (the backend's
 * pending→instock auto-flip on the targeted-bind path).
 *
 * Reached two ways, both landing here: the scan chooser's "Components" card
 * (catch-up for already-backfilled placeholders) and the post-bind prompt
 * (right after tagging the parent). Sequential: tag one, the list refreshes,
 * repeat until none remain.
 */

interface Child {
  id: string;
  sku: string;
  assetId: string;
  assetName: string;
  status: string;
}

export default function ComponentsPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const nfc = useNfcScan();
  const assetId = params?.assetId as string;
  const inventoryId = search?.get("inventoryId") ?? null;

  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Active tag dialog (one child at a time).
  const [active, setActive] = useState<Child | null>(null);
  const [serial, setSerial] = useState("");
  const [binding, setBinding] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const handledUidRef = useRef<string | null>(null);

  // "Add a component type" dialog — creates a new child ASSET under the parent.
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSkuKey, setNewSkuKey] = useState("");
  const [skuKeyEdited, setSkuKeyEdited] = useState(false);
  const [creatingType, setCreatingType] = useState(false);
  const [addTypeError, setAddTypeError] = useState<string | null>(null);

  // Auto-suggest a skuKey from the name until the tech edits it manually:
  // uppercase, alphanumerics only ("Flow Meter v2" → "FLOWMETERV2").
  const suggestSkuKey = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setError("Not signed in");
        return;
      }
      const invQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
      const res = await request(
        { path: `/maintenance-reports/scan-context/${assetId}${invQuery}`, method: "GET" },
        {},
        token,
      );
      const data = res.data ?? res;
      setChildren(data?.untaggedChildren ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load components");
    } finally {
      setLoading(false);
    }
  }, [assetId, inventoryId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTag = (child: Child) => {
    setActive(child);
    setSerial("");
    setActionMsg(null);
    handledUidRef.current = null;
    if (nfc.isSupported && !nfc.isScanning) void nfc.startScan();
  };

  const closeTag = () => {
    if (nfc.isScanning) void nfc.stopScan();
    setActive(null);
    setSerial("");
  };

  // Bind the active child to a scanned tag (+ optional serial). confirmRebind
  // lets the ALREADY_TAGGED 409 be retried in one tap.
  const bindChild = useCallback(
    async (uid: string, confirmRebind = false) => {
      if (!active) return;
      setBinding(true);
      setActionMsg(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const coords = await capturePosition().catch(() => null);
        const res = await request(
          { path: "/inventories/create-and-bind", method: "POST" },
          {
            assetId: active.assetId,
            targetInventoryId: active.id,
            nfcTagUid: uid,
            serial: serial.trim() || undefined,
            ...(confirmRebind ? { confirmRebind: true } : {}),
            ...(coords ? { taggedLatitude: coords.latitude, taggedLongitude: coords.longitude, taggedLocationAccuracy: coords.accuracy ?? undefined } : {}),
          },
          token,
        );
        if (res?.success === false) {
          if (res?.code === "ALREADY_TAGGED" && !confirmRebind) {
            // one-tap rebind confirm
            if (confirm(`${res.message}\n\nRebind anyway?`)) {
              await bindChild(uid, true);
              return;
            }
            setActionMsg("Tag already in use — cancelled.");
            return;
          }
          throw new Error(res?.message ?? "Bind failed");
        }
        closeTag();
        await load();
      } catch (e: any) {
        setActionMsg(e?.message ?? "Could not bind this component");
      } finally {
        setBinding(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, serial, getToken, load],
  );

  // Observe the inline NFC read (uid resets per startScan, one read per scan).
  useEffect(() => {
    const uid = nfc.uid;
    if (!uid || uid === handledUidRef.current || !active) return;
    handledUidRef.current = uid;
    void bindChild(uid);
  }, [nfc.uid, active, bindChild]);

  const openAddType = () => {
    setNewName("");
    setNewSkuKey("");
    setSkuKeyEdited(false);
    setAddTypeError(null);
    setAddTypeOpen(true);
  };

  // Create the child asset TYPE (name + skuKey) under the scanned unit's
  // parent, spawning this unit's placeholder so it lands in the list ready to
  // tag. Exact-skuKey collision is surfaced clearly (backend returns
  // collision:true rather than erroring opaquely).
  const createType = async () => {
    const name = newName.trim();
    const skuKey = newSkuKey.trim();
    if (!name || !skuKey || !inventoryId) return;
    setCreatingType(true);
    setAddTypeError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/assets/create-child", method: "POST" },
        { parentAssetId: assetId, parentInventoryId: inventoryId, name, skuKey },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not create the component type");
      const data = res?.data ?? res;
      if (data?.collision) {
        setAddTypeError(`Code "${skuKey}" already exists (${data.asset?.name ?? "another type"}). Pick a different code.`);
        return;
      }
      setAddTypeOpen(false);
      await load(); // the new placeholder now appears in the list, ready to tag
    } catch (e: any) {
      setAddTypeError(e?.message ?? "Could not create the component type");
    } finally {
      setCreatingType(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.replace("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  const remaining = children ?? [];
  const doneHref = `/scan/asset/${assetId}${inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : ""}`;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <MemoryIcon color="primary" sx={{ fontSize: 40 }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>Tag components</Typography>
          <Typography variant="body2" color="text.secondary">
            Bind a tag to each part of this unit.
          </Typography>
        </Box>
      </Stack>

      {actionMsg && <Alert severity="warning" onClose={() => setActionMsg(null)}>{actionMsg}</Alert>}
      {nfc.error && <Alert severity="warning">{nfc.error}</Alert>}

      {remaining.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: "center", py: 4 }}>
            <CheckCircleIcon color="success" sx={{ fontSize: 48 }} />
            <Typography variant="body1" sx={{ mt: 1 }}>All components are tagged.</Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {remaining.map((c) => (
            <Card key={c.id} variant="outlined">
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 2 }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body1" fontWeight={600} noWrap>{c.assetName}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">{c.sku}</Typography>
                </Box>
                <Chip size="small" label={c.status === "pending" ? "Needs tag" : c.status} color={c.status === "pending" ? "warning" : "default"} />
                <Button variant="contained" size="small" startIcon={<NfcIcon />} onClick={() => openTag(c)} sx={{ minHeight: 40 }}>
                  Tag
                </Button>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Add a NEW component type (child asset) not yet in the catalog. */}
      <Button variant="outlined" startIcon={<AddIcon />} onClick={openAddType} sx={{ mt: 0.5, alignSelf: "stretch" }}>
        Add a component type
      </Button>

      <Button variant={remaining.length === 0 ? "contained" : "text"} onClick={() => router.replace(doneHref)} sx={{ mt: 1, alignSelf: "center", ...(remaining.length ? { color: "text.secondary" } : {}) }}>
        {remaining.length === 0 ? "Done" : "Finish later"}
      </Button>

      {/* Add-component-type dialog: name + skuKey → new child asset + its
          placeholder for this unit, ready to tag. */}
      <Dialog open={addTypeOpen} onClose={() => !creatingType && setAddTypeOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add a component type</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Creates a new component of this unit. Name and code only — the office
            fills in pricing, category and the rest later.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Component name"
            placeholder="e.g. Flow Meter"
            value={newName}
            onChange={(e) => {
              const v = e.target.value;
              setNewName(v);
              if (!skuKeyEdited) setNewSkuKey(suggestSkuKey(v));
            }}
            disabled={creatingType}
            sx={{ mb: 1.5 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Code (SKU key)"
            placeholder="e.g. FLOWMETER"
            value={newSkuKey}
            onChange={(e) => {
              setSkuKeyEdited(true);
              setNewSkuKey(e.target.value);
            }}
            disabled={creatingType}
            helperText="A unique code for this component type."
          />
          {addTypeError && <Alert severity="error" sx={{ mt: 1.5 }}>{addTypeError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTypeOpen(false)} disabled={creatingType}>Cancel</Button>
          <Button variant="contained" onClick={createType} disabled={creatingType || !newName.trim() || !newSkuKey.trim()}>
            {creatingType ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Per-child tag dialog */}
      <Dialog open={!!active} onClose={() => !binding && closeTag()} fullWidth maxWidth="xs">
        <DialogTitle>Tag {active?.assetName}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {nfc.isSupported
              ? binding
                ? "Binding…"
                : "Hold the new tag to the phone."
              : "This device can't scan tags in-app — use the scanner page."}
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="Serial (optional)"
            placeholder="Completes the component if entered"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            disabled={binding}
          />
          {binding && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <CircularProgress size={26} />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeTag} disabled={binding}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
