// WCT group subject types (guru 2026-11-19, flag enableSubjectType): the quotation / invoice
// Subject starts with the job type, as WCT's old ERP wrote it: "AA - Dismantle existing
// ductwork", or several joined with "+": "MV+CD - New system". The types are WCT's four
// sales accounts: MV 4-1000, CD 4-2000, AA and VO 4-3000, TS 4-3500. The Subject box shows a
// dropdown of the type(s) on its left and the rest as text; what is STORED is still the one
// subject string (documentInfo.subject), so the printout, the lists, the order and search
// all read it as before. On WCT (S) the type also decides what the invoice posts (api
// documents/subject-type-account.ts). Tested by helpers/subjectType.test.mjs.

export const SUBJECT_TYPES = ["AA", "CD", "MV", "TS", "VO"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

const T = SUBJECT_TYPES.join("|");
const LEAD = new RegExp(`^((?:${T})(?:\\s*\\+\\s*(?:${T}))*)\\s*-\\s*([\\s\\S]*)$`);

/** "MV+CD - New system" → { types: ["MV","CD"], text: "New system" }; no leading type → { types: [], text: subject }. */
export function splitSubject(subject: string | null | undefined): { types: SubjectType[]; text: string } {
  const s = String(subject ?? "");
  const m = s.match(LEAD);
  if (!m) return { types: [], text: s };
  const picked = new Set(m[1].split("+").map((x) => x.trim()));
  return { types: SUBJECT_TYPES.filter((t) => picked.has(t)), text: m[2] };
}

/** The stored subject: "<type>+<type> - <text>" (types in the dropdown's order), or just the text when no type is picked. */
export function joinSubject(types: readonly string[] | null | undefined, text: string | null | undefined): string {
  const t = String(text ?? "");
  const picked = SUBJECT_TYPES.filter((x) => (types ?? []).includes(x));
  return picked.length ? `${picked.join("+")} - ${t}` : t;
}
