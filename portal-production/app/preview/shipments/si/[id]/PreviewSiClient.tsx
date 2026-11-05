"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import GeneratedDocEditorPage from "@/app/portal/trade-documents/generated/[id]/page";
import { PreviewHtmlContext } from "@/app/portal/trade-documents/generated/_forms/previewHtml";

export default function PreviewSiClient() {
  const { id } = useParams<{ id: string }>();
  const [html, setHtml] = useState<Record<string, string>>({});
  // The pre-rendered PDF HTML comes from /preview-si-html.json written next to the fixture (served by the screenshot script).
  useEffect(() => {
    void fetch(`/api/preview-si-html?id=${id}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => setHtml(j ?? {}))
      .catch(() => undefined);
  }, [id]);
  const preview = useCallback(async () => ({ html: html[id] ?? "" }), [html, id]);
  return (
    <PreviewHtmlContext.Provider value={preview}>
      <GeneratedDocEditorPage />
    </PreviewHtmlContext.Provider>
  );
}
