/**
 * Per-template DESIGN KNOBS (guru 2026-10-15: "use the knob approach").
 *
 * Stored on DocumentTemplate.styleConfig and read by BOTH renderers (this
 * server port and the portal's CleanDocumentPreview, which keeps a
 * byte-equivalent copy of resolveDesign in app/portal/documents/design.ts).
 * Every knob has a default that reproduces today's output, so a template
 * with no styleConfig prints exactly as before.
 *
 * Knobs are deliberately few and visual: an org picks a colour, a font,
 * where its logo sits and which standard blocks print. Anything that needs
 * free HTML is not a knob.
 */
export type DesignFont = 'helvetica' | 'calibri' | 'times' | 'georgia' | 'courier';
export type LogoPosition = 'none' | 'left' | 'center' | 'right';
export type HeaderAlign = 'center' | 'left';

export interface DocumentDesign {
  /** Hex colour for the title, rules and table header line. Black by default. */
  accentColor: string;
  fontFamily: DesignFont;
  /** Where the organisation logo prints in the letterhead. Off by default. */
  logoPosition: LogoPosition;
  /** Company block alignment in the letterhead. */
  headerAlign: HeaderAlign;
  /** Replaces the document title ("TAX INVOICE", "QUOTATION", "CREDIT NOTE"). Blank = the type's own title. */
  titleText: string;
  showDueDate: boolean;
  showBankDetails: boolean;
  showAmountInWords: boolean;
  /** The "This is a computer generated … No signature is required." lines. */
  showGeneratedNote: boolean;
  /** Shaded table header row. */
  tableHeaderFill: boolean;
  /** One extra line printed centred at the very bottom of the document. */
  footerText: string;
}

export const DEFAULT_DESIGN: DocumentDesign = {
  accentColor: '#000000',
  fontFamily: 'helvetica',
  logoPosition: 'none',
  headerAlign: 'center',
  titleText: '',
  showDueDate: true,
  showBankDetails: true,
  showAmountInWords: true,
  showGeneratedNote: true,
  tableHeaderFill: false,
  footerText: '',
};

export const DESIGN_FONTS: Record<DesignFont, string> = {
  helvetica: `'Helvetica Neue', Helvetica, Arial, sans-serif`,
  calibri: `Carlito, Calibri, 'Helvetica Neue', Arial, sans-serif`,
  times: `'Times New Roman', Times, serif`,
  georgia: `Georgia, 'Times New Roman', serif`,
  courier: `'Courier New', Courier, monospace`,
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Normalise whatever is stored (null, legacy junk, partial object) into a full design. */
export function resolveDesign(raw: any): DocumentDesign {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DESIGN };
  const bool = (v: any, d: boolean) => (typeof v === 'boolean' ? v : d);
  const str = (v: any, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const accent = str(raw.accentColor, 7);
  const font = String(raw.fontFamily || '') as DesignFont;
  const logo = String(raw.logoPosition || '') as LogoPosition;
  const align = String(raw.headerAlign || '') as HeaderAlign;
  return {
    accentColor: HEX.test(accent) ? accent.toLowerCase() : DEFAULT_DESIGN.accentColor,
    fontFamily: font in DESIGN_FONTS ? font : DEFAULT_DESIGN.fontFamily,
    logoPosition: (['none', 'left', 'center', 'right'] as LogoPosition[]).includes(logo) ? logo : DEFAULT_DESIGN.logoPosition,
    headerAlign: (['center', 'left'] as HeaderAlign[]).includes(align) ? align : DEFAULT_DESIGN.headerAlign,
    titleText: str(raw.titleText, 40),
    showDueDate: bool(raw.showDueDate, DEFAULT_DESIGN.showDueDate),
    showBankDetails: bool(raw.showBankDetails, DEFAULT_DESIGN.showBankDetails),
    showAmountInWords: bool(raw.showAmountInWords, DEFAULT_DESIGN.showAmountInWords),
    showGeneratedNote: bool(raw.showGeneratedNote, DEFAULT_DESIGN.showGeneratedNote),
    tableHeaderFill: bool(raw.tableHeaderFill, DEFAULT_DESIGN.tableHeaderFill),
    footerText: str(raw.footerText, 200),
  };
}

/** True when the design is the stock look, so callers can skip work. */
export const isDefaultDesign = (d: DocumentDesign): boolean => JSON.stringify(d) === JSON.stringify(DEFAULT_DESIGN);

/**
 * Height of the decorative empty rows that pad a short table to five lines.
 * A logo or footer line takes page height from the band, so the fillers give
 * some back; otherwise a one-line document grows a second page holding only
 * the footer (seen 2026-10-15 on the first designed invoice).
 */
export function fillerRowPx(d: DocumentDesign): number {
  let px = 40;
  if (d.logoPosition !== 'none') px -= 12;
  if (d.footerText) px -= 6;
  return Math.max(22, px);
}

/** Translucent tint of the accent for shaded table headers. */
export function accentTint(hex: string, alpha = 0.1): string {
  const m = HEX.test(hex) ? hex : DEFAULT_DESIGN.accentColor;
  const r = parseInt(m.slice(1, 3), 16);
  const g = parseInt(m.slice(3, 5), 16);
  const b = parseInt(m.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
