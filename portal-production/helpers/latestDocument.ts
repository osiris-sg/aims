// "Go to latest document" pages (Sales / Inventory lists without the list
// view): what an answer of /documents/paginated (limit 1, newest first) leads
// to. Tested by helpers/latestDocument.test.mjs.

/** "open" the newest document, or "empty": show the empty state (never create one). */
export function latestDocumentAction(docs: unknown[] | null | undefined): "open" | "empty" {
  return Array.isArray(docs) && docs.length > 0 ? "open" : "empty";
}
