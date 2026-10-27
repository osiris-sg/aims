/**
 * Canonical feature-flag defaults for a new organization. Mirrors the frontend
 * FEATURE_FLAG_DEFAULTS (portal useOrganizationFeatures.ts). Seeded into
 * OrganizationUIConfig.features on org creation so every org has the same flag
 * set (values are per-org; the list is universal). Add new flags here too.
 */
export const DEFAULT_ORG_FEATURES: Record<string, boolean> = {
  // Base capabilities (typically on)
  enableProjects: true,
  enableAnalytics: true,
  enableDocumentAI: true,
  enableCustomFields: true,
  enableServiceItems: true,
  // Integrations / mode toggles (opt-in)
  enableXeroIntegration: false,
  enableEditInventorySku: false,
  enableAssetTrackingMode: false,
  enableFieldScanApp: false,
  // Newer opt-in feature flags
  enableAssetPoints: false,
  enableItemTagging: false,
  enablePOAsProject: false,
  enableConfirmQuotation: false,
  // Gates the rich Cappitech Orders flow; default false = slim Orders (Biofuel default).
  enableCappitechOrders: false,
  enableDocumentListView: false,
  // Round each document's Nett Total DOWN to the nearest 5.
  enableNettRoundDown: false,
  // Quotation "Project" picker (link a quotation to a project + create new).
  enableQuotationProjectLink: false,
  // water-sg outbound site creation on DO sign-off (SIDS units only). Read by
  // the trigger in maintenance-reports.service.sign(). Default OFF; enabled
  // per-org (Biofuel) — no other org gets it.
  enableWaterSgSites: false,
  // Activity Log tab on the Audit page (ActionLog table — every API action
  // with typed actors; non-human actors show as "System creation"). Capture
  // is always-on server-side; this flag gates the viewer UI per org.
  // Default ON for every org, new and existing (guru, 2026-08-23).
  enableActionLog: true,
  // Mirror Xero approvals back into AIMS: when the accountant authorises an
  // invoice in Xero, AIMS matches the totals, confirms the document and voids
  // its own duplicate journal (guru 2026-09-28). OFF until an org opts in —
  // it writes to the GL.
  enableXeroConfirmSync: false,
  // Bank rec: show, per account and month, Xero's closing balance against the
  // AIMS GL so the accountant can see which months are settled on both sides
  // and where to resume (guru 2026-09-28). Read-only.
  enableBankRecXeroCheckpoint: false,
  // Interior-design quotation editor (CIEL INTERIOR, 2026-08): lettered trade
  // sections → room areas → work items with "* Includes" bullets, internal
  // cost / margin columns with guardrails, and the "Letter of Intent" print
  // layout. When ON, Sales → Quotation opens the ID editor instead of the
  // generic document editor. Default OFF; enabled per org.
  enableIdQuotation: false,
  // Operations dashboard (Biofuel, 2026-09-26): replaces the generic landing
  // cards with stock on hand, units in/out, revenue by product over a
  // filterable range, field-service frequency and a fleet map. Default OFF.
  enableOpsDashboard: false,
  // Chat home (2026-10-13): the portal landing page is the AIMS assistant
  // (same brain as the WhatsApp operator) with a Dashboard toggle. Default OFF.
  enableAimsChat: false,
  // Admin → org → Manage Templates → Design: per-template look knobs (colour, font, logo, blocks).
  enableTemplateDesign: false,
  // Maintenance Dates (Biofuel, 2026-09): Service Reports -> Maintenance Dates.
  // Plan a maintenance date per asset, see which deployed units are done, and a
  // reminder 7 days before (push to field techs + office bell). Default OFF.
  enableMaintenanceDates: false,
  // Delivery group posts (Biofuel, 2026-09-30): each delivery sign-off is
  // posted to the project's WhatsApp group (photos + signed DO) by the Osiris
  // number's post-only worker. Default OFF.
  enableDeliveryGroupPosts: false,
  // Trade (ADH) legacy pages (round H, 2026-10): Declaration, Payments, Stock and
  // the supplier-order pages left the menu; their routes show only with this ON.
  // Default OFF.
  enableTradeLegacyPages: false,
  // Shipments › Home's pipeline grid (round K: off — the Orders list's progress bars replace it). Code kept.
  enableTradePipelineGrid: false,
  // Shipments › Home page (round O, 2026-10-21: no Home for now — Orders is the landing page). With this OFF the
  // Home menu item is gone, every Shipments landing / redirect goes to Orders, /portal/shipments/dashboard redirects
  // to Orders, and the "Margin and profit" table has no home. "My tasks today" moved to the bell + the Orders list's
  // "Tasks" panel. Code kept. Default OFF.
  enableShipmentsHome: false,
  // Email intake thread reasoner (round R, 2026-10-21): when the rules can't decide, the model reads the thread
  // (own text, quoted history, attachment text) against the open orders / shipments table and proposes the
  // shipment(s) per attachment; applied by itself only when a hard key or a unique product match is verified.
  // Default OFF (ADH: switched on by setup-adh-org after the owner's go).
  enableEmailReasoner: false,
  // WhatsApp shipments agent (ADH, round S 2026-10-21): linked staff (User Management → WhatsApp) can
  // ask the shipments assistant on WhatsApp and get the digest / "needs you" pushes. Default OFF
  // (ADH: switched on by setup-adh-org after the owner's go).
  enableWhatsAppAgent: false,
  // Quotation e-sign for the GENERIC editor (WCT 2026-10-26): "Send for
  // signature" in the editor's ⋯ menu mints the public /sign/<token> link —
  // the same public-sign flow the ID quotation uses — and the client's drawn
  // signature prints in the WCT layout's "Confirmation of Order" block.
  // Signing confirms the quotation. Default OFF; enabled per org.
  enableQuotationESign: false,
  // Quotation → Delivery (WCT 2026-10-26): an ACCEPTED quotation (staff
  // confirm or client e-sign) auto-creates a DRAFT scheduled delivery from
  // its lines, waiting on the Deliveries page for the office to set the date
  // and confirm; promotion mints the DO with the quotation stamped on it
  // (quotationNo + sourceDocument* + quoted prices), and field completion
  // fires the draft invoice exactly like Biofuel. Also relaxes scheduling:
  // these orgs schedule without a Project / Sale Order. Default OFF.
  enableQuotationToDelivery: false,
  // Preset roles (WCT 2026-10-27, meant for every org): the org runs on the
  // built-in roles in src/roles/role-presets.ts and the client never sees
  // permissions — User Management shows only Users with a single Role
  // dropdown, and the Roles / Permissions editor is hidden. Default OFF.
  enableRolePresets: false,
  // LME feed (round AK, 2026-10-25): daily LME aluminium cash-settlement from Westmetall (07:00 JST) fills the empty
  // months of the org's LME table and keeps its own provisional month current; typed months are never changed; a
  // month turning final raises "revise CI / invoice" tasks. Only orgs with the SHIPMENTS module. Default OFF: while
  // off nothing is written anywhere ("Fetch now" in Settings → Shipping previews). ADH after the owner's go.
  enableLmeFeed: false,
};
