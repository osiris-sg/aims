// ⋮ menu Delete (WCT group, owner 2026-11-25): quotations, DOs and invoices, drafts and confirmed ones, from the
// lists (row ⋮, ticked-rows bar) and the document's own ⋮ menu. The server decides (POST /documents/wct-delete/check,
// rules in api-server-production/src/documents/wct-delete.ts); this file is the portal's side: who sees it, the
// confirm wording, the calls and the bulk summary.

export type MenuDeleteVerdict = { ok: boolean; reason: string | null };
export type MenuDeleteResult = { id: string; name: string | null; deleted: boolean; reason: string | null; journalsVoided: number };

const TYPES = new Set(["QUOTATION", "QO", "QO1", "DELIVERY_ORDER", "DO", "INVOICE", "TI", "TI2", "TAX_INVOICE", "INV"]);

/** On for the WCT group (soft delete + WCT doc nav) on the quotation, DO and invoice lists / editors. */
export function menuDeleteOn(o: { softDelete?: boolean; wctDocNav?: boolean; types: Array<string | null | undefined> }): boolean {
  return !!o.softDelete && !!o.wctDocNav && o.types.length > 0 && o.types.every((t) => TYPES.has(String(t ?? "").toUpperCase()));
}

/** Only people with Edit on Sales (documents:delete) see Delete at all. */
export const canMenuDelete = (hasPermission: (resource: string, action: string) => boolean) => hasPermission("documents", "delete");

export const deleteConfirmTitle = (name: string | null | undefined) => `Delete ${name || "this document"}?`;

/** The ticked-rows bar: what Delete will do with the selection. */
export function bulkDeleteSummary(verdicts: Record<string, MenuDeleteVerdict>, ids: string[]): { ok: string[]; skipped: Array<{ id: string; reason: string }> } {
  const ok: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    const v = verdicts[id];
    if (v?.ok) ok.push(id);
    else skipped.push({ id, reason: v?.reason || "Can't be deleted" });
  }
  return { ok, skipped };
}

type Req = (opts: { path: string; method: string; ownError?: boolean; quiet?: boolean }, body: any, token?: string) => Promise<any>;

export async function checkMenuDelete(request: Req, token: string | undefined, ids: string[]): Promise<Record<string, MenuDeleteVerdict>> {
  const res = await request({ path: "/documents/wct-delete/check", method: "POST", quiet: true, ownError: true }, { ids }, token);
  const data = res?.data ?? res;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, MenuDeleteVerdict>) : {};
}

export async function runMenuDelete(request: Req, token: string | undefined, ids: string[]): Promise<MenuDeleteResult[]> {
  const res = await request({ path: "/documents/wct-delete", method: "POST", ownError: true }, { ids }, token);
  if (res?.success === false) throw new Error(res?.message || "Delete failed");
  const data = res?.data ?? res;
  return Array.isArray(data) ? data : [];
}

/** The toast after a delete: "2 deleted", plus the first refusal. */
export function deleteToast(results: MenuDeleteResult[]): { ok: string | null; error: string | null } {
  const done = results.filter((r) => r.deleted);
  const refused = results.filter((r) => !r.deleted);
  return {
    ok: done.length ? (done.length === 1 ? `${done[0].name || "Document"} deleted` : `${done.length} deleted`) : null,
    error: refused.length ? `${refused[0].name || "A document"}: ${refused[0].reason || "can't be deleted"}${refused.length > 1 ? ` (+${refused.length - 1} more)` : ""}` : null,
  };
}
