// Org-level feature flags live in OrganizationUIConfig.features (same JSON the
// portal admin panel toggles). Backend readers use this helper.

export const AUTO_POST_INGEST_FLAG = 'enableAutoPostIngest';

// Uploading a supplier invoice to the chat agent files it as a PROJECT COST.
// That is the ID-firm workflow (CIEL), not something every org wants: an org
// that does not run project costing was being asked to confirm a cost it has
// no use for (guru 2026-10-04).
export const CHAT_UPLOAD_PROJECT_COST_FLAG = 'enableChatUploadProjectCost';

export async function isOrgFeatureEnabled(
  prisma: { organizationUIConfig: { findUnique: (args: any) => Promise<any> } },
  organizationId: string,
  key: string,
): Promise<boolean> {
  const ui = await prisma.organizationUIConfig.findUnique({
    where: { organizationId },
    select: { features: true },
  });
  return ((ui?.features as any) || {})[key] === true;
}
