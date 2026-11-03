"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, CircularProgress } from "@mui/material";
import { request } from "@/helpers/request";

/**
 * /portal/documents/open/<id>: opens any document by its id alone (2026-11-03;
 * e.g. a supplier invoice's Quotation No.). Looks up its type and template,
 * then goes to the usual editor URL.
 */
export default function OpenDocumentById() {
  const { documentId } = useParams<{ documentId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      const res: any = await request({ method: "GET", path: `/documents/${documentId}` }, {}, token ?? undefined);
      const d = res?.data ?? res;
      if (res?.success === false || !d?.id || !d?.type || !d?.documentTemplateId) {
        setError(res?.message || "That document could not be found.");
        return;
      }
      router.replace(`/portal/documents/${d.type}/${d.documentTemplateId}/${d.id}`);
    })();
  }, [documentId, getToken, router]);

  return (
    <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>{error ? <Alert severity="warning">{error}</Alert> : <CircularProgress />}</Box>
  );
}
