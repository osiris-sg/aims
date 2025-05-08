/* eslint-disable react-hooks/exhaustive-deps */
import { ROUTES } from "@/routes";
import { useOrganization, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
export default function usePoratalRedirectHandler() {
  const { user } = useUser();
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();

  useEffect(() => {
    if (user && organization && window.location.pathname === "/") {
      router.push(ROUTES.PORTAL);
    }
  }, [user && organization]);
  return { isLoaded };
}
