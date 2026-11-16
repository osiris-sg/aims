"use client";

// Master Files → User Management tab (guru 2026-11-16). Re-uses the standalone
// Users list so the org can manage users without leaving the Master Files hub.
// Gated per org by the enableUserMgmtMasterfile flag (see the layout); the tab
// is hidden for orgs that keep Users under Org Settings.
import Users from "@/app/portal/user-management/users/components/Users";

export default function MasterFilesUserManagement() {
  return <Users />;
}
