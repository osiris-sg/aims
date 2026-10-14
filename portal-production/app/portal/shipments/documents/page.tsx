import { redirect } from "next/navigation";

// The trade documents library moved to the top-level Documents hub.
export default function ShipmentDocumentsRedirect() {
  redirect("/portal/trade-documents");
}
