/**
 * Template-resolution guard for org bootstrap scripts (setup-adh-org.ts).
 *
 * Document templates are a cross-org pool: an org with no selection and no
 * active template of its own falls back to the NEWEST isDefault template of
 * ANY org (DocumentTemplatesService.getDocumentTemplateByType). Seeding a new
 * org's templates with isDefault: true would therefore silently switch other
 * orgs to them. This module mirrors that chain as a pure function so a script
 * can compare every org's resolved template before vs after its planned
 * writes, and refuse to run when anything but its own org would change.
 */

export interface TemplateRow {
  id: string;
  organizationId: string;
  type: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
}

export interface SelectionRow {
  organizationId: string;
  type: string;
  templateId: string;
  isPrimary: boolean;
}

const newestFirst = (a: TemplateRow, b: TemplateRow) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);

/** The template id the app would resolve for (org, type), or null. Same order as getDocumentTemplateByType. */
export function resolveTemplate(organizationId: string, type: string, templates: TemplateRow[], selections: SelectionRow[]): string | null {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const sels = selections.filter((s) => s.organizationId === organizationId && s.type === type);
  if (sels.length) {
    const primary = sels.find((s) => s.isPrimary);
    if (primary && byId.has(primary.templateId)) return primary.templateId;
    const selected = sels
      .map((s) => byId.get(s.templateId))
      .filter((t): t is TemplateRow => !!t)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || newestFirst(a, b));
    if (selected.length) return selected[0].id;
  }
  const ofType = templates.filter((t) => t.type === type);
  const ownActive = ofType.filter((t) => t.organizationId === organizationId && t.isActive).sort(newestFirst)[0];
  if (ownActive) return ownActive.id;
  const seededDefault = ofType.filter((t) => t.isDefault).sort(newestFirst)[0];
  if (seededDefault) return seededDefault.id;
  // Last resort in the app is an unordered findFirst on the org's own rows; sorted here so before/after compare stably.
  const any = ofType.filter((t) => t.organizationId === organizationId).sort((a, b) => a.id.localeCompare(b.id))[0];
  return any?.id ?? null;
}

export interface ResolutionCell {
  organizationId: string;
  type: string;
  before: string | null;
  after: string | null;
}

export interface TemplatePlanCheck {
  cells: ResolutionCell[];
  /** Human-readable reasons the plan must not run; empty = safe. */
  errors: string[];
}

/**
 * Compare resolution for every org × type before and after `planned` rows are
 * added. Errors when a planned row is isDefault, when any org other than
 * `ownOrgId` resolves differently, or when the own org doesn't end up on one
 * of its own templates.
 */
export function checkTemplatePlan(input: {
  ownOrgId: string;
  orgIds: string[];
  types: string[];
  templates: TemplateRow[];
  selections: SelectionRow[];
  planned: TemplateRow[];
}): TemplatePlanCheck {
  const { ownOrgId, types, templates, selections, planned } = input;
  const errors: string[] = [];
  for (const p of planned) {
    if (p.isDefault) errors.push(`planned ${p.type} template sets isDefault: true (would become the cross-org fallback)`);
    if (p.organizationId !== ownOrgId) errors.push(`planned ${p.type} template belongs to another org (${p.organizationId})`);
  }
  const after = [...templates, ...planned];
  const orgIds = [...new Set([...input.orgIds, ownOrgId])];
  const cells: ResolutionCell[] = [];
  for (const organizationId of orgIds) {
    for (const type of types) {
      const cell = { organizationId, type, before: resolveTemplate(organizationId, type, templates, selections), after: resolveTemplate(organizationId, type, after, selections) };
      cells.push(cell);
      if (organizationId !== ownOrgId && cell.before !== cell.after) {
        errors.push(`${type} for org ${organizationId} would change: ${cell.before ?? 'none'} → ${cell.after ?? 'none'}`);
      }
      if (organizationId === ownOrgId && planned.some((p) => p.type === type)) {
        const owner = after.find((t) => t.id === cell.after)?.organizationId;
        if (owner !== ownOrgId) errors.push(`${type} for the new org would not resolve to its own template`);
      }
    }
  }
  return { cells, errors };
}
