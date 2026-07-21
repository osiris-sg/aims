// Plain interfaces (ingestion-module style) — the global ValidationPipe runs
// without a whitelist, so shape checks are done in the service.

// What the portal sends after the Embedded Signup popup completes: the
// one-time auth code from FB.login's callback plus the WABA / phone-number IDs
// captured from the WA_EMBEDDED_SIGNUP postMessage event.
export interface OnboardDto {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  // True when the number came through the Coexistence flow (featureType
  // whatsapp_business_app_onboarding): the WhatsApp Business app keeps the
  // number, so Cloud API phone registration must be SKIPPED.
  coexistence?: boolean;
}

export interface SendTemplateDto {
  to: string; // E.164, digits only is fine (e.g. 6591234567)
  templateName: string;
  languageCode?: string; // defaults to en_US
  // Cloud API template components (body params etc.), passed through verbatim.
  components?: Array<Record<string, any>>;
}

export interface SendTextDto {
  to: string;
  body: string;
}
