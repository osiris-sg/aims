// Round BG — /preview/shipments/link[?lang=ja]: the REAL upload dialog with the link checklist, opened from a shipment's
// step 6 (CI payment proof) — fixture `link` (the shipment it opens from) + ordersAll / shipsAll / docTypes. Nothing is sent.
import { readFileSync } from "fs";
import LinkPreview from "./LinkPreview";

export const dynamic = "force-dynamic";

export default function Page() {
  const data = JSON.parse(readFileSync(process.env.PREVIEW_CLIENTS_FILE as string, "utf8"));
  return <LinkPreview link={data.link ?? null} />;
}
