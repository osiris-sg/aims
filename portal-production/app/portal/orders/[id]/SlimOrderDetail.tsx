"use client";

// PHASE C: replace this passthrough with the real slim status-columns UI.
//
// For now it renders the rich Cappitech flow unchanged, so flipping the
// enableCappitechOrders flag is a deliberate visible no-op — it proves the
// routing seam (OrderDetailRouter in ./page) without changing any behaviour.
// The real slim Orders UI (status columns: QO / DO / Invoice) lands here in
// Phase C and will NOT import CappitechOrderDetail, removing this dependency.
import { CappitechOrderDetail } from "./CappitechOrderDetail";

export default function SlimOrderDetail({ params }: { params: { id: string } }) {
  return <CappitechOrderDetail params={params} />;
}
