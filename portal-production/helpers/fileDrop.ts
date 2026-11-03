/**
 * Drag-and-drop for file inputs (2026-11-03): which dropped files an input's
 * `accept` list takes, and what to say about the rest. Pure; the hook is
 * hooks/useFileDrop.ts. Same rules as the file picker, so a drop and the
 * button always agree.
 */

/** Does `file` match an <input accept="…"> list (".pdf", "image/*", "application/pdf")? Empty accept = anything. */
export function matchesAccept(file: { name: string; type?: string }, accept: string): boolean {
  const tokens = accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return tokens.some((t) => {
    if (t.startsWith(".")) return name.endsWith(t);
    if (t.endsWith("/*")) return !!type && type.startsWith(t.slice(0, -1));
    return !!type && type === t;
  });
}

/** Split a drop into the files the input takes and the names it skips. */
export function splitDropped<F extends { name: string; type?: string }>(files: F[], accept: string): { accepted: F[]; skipped: string[] } {
  const accepted: F[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (matchesAccept(f, accept)) accepted.push(f);
    else skipped.push(f.name);
  }
  return { accepted, skipped };
}

/** "notes.docx skipped: only PDF, image or ZIP files can be added." (several: "2 files skipped (a.docx, b.xlsx): …"). */
export function skippedMessage(names: string[], kinds: string): string | null {
  if (!names.length) return null;
  const head = names.length === 1 ? `${names[0]} skipped` : `${names.length} files skipped (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""})`;
  return `${head}: only ${kinds} files can be added.`;
}

/** Is a drag carrying files? (Safari hides the files themselves until the drop, but lists the "Files" type.) */
export function dragHasFiles(dt: { types?: ArrayLike<string> | null } | null | undefined): boolean {
  return !!dt?.types && Array.from(dt.types).includes("Files");
}

/** The kinds a file picker's accept list allows, for the skipped message. */
export function acceptKinds(accept: string): string {
  const a = accept.toLowerCase();
  const kinds: string[] = [];
  if (a.includes("pdf")) kinds.push("PDF");
  if (a.includes("image")) kinds.push("image");
  if (a.includes("zip")) kinds.push("ZIP");
  if (!kinds.length) return "supported";
  return kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(", ")} or ${kinds[kinds.length - 1]}`;
}
