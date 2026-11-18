/**
 * The salesperson's name saved beside a document's salesPerson (2026-11-18, all orgs). Only when the
 * salesPerson is a user id ("user_…", a salesman with no code) and the picker resolved a name: the server
 * then prints the name instead of the id. A salesman code adds nothing, so those documents are unchanged.
 */
export function salesPersonNameToSave(salesPerson: unknown, resolvedName: unknown): { salesPersonName?: string } {
  const sp = typeof salesPerson === "string" ? salesPerson.trim() : "";
  const name = typeof resolvedName === "string" ? resolvedName.trim() : "";
  return /^user_/.test(sp) && name ? { salesPersonName: name } : {};
}
