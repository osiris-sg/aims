import { ROUTES } from "@/routes";
import { useUser } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

export default function usePoratalRedirectHandler() {
  const { user, isLoaded: isUserLoaded } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isUserLoaded) return;
    if (user && pathname === "/") {
      router.replace(ROUTES.PORTAL);
    }
  }, [isUserLoaded, user, pathname, router]);

  // No useOrganization() here: this hook mounts ABOVE every OrganizationProvider
  // (root layout), so the call only ever hit the provider-less fallback fetch —
  // a duplicate GET /organizations/user on every page, which on /no-account
  // is a guaranteed 403 for the very users that page exists for.
  return { isLoaded: isUserLoaded };
}
