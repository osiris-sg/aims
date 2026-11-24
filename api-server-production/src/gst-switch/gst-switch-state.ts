import { groupOrgIds } from '../organizations/org-group';
import { GstSwitchState, gstSwitchStateOf, SwitchOrg } from './gst-switch';

/** The org's GST switch (gst-switch.ts gstSwitchStateOf) read from its group. Outside a group: off. Never throws. */
export async function gstSwitchFor(prisma: any, orgId: string): Promise<GstSwitchState> {
  const off: GstSwitchState = { on: false, gst: true, partner: null };
  try {
    const ids = await groupOrgIds(prisma, orgId);
    if (!ids.length) return off;
    const [orgs, uis] = await Promise.all([
      prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, parentOrgId: true } }),
      prisma.organizationUIConfig.findMany({ where: { organizationId: { in: ids } }, select: { organizationId: true, features: true } }),
    ]);
    const f = new Map<string, any>(uis.map((u: any) => [u.organizationId, u.features]));
    const group: SwitchOrg[] = orgs.map((o: any) => ({ id: o.id, name: o.name ?? '', parentOrgId: o.parentOrgId ?? null, features: f.get(o.id) ?? null }));
    return gstSwitchStateOf(orgId, group);
  } catch {
    return off;
  }
}
