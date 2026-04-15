import { ROUTES } from "@/routes";
import { useUser } from "@clerk/nextjs";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

export default function usePoratalRedirectHandler() {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isUserLoaded) return;
    if (user && pathname === "/") {
      router.replace(ROUTES.PORTAL);
    }
  }, [isUserLoaded, user, organization, pathname, router]);

  return { isLoaded };
}
