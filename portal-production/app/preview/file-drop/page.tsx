// /preview/file-drop?mode=light|dark — the SIN dialog's drop box (same hook + accept list) and the real
// Source Documents uploader, for drag-and-drop checks and screenshots. PREVIEW_FIXTURES=1 only; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewFileDropPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  return <PreviewClient mode={searchParams?.mode === "dark" ? "dark" : "light"} />;
}
