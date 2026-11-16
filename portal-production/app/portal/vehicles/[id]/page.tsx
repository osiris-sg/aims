import { redirect } from "next/navigation";
import { vehicleHref } from "@/helpers/wctNav";

// Vehicles moved under Assets (2026-11-16): old links (and older reminder bells) keep working.
export default function OldVehiclePage({ params }: { params: { id: string } }) {
  redirect(vehicleHref(params.id));
}
