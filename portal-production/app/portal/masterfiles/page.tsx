import { redirect } from "next/navigation";

// /portal/masterfiles → default to the first tab.
export default function MasterFilesIndex() {
  redirect("/portal/masterfiles/customers");
}
