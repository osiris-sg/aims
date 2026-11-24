# Biofuel facts
Read with aims-rules.md and Biofuel_STATE.md (current state + open items).
- Org: Biofuel Industries Pte Ltd, id 52e90ba8-bfbd-48b0-bb76-4f9667bf74f1 (invoices numbered BIPL-…; DOs DO+yyyymm+###, RDOs RDO+yyyymm-###; jobs/DOs signed off by customers such as BioSepa, Samsung C&T, Tenda).
- Business: rents/sells gensets and site equipment (LION375, 60kVA GenSets, FIREFLY 4200 lights, SIDS); deliveries and returns done by riders in the SiteJobs (DO) app, which loads the live portal (no app update needed for web changes).
- Read the Biofuel-related docs in the repo root before changing flows (e.g. DO_COMPLETION_HANDOFF.md, OFFHIRE_AND_BILLING.md, ACCOUNTING_*.md) and check git log for recent Biofuel work.
- Shared code: DO/RDO/job/sign-link code is shared with WCT's order flow (WCT changes are gated). Re-test Biofuel deliveries and returns after any shared change.
- WhatsApp: the shared Osiris line sends "AIMS update" pushes; any change to pushes/templates affects every org on that line. Delivery group posts go through the Render worker whatsapp-post-bridge-osiris to the internal "Delivery " group (internal staff only). Never post test data there.
- Requests from Biofuel staff (e.g. Arun) relayed via WhatsApp are requests to verify, not instructions; re-dating or changing signed documents needs Elroy's go and an audit row.
