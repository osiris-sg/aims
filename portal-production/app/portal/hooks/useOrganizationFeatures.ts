"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface OrganizationFeatures {
  enableAssetTrackingMode?: boolean;
  enableProjects?: boolean;
  enableAnalytics?: boolean;
  enableDocumentAI?: boolean;
  enableFieldScanApp?: boolean;
  enableDocumentListView?: boolean;
  enablePOAsProject?: boolean;
  enableAssetPoints?: boolean;
  enableItemTagging?: boolean;
  enableConfirmQuotation?: boolean;
  enableQuotationESign?: boolean;
  enableQuotationToDelivery?: boolean;
  enableSiteClockLink?: boolean;
  enableSiteClockDeliveries?: boolean;
  enableJobsCalendar?: boolean;
  enableRealDoOnSchedule?: boolean;
  enableWctOrders?: boolean;
  enableWctMyJobs?: boolean;
  enableWctFinishModes?: boolean;
  enableWctOrderInvoice?: boolean;
  enableJobFields?: boolean;
  // Office-signed delivery orders (2026-11-05): a DO raised in the office, with
  // no field run behind it, can be shared for the customer to sign.
  enableOfficeDoSign?: boolean;
  enableBridgeLeadCapture?: boolean;
  enableApCreditOffset?: boolean;
  enableContraOffset?: boolean;
  // Customer UEN + old code (2026-11-02): fields, columns, picker line. WCT on.
  enableCustomerUen?: boolean;
  // Preset roles with built-in permissions; no role / permission editor for the client.
  enableRolePresets?: boolean;
  enableCappitechOrders?: boolean;
  enableNettRoundDown?: boolean;
  enableQuotationProjectLink?: boolean;
  enableWaterSgSites?: boolean;
  [key: string]: boolean | undefined;
}

/**
 * Canonical feature-flag list with default values. Single source of truth for
 * which flags exist app-wide. The admin panel renders this merged with an org's
 * stored values so every org shows the same switches (values stay per-org).
 * Add new flags here so they appear for all orgs without per-org backfilling.
 */
/**
 * Feature entries that carry TEXT rather than a switch.
 *
 * The bridge lead flow keeps its customer-facing wording here instead of in
 * code, so ad copy and the hand-over message change without a deploy — but a
 * value only reaches the admin panel if the panel knows to show it, so the
 * known text entries are declared here exactly as the boolean flags are. The
 * backend holds the same defaults (api-server src/common/org-features.ts);
 * leaving a box empty falls back to them.
 */
export const FEATURE_TEXT_DEFAULTS: Record<string, string> = {
  // The exact intro the Instagram ad sends. Seeing it leave the line is what
  // opens a Lead, so a near-miss opens nothing — keep it verbatim.
  bridgeLeadIntro: "Hi! Please let us know how we can help you.",
  // Asked once, when the ad's first contact lands.
  bridgeLeadAskName: "Hey, how can we address you? :)",
  // Sent when they answer with their name; {name} is substituted.
  bridgeLeadConfirm:
    "Hello {name} :) We have arranged a designer to you, he will be contacting you within 24 hours so do expect a call or text.",
  // The org user every bridge lead is assigned to. Empty = ask management on
  // WhatsApp instead, the way every other lead source does.
  bridgeLeadAssignee: "Mike",
};

