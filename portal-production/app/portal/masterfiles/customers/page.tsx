"use client";

// Master Files → Customers tab. Re-uses the existing standalone Customers page
// so both routes stay in sync (single source of truth).
import CustomersPage from "@/app/portal/customers/page";

export default function MasterFilesCustomers() {
  return <CustomersPage />;
}
