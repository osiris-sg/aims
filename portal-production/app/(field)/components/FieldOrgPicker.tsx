"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogTitle, List, ListItemButton, ListItemText, Chip } from "@mui/material";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { FIELD_ORG_PICKED_KEY, needsFieldOrgPick } from "@/helpers/multiOrg";

/** The field app bar's "Switch organisation" item opens the picker through this event. */
export const FIELD_ORG_PICK_EVENT = "aims-field-org-pick";

/**
 * Multi-org users (2026-11-02), field app: a person in 2+ orgs picks the org
 * once per session (the default, most recently used one, is first), and can
 * switch later from the top bar's menu. Same rule as the portal: only their
 * own orgs, and the switch is remembered as their default.
 */
export default function FieldOrgPicker() {
  const { organization, memberships, setActiveOrgId, realOrganization, isLoaded } = useOrganization();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isLoaded || typeof window === "undefined") return;
    let picked = false;
    try {
      picked = window.sessionStorage.getItem(FIELD_ORG_PICKED_KEY) === "1";
    } catch {
      picked = true;
    }
    if (needsFieldOrgPick(memberships.length, picked)) setOpen(true);
  }, [isLoaded, memberships.length]);

  useEffect(() => {
    const onPick = () => setOpen(true);
    window.addEventListener(FIELD_ORG_PICK_EVENT, onPick);
    return () => window.removeEventListener(FIELD_ORG_PICK_EVENT, onPick);
  }, []);

  const choose = (id: string) => {
    try {
      window.sessionStorage.setItem(FIELD_ORG_PICKED_KEY, "1");
    } catch {
      // private mode: the picker may ask again next load
    }
    setOpen(false);
    if (id === organization?.id) return;
    void setActiveOrgId(id === realOrganization?.id ? null : id, { keepUrl: true });
  };

  if (memberships.length < 2) return null;
  return (
    <Dialog open={open} onClose={() => organization && choose(organization.id)} fullWidth maxWidth="xs">
      <DialogTitle>Which organisation?</DialogTitle>
      <List sx={{ pt: 0 }}>
        {memberships.map((m) => (
          <ListItemButton key={m.id} selected={m.id === organization?.id} onClick={() => choose(m.id)} sx={{ minHeight: 56 }}>
            <ListItemText primary={m.name} secondary={m.roles.join(", ") || undefined} primaryTypographyProps={{ fontWeight: 600 }} />
            {m.unreadNotifications > 0 && m.id !== organization?.id && <Chip size="small" color="primary" label={`${m.unreadNotifications} new`} />}
          </ListItemButton>
        ))}
      </List>
    </Dialog>
  );
}