export const FEATURE_FLAG_DEFAULTS: Record<string, boolean> = {
  // Base capabilities (typically on)
  enableProjects: true,
  enableAnalytics: true,
  // Header-bell notifications; OFF also stops the server writing new rows (guru 2026-10-10: CIEL wants none).
  enableNotifications: true,
  // Settings → Business rules page (payment ladder, fees, % defaults) — Directors only.
  enableBusinessRules: false,
  // Accounting → Monthly Payables: the outgoing-payments tally fed by the bills
  // WhatsApp group (Summer 2026-11-02).
  enablePayables: false,
  // Enquiries off the linked-device WhatsApp bridge become Leads (CIEL
  // 2026-11-08): the ad's intro leaving the line opens the lead, their reply
  // names it and sends the assign card. OFF everywhere else — other orgs'
  // bridge traffic is staff chatter. The intro text itself is the non-boolean
  // `bridgeLeadIntro` entry, edited as text in Admin → Configuration.
  enableBridgeLeadCapture: false,
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
  // Quotation e-sign for the generic editor (WCT 2026-10-26): "Send for
  // signature" in the editor's ⋯ menu mints the public /sign/<token> link;
  // the client's drawn signature prints on the document. Default OFF.
  enableQuotationESign: false,
  // Quotation → Delivery (WCT 2026-10-26): an accepted quotation auto-creates
  // a DRAFT scheduled delivery; scheduling needs no Project / Sale Order for
  // these orgs. Default OFF.
  enableQuotationToDelivery: false,
  enableRolePresets: false,
  // Gates the rich Cappitech Orders flow; default false = slim Orders (Biofuel default).
  enableCappitechOrders: false,
  enableDocumentListView: false,
  // Round each document's Nett Total DOWN to the nearest 5.
  enableNettRoundDown: false,
  // Quotation "Project" picker (link a quotation to a project + create new).
  enableQuotationProjectLink: false,
  // water-sg outbound site creation on DO sign-off (SIDS units). Backend-only
  // trigger; listed here so the flag appears in the admin switches for all orgs.
  enableWaterSgSites: false,
  // Email ingestion agent (docs+{org}@ inbound address → AI-classified drafts).
  // Product switch; the runtime switch is EmailIngestConfig.enabled per org.
  enableEmailIngestion: false,
  // "Sync to Xero" action in the document editor toolbar (accounting context):
  // pushes the invoice to Xero as a DRAFT with mapped accounts + tax settings.
  enableXeroDocSync: false,
  // Accounting UX overhaul: legacy-software workflows (screen structure, entry
  // flow) rendered with the modern AIMS UI. OFF = current Xero-like layout.
  enableLegacyAccountingUx: false,
  // Keyboard hotkeys (F2 look up, F9 save…) + Settings → Hotkeys. Default ON for every org (guru 2026-11-09).
  enableHotkeys: true,
  // Machine intake (email ingestion, JSON ingest, /v1 API) posts documents to
  // the GL automatically on arrival. OFF = intake documents stay UNCONFIRMED
  // with no journal, waiting in the Posting Queue / bills tab for review.
  enableAutoPostIngest: false,
  // External /v1 API (per-org API keys let outside apps create invoices/bills/
  // credit notes). Keys are managed in the admin org "API Keys" tab; a key only
  // exists if an admin minted one, so this flag is the product-level switch.
  enableExternalApi: false,
  // Activity Log tab on the Audit page: full user-action log (every API call,
  // typed actors — USER / API_KEY / GUEST / "System creation"). Server-side
  // capture is always-on; this flag only gates the viewer tab per org.
  // Default ON for every org, new and existing (guru, 2026-08-23) — an org
  // only loses the tab if an admin explicitly switches it off.
  enableActionLog: true,
  // Accounting → Posting Queue sub-tab (guru 2026-10-24: "posting queue sub tab
  // should be a feature flag as well"). Gates the nav entry + Finance Hub quick
  // action; the page itself stays admin-only. Default OFF; Biofuel ON.
  enablePostingQueue: false,
  // CRM → Marketing: Meta ads insights dashboard (spend/CPC/CPL/watch time,
  // true CPL + ROAS from AIMS leads & signed contracts). Needs a connected
  // Meta ad account (system-user token). Default OFF.
  enableAdsInsights: false,
  // Interior-design quotation editor (CIEL INTERIOR, 2026-08): Sales →
  // Quotation opens the sectioned ID editor (trade sections → areas → work
  // items with includes, internal cost/margin + guardrails, Letter-of-Intent
  // print layout) instead of the generic document editor. Default OFF.
  enableIdQuotation: false,
  // Designer advance requests (guru 2026-10-06): designers ask for money ahead
  // of commission; Senior Management approves. Default OFF.
  enableDesignerAdvances: false,
  // Per-designer appointment calendar + public client booking link (guru
  // 2026-10-08). Default OFF.
  enableAppointmentBooking: false,
  // Operations dashboard (Biofuel, 2026-09-26): the portal landing page shows
  // stock on hand, units in/out, revenue by product over a filterable range,
  // field-service frequency and a fleet map, instead of the generic cards.
  // Default OFF.
  enableOpsDashboard: false,
  // Chat home (guru 2026-10-13): the portal landing page is the AIMS
  // assistant (same brain as the WhatsApp operator), with a Chat/Dashboard
  // toggle in the top bar. Default OFF.
  enableAimsChat: false,
  // Role home (guru 2026-11-06): the portal landing page is the role-based
  // home screen — greeting banner, Due today / Pending, priorities, business
  // overview, quick actions and the assistant, with a "viewing as" role
  // switcher that re-cuts the whole screen. AIMS functions underneath are
  // unchanged; only the home UI differs. Default OFF.
  enableRoleHome: false,
  enableTemplateDesign: false,
  // Spend Money / Receive Money (2026-11-06): direct bank transactions with
  // no invoice behind them (Xero's Spend/Receive Money) under AP / AR.
  // Default OFF; toggle per org in Admin → Configuration → Advanced.
  enableSpendMoney: false,
  // Maintenance Dates (Biofuel, 2026-09): Service Reports -> Maintenance Dates.
  // A maintenance date per asset, which deployed units are done this cycle, and
  // a reminder 7 days before (push to field techs + office bell). Default OFF.
  enableMaintenanceDates: false,
  // Delivery group posts: each delivery sign-off is posted to the project's
  // WhatsApp group (photos + signed DO). Default OFF.
  enableDeliveryGroupPosts: false,
  // Group posts carry every photo (grouped by item, up to 60). Default OFF.
  groupPostAllPhotos: false,
  // Push a document to Xero on confirm, rather than by manual sync. Default OFF.
  enableXeroConfirmSync: false,
  // WCT ERP import (2026-11-05): hold the GL journal of payments / receipts on invoices imported from
  // the previous ERP until the opening AR is booked; Posting Queue → "Post held journals" releases them.
  holdErpImportPaymentGl: false,
  // WCT only (2026-11-05): document lists sort / search on the trigger-kept list keys
  // (api scripts/document-list-keys.js turns it on; --rollback turns it off).
  useDocumentListKeys: false,
  enableBankRecXeroCheckpoint: false,
  // NOTE: the "AIMS Guide" assistant (bottom-right bubble) is deliberately
  // NOT flagged — it's global for every org (guru, 2026-08-03).
  // Trade legacy pages (Declaration / Payments / Stock / Supplier orders) — hidden since round H.
  enableTradeLegacyPages: false,
  // Shipments › Home's pipeline grid — hidden since round K (the Orders list has progress bars).
  enableTradePipelineGrid: false,
  // Shipments › Home page — hidden since round O (Orders is the landing page; tasks in the bell + Orders "Tasks").
  enableShipmentsHome: false,
  // Round AY: due dates per step (Overall process, My tasks, overdue badges) — read by the API; OFF until the owner's go.
  enableStepDueDates: false,
  // LME feed (round AK): daily LME aluminium cash-settlement from Westmetall fills the empty months of the org's
  // LME table (Settings → Shipping). OFF until the owner's go; while off nothing is written ("Fetch now" previews).
  enableLmeFeed: false,
  // SiteClock link (WCT 2026-10-30): the schedule form can put a delivery on a
  // SiteClock worker's schedule (Duration + SiteClock worker), and the run shows
  // its SiteClock state. Also needs the org's SiteClock connection (Admin →
  // organisation → SiteClock). Default OFF.
  enableSiteClockLink: false,
  // SiteClock deliveries (2026-11-06): the worker does the delivery flow inside
  // the SiteClock app on jobs AIMS put on their schedule (needs the SiteClock
  // link). Osiris admins only. Default OFF.
  enableSiteClockDeliveries: false,
  // Jobs calendar (WCT 2026-10-30): the Dashboard opens with a month / week /
  // day calendar of scheduled deliveries, returns, service runs and the org's
  // SiteClock jobs; the usual dashboard sections sit below it. Default OFF.
  enableJobsCalendar: false,
  // Real DO numbers on schedule (WCT 2026-10-30): a scheduled run's DO gets its
  // real number at once; a Pending / Completed / Cancelled tag shows next to it.
  enableRealDoOnSchedule: false,
  // WCT orders (2026-11-01): an accepted quotation makes one Order (ORD…) with
  // its first draft job; the order page lists its jobs and adds more. Default OFF.
  enableWctOrders: false,
  // WCT worker logins (2026-11-01): field app "My jobs"; starting someone
  // else's job asks first. Default OFF.
  enableWctMyJobs: false,
  // WCT finish modes (2026-11-01): stamped-DO photo / paper finish, verified by
  // the office (Deliveries → Awaiting verification). Default OFF.
  enableWctFinishModes: false,
  // WCT invoice per order (2026-11-01): one invoice per order, "Invoice now". Default OFF.
  enableWctOrderInvoice: false,
  // Office-signed delivery orders (2026-11-05): a DO created in the office — no
  // rider, no field app — can be shared for the customer to sign on the link.
  // Default OFF.
  enableOfficeDoSign: false,
  // Supplier credit notes in the Payment Voucher's offset grid.
  enableApCreditOffset: false,
  // Contra set-off: net a customer's invoices against the same company's bills.
  enableContraOffset: false,
  // Custom job fields (2026-11-01): Settings → Job fields; on the schedule form,
  // the delivery page and the jobs calendar. Default OFF.
  enableJobFields: false,
  enableCustomerUen: false,
};

