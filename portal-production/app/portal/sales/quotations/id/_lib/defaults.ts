import { newId } from "./math";
import type { IdQuote, QuoteArea, QuoteItem, QuoteSection, WorkSection } from "./types";

export const DEFAULT_TITLE = "RE: Letter of Intent & Appointment for Renovation Works at the below mentioned new address";

// Their contract's standard payment schedule (A–E) — editable per quote.
export const DEFAULT_PAYMENT_TERMS: string[] = [
  "A) Upon confirmation : $1500 Engagement Fees",
  "B) Upon Finalised 3D Rendering : Full 10% of contract sum",
  "C) Upon commencement of renovation work : 40%",
  "D) Upon carpentry measurement : 45% (VO to be completely paid)",
  "E) Upon handover & completion of works : 5%",
];

// General Terms & Conditions from their template (without prejudice).
export const DEFAULT_CLAUSES: string[] = [
  "Variation & Additional Orders must be signed and agreed before any commencement of additional works. Similarly for works taken out from contract must also be duly endorsed by client/s. These will be billed accordingly. 1) All works not stated in contract, and/or additional floor area and length will be deemed as variation and additional works. 2) All floor and wall tiles selection capped at $3.50 before gst unless otherwise stated. 3) All laminate selection for carpentry works capped at $60.00 per piece unless otherwise stated.",
  "Payment for Variation & Additional Orders must be claimed in FULL by the Company during the 3rd invoicing (45%). 1) Quotation for variation and additional works shall be confirmed by clients within 7 days upon receiving unless otherwise stated. 2) Company shall not be liable for any form of liquidated damages in the events of changes to works stated, and/or no confirmation for variation & additional orders resulting in delay of completion. 3) Variation order to be completely paid upon measurement of carpentry works. Variation order which comes after carpentry works shall be paid in full upon confirmation on variation order before commencement.",
  "Signed Agreement cannot be cancelled without a valid reason. Cancellation charges of up to 50% of contract sum may be imposed onto the client/s if work has been done and/or purchase of supplies, materials and labour had been arranged.",
  "The Company reserves the rights to stop work/put the renovation project on hold if progressive payments are not made promptly and accordingly.",
  "The Company retains full ownership of the design, renovation materials, built up customised carpentry, raw materials, finished or unfinished products for the said renovation project until all payments for the contract, Variation & Additional orders are made.",
  "Granite, marble and natural wood being natural materials may vary in tonality, veins, surface textures, speckles & thickness and more. Such variants are natural and are out of control of the Company. They shall be deemed as inevitable and the Company shall be indemnified against such irregularities.",
  "Manufactured tiles like ceramic & homogeneous tiles may have certain issues like warping and running tone patterns. These issues are inherent and the Company shall be indemnified against such issues.",
  "All items, artifacts, antiques, paintings and any other valuable or invaluable objects left willingly by the Client/s shall be at the Client/s own risk. The Company shall not be responsible for any theft, damage, loss during the course of renovation. However the Client/s may make special arrangement with the Company to lock up certain rooms to protect the Client/s belongings for stay-in projects. The keys must be retained by the Client/s at all times.",
  "Submission fees to relevant authorities e.g. BCA, FSB, MOE etc. and condominium management will be borne by the Client/s and may be billed from the Company.",
  "All final quotation and agreement is subjected to final site measurement conducted by the representative of the Project Division of the Company.",
  "This quotation and agreement is valid for 14 (Fourteen) days.",
  "Discounted items and FOC items will be billed accordingly if incidents listed below occur: a) Client/s cancel item/s from Original Contract/Quotation and Agreement, Variation & Additional Orders, b) Client/s do not make full payment.",
  "All Payments made to Ciel Interior Pte Ltd should be in the form of a Crossed Cheque, Bank Transfer or PayNow to the Company Registered UEN: 202312049Z.",
  "Life time warranty will only be issued upon full collection of all outstanding payment from the client/s.",
];

export const UOM_OPTIONS = ["nos", "sqft", "ft", "trip", "lot", "set", "pcs", "unit"];

export const AREA_SUGGESTIONS = [
  "General",
  "Living Room Area",
  "Dining Area",
  "Kitchen Area",
  "Kitchen/Yard Area",
  "Balcony Area",
  "Master Bedroom",
  "Bedroom 2",
  "Bedroom 3",
  "Guest Bedroom",
  "Study Room",
  "Common Bathroom",
  "Master Bathroom",
  "Store Room",
  "Whole House",
];

export function emptyItem(partial: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: newId(),
    workItemId: null,
    code: null,
    description: "",
    qty: 1,
    uom: "nos",
    amount: null,
    pricingMode: "priced",
    cost: null,
    includes: [],
    ...partial,
  };
}

export function emptyArea(name = "General"): QuoteArea {
  return { id: newId(), name, items: [] };
}

export function sectionFromPreset(ws: WorkSection): QuoteSection {
  return { id: newId(), letter: ws.letter || "", title: ws.title, notes: [...(ws.defaultNotes || [])], areas: [emptyArea()] };
}

export function emptySection(letter: string, title = "New Section"): QuoteSection {
  return { id: newId(), letter, title, notes: [], areas: [emptyArea()] };
}

export function defaultQuote(): IdQuote {
  return {
    version: 1,
    header: {
      title: DEFAULT_TITLE,
      clientName: "",
      nric: "",
      address: "",
      contact: "",
      agreementDate: new Date().toISOString().slice(0, 10),
      remarks: "",
      designer: "",
      designerPhone: "",
      paymentTerms: "As Mentioned Below",
    },
    sections: [],
    summary: { designFeePct: 5, discounts: [] },
    terms: { paymentTerms: [...DEFAULT_PAYMENT_TERMS], clauses: [...DEFAULT_CLAUSES] },
    settings: { marginGuidelinePct: 25, marginFloorPct: 15 },
  };
}

/** Bring an older / partial saved quote up to the current shape. */
export function normalizeQuote(raw: any): IdQuote {
  const d = defaultQuote();
  if (!raw || typeof raw !== "object") return d;
  return {
    version: 1,
    header: { ...d.header, ...(raw.header || {}) },
    sections: Array.isArray(raw.sections)
      ? raw.sections.map((s: any) => ({
          id: s.id || newId(),
          letter: s.letter || "",
          title: s.title || "",
          notes: Array.isArray(s.notes) ? s.notes : [],
          areas: (Array.isArray(s.areas) && s.areas.length ? s.areas : [emptyArea()]).map((a: any) => ({
            id: a.id || newId(),
            name: a.name || "General",
            items: (Array.isArray(a.items) ? a.items : []).map((it: any) => emptyItem({ ...it, id: it.id || newId(), includes: Array.isArray(it.includes) ? it.includes.map((i: any) => ({ id: i.id || newId(), ...i })) : [] })),
          })),
        }))
      : [],
    summary: { designFeePct: raw.summary?.designFeePct ?? 5, discounts: Array.isArray(raw.summary?.discounts) ? raw.summary.discounts : [] },
    terms: {
      paymentTerms: Array.isArray(raw.terms?.paymentTerms) ? raw.terms.paymentTerms : [...DEFAULT_PAYMENT_TERMS],
      clauses: Array.isArray(raw.terms?.clauses) ? raw.terms.clauses : [...DEFAULT_CLAUSES],
    },
    settings: { ...d.settings, ...(raw.settings || {}) },
  };
}
