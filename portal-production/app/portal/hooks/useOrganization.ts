"use client";

import { useOrganization as useOrganizationContext } from "../context/OrganizationContext";

// Re-export the context hook for backward compatibility
export function useOrganization() {
  return useOrganizationContext();
}