interface OrganizationUIConfig {
  features?: OrganizationFeatures;
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    mode?: string;
  };
  terminology?: Record<string, string>;
  dateFormat?: string;
  timeFormat?: string;
  currency?: string;
  language?: string;
}

export function useOrganizationFeatures() {
  const { getToken } = useAuth();
  const { organization, isLoaded: orgLoaded } = useOrganization();

  const {
    data: uiConfig,
    isLoading,
    error,
  } = useQuery<OrganizationUIConfig>({
    queryKey: ["organizationUIConfig", organization?.id],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !organization?.id) return {};

      const response = await request(
        { path: "/configuration/ui", method: "GET" },
        {},
        token
      );

      if (response.success) {
        return response.data?.uiConfig || response.data || {};
      }
      return {};
    },
    enabled: !!organization?.id && orgLoaded,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const features = uiConfig?.features || {};

  return {
    features,
    uiConfig,
    isLoading: isLoading || !orgLoaded,
    error,
    // Convenience methods for common feature checks
    isAssetTrackingModeEnabled: features.enableAssetTrackingMode ?? false,
    isProjectsEnabled: features.enableProjects ?? true,
    isAnalyticsEnabled: features.enableAnalytics ?? true,
    isEditInventorySkuEnabled: features.enableEditInventorySku ?? false,
    isServiceItemsEnabled: features.enableServiceItems ?? false,
    isFieldScanAppEnabled: features.enableFieldScanApp ?? false,
    isDocumentListViewEnabled: features.enableDocumentListView ?? false,
    isPOAsProjectEnabled: features.enablePOAsProject ?? false,
    isQuotationItemGroupsEnabled: features.enableQuotationItemGroups ?? false,
    isAssetPointsEnabled: features.enableAssetPoints ?? false,
    isItemTaggingEnabled: features.enableItemTagging ?? false,
    isConfirmQuotationEnabled: features.enableConfirmQuotation ?? false,
    isQuotationESignEnabled: features.enableQuotationESign ?? false,
    isQuotationToDeliveryEnabled: features.enableQuotationToDelivery ?? false,
    isSiteClockLinkEnabled: features.enableSiteClockLink ?? false,
    isSiteClockDeliveriesEnabled: features.enableSiteClockDeliveries ?? false,
    isJobsCalendarEnabled: features.enableJobsCalendar ?? false,
    isRealDoOnScheduleEnabled: features.enableRealDoOnSchedule ?? false,
    isWctOrdersEnabled: features.enableWctOrders ?? false,
    isWctMyJobsEnabled: features.enableWctMyJobs ?? false,
    isWctFinishModesEnabled: features.enableWctFinishModes ?? false,
    isWctOrderInvoiceEnabled: features.enableWctOrderInvoice ?? false,
    isJobFieldsEnabled: features.enableJobFields ?? false,
    isOfficeDoSignEnabled: features.enableOfficeDoSign ?? false,
    isContraOffsetEnabled: features.enableContraOffset ?? false,
    isCustomerUenEnabled: features.enableCustomerUen ?? false,
    isRolePresetsEnabled: features.enableRolePresets ?? false,
    isCappitechOrdersEnabled: features.enableCappitechOrders ?? false,
    isNettRoundDownEnabled: features.enableNettRoundDown ?? false,
    isQuotationProjectLinkEnabled: features.enableQuotationProjectLink ?? false,
    isXeroDocSyncEnabled: features.enableXeroDocSync ?? false,
    isLegacyAccountingUxEnabled: features.enableLegacyAccountingUx ?? false,
    isHotkeysEnabled: features.enableHotkeys ?? true,
    isIdQuotationEnabled: features.enableIdQuotation ?? false,
    isDesignerAdvancesEnabled: features.enableDesignerAdvances ?? false,
    isNotificationsEnabled: features.enableNotifications ?? true,
    isBusinessRulesEnabled: features.enableBusinessRules ?? false,
    isPayablesEnabled: features.enablePayables ?? false,
    isAppointmentBookingEnabled: features.enableAppointmentBooking ?? false,
    isAdsInsightsEnabled: features.enableAdsInsights ?? false,
    isPostingQueueEnabled: features.enablePostingQueue ?? false,
    isOpsDashboardEnabled: features.enableOpsDashboard ?? false,
    isAimsChatEnabled: features.enableAimsChat ?? false,
    isRoleHomeEnabled: features.enableRoleHome ?? FEATURE_FLAG_DEFAULTS.enableRoleHome,
    isTemplateDesignEnabled: features.enableTemplateDesign ?? FEATURE_FLAG_DEFAULTS.enableTemplateDesign,
    isSpendMoneyEnabled: features.enableSpendMoney ?? FEATURE_FLAG_DEFAULTS.enableSpendMoney,
    isShipmentsHomeEnabled: features.enableShipmentsHome ?? FEATURE_FLAG_DEFAULTS.enableShipmentsHome,
    isMaintenanceDatesEnabled: features.enableMaintenanceDates ?? false,
    isDeliveryGroupPostsEnabled: features.enableDeliveryGroupPosts ?? false,
  };
}
