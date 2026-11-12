// "Send for client signature" dialog wording (SignLinkDialog).
// "ciel" is the ID-quotation (CIEL) wording, unchanged. "wct" is the WCT group's
// (enableQuotationESign + enableWctOrders, 2026-11-13): same dialog, its own
// intro, no renovation / project talk, no em-dashes.

export type SignLinkWording = "ciel" | "wct";

const money = (n: number) => n.toLocaleString("en-SG", { minimumFractionDigits: 2 });

export const SIGN_LINK_WORDING = {
  ciel: {
    intro:
      "The client opens this link (no login), reads the quotation exactly as the PDF, draws their signature and accepts the T&Cs. On signing, the quotation is confirmed, a project is created and management is notified.",
    footer: "Any edit you make after sharing is what the client sees when they open the link — the page always renders the latest saved version.",
    copyFailed: "Copy failed — select the link and copy it manually",
    signed: "The quotation is confirmed and linked to its project.",
    message: (client: string, number: string, total: number, url: string) =>
      `Hi ${client || ""}, please review and sign your renovation quotation ${number || ""} (S$ ${money(total)}) here: ${url}`,
  },
  wct: {
    intro: "On signing, the quotation is confirmed, an order is created and the office is notified.",
    footer: "Any edit you make after sharing is what the client sees when they open the link: the page always renders the latest saved version.",
    copyFailed: "Copy failed. Select the link and copy it manually.",
    signed: "The quotation is confirmed and its order is created.",
    message: (client: string, number: string, total: number, url: string) =>
      `Hi ${client || ""}, please review and sign quotation ${number || ""}${total > 0 ? ` (S$ ${money(total)})` : ""} here: ${url}`,
  },
} as const;

/** WCT group quotations use CIEL's toolbar button + dialog (not the ⋮ menu entry). */
export const usesCielSignFlow = (f: { isQuotation: boolean; eSign: boolean; wctOrders: boolean }) => f.isQuotation && f.eSign && f.wctOrders;
