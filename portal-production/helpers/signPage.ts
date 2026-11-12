// Public sign page (/sign/<token>) header title. A quotation with no number
// yet (CIEL drafts: the contract number is allocated on confirm) reads
// "Quotation (draft)", never "Quotation null"; once signed the page reloads
// and shows the real number.
export function signPageTitle(isVo: boolean, number: string | null | undefined): string {
  const n = String(number ?? "").trim();
  const label = n && n !== "null" && n !== "undefined" ? n : "(draft)";
  return isVo ? `Variation order ${label}` : `Quotation ${label}`;
}
