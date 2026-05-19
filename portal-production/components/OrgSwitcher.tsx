"use client";

import React, { useEffect, useState } from "react";
import { Autocomplete, TextField, Box, Chip } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

interface OrgOption {
  id: string;
  name: string;
}

/**
 * Dropdown that lets an osiris-admin pick which organization's data they're
 * viewing. Hidden for everyone else (returns null when isOsirisAdmin is false).
 *
 * On selection: persists the choice to sessionStorage via the context's
 * setActiveOrgId, which then reloads the page so every cache rebuilds with
 * the new org. See app/portal/context/OrganizationContext.tsx for the storage
 * mechanism, and helpers/request.ts for the header injection.
 */
export default function OrgSwitcher() {
  const { isOsirisAdmin, organization, realOrganization, setActiveOrgId } = useOrganization();
  const { getToken } = useAuth();
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOsirisAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: "/organizations", method: "GET" }, {}, token);
        if (cancelled) return;
        const list: OrgOption[] =
          (res?.success && Array.isArray(res?.data?.data) && res.data.data) ||
          (res?.success && Array.isArray(res?.data) && res.data) ||
          [];
        // Pin the user's home org first, alphabetical after.
        const sorted = [...list].sort((a, b) => {
          if (a.id === realOrganization?.id) return -1;
          if (b.id === realOrganization?.id) return 1;
          return (a.name ?? "").localeCompare(b.name ?? "");
        });
        setOrgs(sorted);
      } catch (err) {
        console.error("Failed to load organizations:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOsirisAdmin, getToken, realOrganization?.id]);

  if (!isOsirisAdmin) return null;

  const value = orgs.find((o) => o.id === organization?.id) ?? null;

  return (
    <Box sx={{ minWidth: 260 }}>
      <Autocomplete
        size="small"
        loading={loading}
        options={orgs}
        value={value}
        getOptionLabel={(o) => o.name ?? ""}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        disableClearable
        onChange={(_, selected) => {
          if (!selected) return;
          // Picking the home org clears the override; anything else writes it.
          setActiveOrgId(selected.id === realOrganization?.id ? null : selected.id);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Viewing organization"
            placeholder="Switch organization…"
            variant="outlined"
          />
        )}
        renderOption={(props, option) => (
          <li {...props} key={option.id}>
            <span style={{ flex: 1 }}>{option.name}</span>
            {option.id === realOrganization?.id && (
              <Chip size="small" label="home" sx={{ ml: 1 }} />
            )}
          </li>
        )}
      />
    </Box>
  );
}
