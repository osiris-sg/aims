// /preview/sin-dialog?wct=1|0&mode=light|dark — the REAL BillEditorDialog (new SIN), for layout screenshots.
// API calls are answered by the screenshot script. PREVIEW_FIXTURES=1 only; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewSinDialogPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  return <PreviewClient wct={searchParams?.wct === "1"} mode={searchParams?.mode === "dark" ? "dark" : "light"} />;
}
