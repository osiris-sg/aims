// Round BF — /preview/shipments/files: "All files in this thread" (timestamps, sender, size, pages, Latest / Older
// version / Identical to …) and a shipment slot's "Newer version received · Replace?" from the fixture's `files`
// (PREVIEW_FIXTURES=1 only, via the layout). ?lang=ja for Japanese. Nothing is sent.
import { readFileSync } from "fs";
import FilesPreview from "./FilesPreview";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: { lang?: string } }) {
  const data = JSON.parse(readFileSync(process.env.PREVIEW_CLIENTS_FILE as string, "utf8"));
  return <FilesPreview data={data.files ?? null} lang={searchParams?.lang === "ja" ? "ja" : "en"} />;
}
