// /preview/vehicle-money?mode=light|dark — the vehicle page's "Money spent" card (enableWctVehicles)
// rendered from fixtures (no sign-in, no API) for layout checks and screenshots.
// Only with PREVIEW_FIXTURES=1 in the server's environment; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewVehicleMoneyPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  return <PreviewClient mode={searchParams?.mode === "dark" ? "dark" : "light"} />;
}
