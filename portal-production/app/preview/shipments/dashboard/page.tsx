// Round BL — /preview/shipments/dashboard: ADH's Dashboard as it opens with AIMEE on (the AIMEE strip on top of the
// email dashboard), from the fixture (PREVIEW_FIXTURES=1 only, via the layout). ?aimee=<scenario> opens the side panel
// on a fixture conversation; ?lang=ja for Japanese. Nothing is sent.
import DashboardPreview from "./DashboardPreview";

export const dynamic = "force-dynamic";

export default function Page() {
  return <DashboardPreview />;
}
