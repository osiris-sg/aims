"use client";

// Round BF: who renders the editor's live preview. The portal calls the API (POST /trade-generated/preview); the
// /preview fixture pages (screenshots, no sign-in) provide pre-rendered HTML instead.
import { createContext } from "react";

export type PreviewHtmlFn = (input: { docType: string; header: unknown; columns: unknown[]; rows: unknown[]; draft?: boolean }) => Promise<{ html: string }>;
export const PreviewHtmlContext = createContext<PreviewHtmlFn | null>(null);
