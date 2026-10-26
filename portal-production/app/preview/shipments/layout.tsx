// Round AM — /preview/shipments/* : the real Clients / Orders pages rendered from a JSON fixture (no sign-in, no API) for
// the round report's screenshots. Only with PREVIEW_FIXTURES=1 and PREVIEW_CLIENTS_FILE=<a JSON dump of the API answers,
// scripts/_am-preview-fixtures.ts>; 404 otherwise. Nothing is fetched or written.
import { readFileSync } from "fs";
import { notFound } from "next/navigation";
import PreviewShipmentsProvider from "./PreviewShipmentsProvider";

export const dynamic = "force-dynamic";

export default function PreviewShipmentsLayout({ children }: { children: React.ReactNode }) {
  if (process.env.PREVIEW_FIXTURES !== "1" || !process.env.PREVIEW_CLIENTS_FILE) notFound();
  const data = JSON.parse(readFileSync(process.env.PREVIEW_CLIENTS_FILE, "utf8"));
  return <PreviewShipmentsProvider data={data}>{children}</PreviewShipmentsProvider>;
}
