// Round BF — /preview/shipments/si/<generated doc id>[?lang=ja]: the REAL 出庫・納入依頼書 editor page from the fixture
// (PREVIEW_CLIENTS_FILE: generated[id], settings, docTypes, siPreviewHtml[id]); the live preview shows the fixture's HTML.
import PreviewSiClient from "./PreviewSiClient";

export const dynamic = "force-dynamic";

export default function PreviewSiPage() {
  return <PreviewSiClient />;
}
