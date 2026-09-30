"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Autocomplete, Box, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

/**
 * Delivery group posts (2026-09-30): which WhatsApp group a signed delivery is
 * posted to. Project first, then Customer, then the org's ops group. The list
 * is the groups the posting number (Osiris) is actually in, as its worker last
 * reported them. Hidden unless the org has enableDeliveryGroupPosts.
 */
type Target = { kind: "project"; id: string } | { kind: "customer"; id: string } | { kind: "ops" };

interface Group {
  groupId: string;
  name: string;
}

const HINT: Record<Target["kind"], string> = {
  project: "Signed deliveries for this project are posted here (photos + signed DO).",
  customer: "Used for this customer's deliveries when the project has no group.",
  ops: "Fallback when neither the project nor the customer has a group.",
};

export default function WhatsAppGroupPicker({
  target,
  label = "WhatsApp group for delivery posts",
  orgId,
}: {
  target: Target;
  label?: string;
  /** Admin panel: act on THIS org (sent as X-Active-Org-Id, honoured for
   *  osiris admins only) and show regardless of the viewer's own flags. */
  orgId?: string;
}) {
  const { getToken } = useAuth();
  const { isDeliveryGroupPostsEnabled: flagOn } = useOrganizationFeatures();
  const isDeliveryGroupPostsEnabled = !!orgId || flagOn;
  const orgHeaders = orgId ? { "X-Active-Org-Id": orgId } : undefined;
  const [groups, setGroups] = useState<Group[]>([]);
  const [value, setValue] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      const q = target.kind === "project" ? `?projectId=${target.id}` : target.kind === "customer" ? `?customerId=${target.id}` : "";
      const [g, cur] = await Promise.all([
        request({ path: "/delivery-group-posts/groups", method: "GET" }, {}, token, orgHeaders),
        request({ path: `/delivery-group-posts/current${q}`, method: "GET" }, {}, token, orgHeaders),
      ]);
      const list: Group[] = (g?.data ?? g ?? []).map((x: any) => ({ groupId: x.groupId, name: x.name }));
      setGroups(list);
      const c = cur?.data ?? cur;
      setValue(c?.groupId ? list.find((x) => x.groupId === c.groupId) ?? { groupId: c.groupId, name: c.groupName || c.groupId } : null);
    } catch (e: any) {
      setError(e?.message ?? "Could not load WhatsApp groups");
    } finally {
      setLoading(false);
    }
  }, [getToken, target.kind, (target as any).id, orgId]);

  useEffect(() => {
    if (isDeliveryGroupPostsEnabled) void load();
  }, [isDeliveryGroupPostsEnabled, load]);

  if (!isDeliveryGroupPostsEnabled) return null;

  const save = async (next: Group | null) => {
    setValue(next);
    setSaving(true);
    setSaved(null);
    setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      const path =
        target.kind === "project"
          ? `/delivery-group-posts/project/${target.id}/group`
          : target.kind === "customer"
            ? `/delivery-group-posts/customer/${target.id}/group`
            : "/delivery-group-posts/ops-group";
      const res = await request({ path, method: "PUT" }, { groupId: next?.groupId ?? null }, token, orgHeaders);
      if (res?.success === false) throw new Error(res.message ?? "Could not save");
      setSaved(next ? `Saved: ${next.name}` : "Cleared");
    } catch (e: any) {
      setError(e?.message ?? "Could not save");
      void load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 460, width: "100%" }}>
      <Autocomplete
        size="small"
        options={groups}
        value={value}
        loading={loading}
        disabled={saving}
        isOptionEqualToValue={(a, b) => a.groupId === b.groupId}
        getOptionLabel={(g) => g.name}
        onChange={(_, next) => void save(next)}
        noOptionsText="No groups yet. The posting number reports its groups within a few minutes of starting."
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            InputProps={{
              ...params.InputProps,
              startAdornment: (
                <>
                  <WhatsAppIcon fontSize="small" sx={{ color: "success.main", ml: 0.5, mr: 0.5 }} />
                  {params.InputProps.startAdornment}
                </>
              ),
              endAdornment: (
                <>
                  {loading || saving ? <CircularProgress size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
        <Typography variant="caption" color={error ? "error" : saved ? "success.main" : "text.secondary"}>
          {error || saved || HINT[target.kind]}
        </Typography>
      </Stack>
    </Box>
  );
}
