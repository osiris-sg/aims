"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { ROUTES } from "../routes";
import { useOrganization } from "./useOrganization";

export function usePortalRedirect() {
  const { user } = useUser();
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();

  useEffect(() => {
    if (user && organization && window.location.pathname === "/") {
      router.push(ROUTES.PORTAL);
    }
  }, [user, organization, router]);

  return { isLoaded };
}
