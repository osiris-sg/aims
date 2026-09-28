-- 80 · After every org copy + FK step succeeded: move the global tables to "platform". Metadata only.
BEGIN;
CREATE SCHEMA IF NOT EXISTS platform;
ALTER TABLE public."Organization" SET SCHEMA platform;
ALTER TABLE public."UserOrganization" SET SCHEMA platform;
ALTER TABLE public."OrganizationModule" SET SCHEMA platform;
ALTER TABLE public."OrganizationUIConfig" SET SCHEMA platform;
ALTER TABLE public."ApiKey" SET SCHEMA platform;
ALTER TABLE public."DocumentTemplate" SET SCHEMA platform;
ALTER TABLE public."OrganizationActiveTemplate" SET SCHEMA platform;
ALTER TABLE public."OrganizationMemberProfile" SET SCHEMA platform;
ALTER TABLE public."DeviceToken" SET SCHEMA platform;
ALTER TABLE public."WhatsAppConnection" SET SCHEMA platform;
ALTER TABLE public."WhatsAppWebhookEvent" SET SCHEMA platform;
ALTER TABLE public."OperatorIdentity" SET SCHEMA platform;
ALTER TABLE public."OperatorLinkCode" SET SCHEMA platform;
ALTER TABLE public."OperatorSession" SET SCHEMA platform;
ALTER TABLE public."ActionLog" SET SCHEMA platform;
COMMIT;
