/**
 * Per-template DESIGN KNOBS, portal copy.
 *
 * Mirror of api-server-production/src/common/services/document-html/design.ts
 * (the portal is a separate deployable and cannot import from the API). Keep
 * the two in step: same knobs, same defaults, same normalisation, so the
 * editor preview and the server PDF agree.
 */
export type DesignFont = "helvetica" | "calibri" | "times" | "georgia" | "courier";
export type LogoPosition = "none" | "left" | "center" | "right";
export type HeaderAlign = "center" | "left";
/** Page shape: the stock frame, or a client layout (see the server copy). */
export type DocumentLayout = "standard" | "wct";
export const DOCUMENT_LAYOUTS: DocumentLayout[] = ["standard", "wct"];
export const DOCUMENT_LAYOUT_LABELS: Record<DocumentLayout, string> = {
  standard: "Standard",
  wct: "WCT (S) Systems",
};

export interface DocumentDesign {
  layout: DocumentLayout;
  accentColor: string;
  fontFamily: DesignFont;
  logoPosition: LogoPosition;
  headerAlign: HeaderAlign;
  titleText: string;
  showDueDate: boolean;
  showBankDetails: boolean;
  showAmountInWords: boolean;
  showGeneratedNote: boolean;
  tableHeaderFill: boolean;
  footerText: string;
}

export const DEFAULT_DESIGN: DocumentDesign = {
  layout: "standard",
  accentColor: "#000000",
  fontFamily: "helvetica",
  logoPosition: "none",
  headerAlign: "center",
  titleText: "",
  showDueDate: true,
  showBankDetails: true,
  showAmountInWords: true,
  showGeneratedNote: true,
  tableHeaderFill: false,
  footerText: "",
};

export const DESIGN_FONTS: Record<DesignFont, string> = {
  helvetica: `'Helvetica Neue', Helvetica, Arial, sans-serif`,
  calibri: `var(--font-carlito), Carlito, Calibri, 'Helvetica Neue', Arial, sans-serif`,
  times: `'Times New Roman', Times, serif`,
  georgia: `Georgia, 'Times New Roman', serif`,
  courier: `'Courier New', Courier, monospace`,
};

export const DESIGN_FONT_LABELS: Record<DesignFont, string> = {
  helvetica: "Helvetica (default)",
  calibri: "Calibri",
  times: "Times New Roman",
  georgia: "Georgia",
  courier: "Courier",
};

const HEX = /^#[0-9a-f]{6}$/i;

export function resolveDesign(raw: any): DocumentDesign {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DESIGN };
  const bool = (v: any, d: boolean) => (typeof v === "boolean" ? v : d);
  const str = (v: any, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const accent = str(raw.accentColor, 7);
  const font = String(raw.fontFamily || "") as DesignFont;
  const logo = String(raw.logoPosition || "") as LogoPosition;
  const align = String(raw.headerAlign || "") as HeaderAlign;
  const layout = String(raw.layout || "") as DocumentLayout;
  return {
    layout: DOCUMENT_LAYOUTS.includes(layout) ? layout : DEFAULT_DESIGN.layout,
    accentColor: HEX.test(accent) ? accent.toLowerCase() : DEFAULT_DESIGN.accentColor,
    fontFamily: font in DESIGN_FONTS ? font : DEFAULT_DESIGN.fontFamily,
    logoPosition: (["none", "left", "center", "right"] as LogoPosition[]).includes(logo) ? logo : DEFAULT_DESIGN.logoPosition,
    headerAlign: (["center", "left"] as HeaderAlign[]).includes(align) ? align : DEFAULT_DESIGN.headerAlign,
    titleText: str(raw.titleText, 40),
    showDueDate: bool(raw.showDueDate, DEFAULT_DESIGN.showDueDate),
    showBankDetails: bool(raw.showBankDetails, DEFAULT_DESIGN.showBankDetails),
    showAmountInWords: bool(raw.showAmountInWords, DEFAULT_DESIGN.showAmountInWords),
    showGeneratedNote: bool(raw.showGeneratedNote, DEFAULT_DESIGN.showGeneratedNote),
    tableHeaderFill: bool(raw.tableHeaderFill, DEFAULT_DESIGN.tableHeaderFill),
    footerText: str(raw.footerText, 200),
  };
}

export const isDefaultDesign = (d: DocumentDesign): boolean => JSON.stringify(d) === JSON.stringify(DEFAULT_DESIGN);

/**
 * Height of the decorative empty rows that pad a short table to five lines.
 * A logo or footer line takes page height from the band, so the fillers give
 * some back; otherwise a one-line document grows a second page holding only
 * the footer (seen 2026-10-15 on the first designed invoice).
 */
export function fillerRowPx(d: DocumentDesign): number {
  let px = 40;
  if (d.logoPosition !== "none") px -= 12;
  if (d.footerText) px -= 6;
  return Math.max(22, px);
}

export function accentTint(hex: string, alpha = 0.1): string {
  const m = HEX.test(hex) ? hex : DEFAULT_DESIGN.accentColor;
  const r = parseInt(m.slice(1, 3), 16);
  const g = parseInt(m.slice(3, 5), 16);
  const b = parseInt(m.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
