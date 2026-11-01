// Round AZ: Clients › Shipping lines became Clients › Logistics — old links land there.
import { redirect } from "next/navigation";
import { CLIENTS_ROUTE } from "@/helpers/shipmentsNav";

export default function ShippingLinesMoved() {
  redirect(`${CLIENTS_ROUTE}/logistics`);
}
