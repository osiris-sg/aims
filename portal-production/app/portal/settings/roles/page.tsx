"use client";

// Roles moved into User Management as a tab next to Users (2026-11-23). Old links land there.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RolesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/portal/user-management/users?tab=roles");
  }, [router]);
  return null;
}
