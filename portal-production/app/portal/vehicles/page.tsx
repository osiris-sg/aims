import { redirect } from "next/navigation";
import { VEHICLES_PATH } from "@/helpers/wctNav";

// Vehicles moved under Assets (2026-11-16): old links keep working.
export default function OldVehiclesPage() {
  redirect(VEHICLES_PATH);
}
