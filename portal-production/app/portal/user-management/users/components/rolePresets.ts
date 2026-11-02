// Role presets shown in User Management (moved out of the old Add user drawer, 2026-11-02).

// Preset-role orgs (guru 2026-10-27): the client picks ONE built-in role and
// never sees permissions. Presets are told apart by their stored description
// prefix; 'field-tech' keeps its name (the app keys on it) but reads as
// "Technician (field app)".
const PRESET_PREFIX = "Preset · ";
// Round AZ: the label text is users.form.fieldTech (English unchanged).
const PRESET_LABEL: Record<string, string> = { "field-tech": "fieldTech" };
export const presetLabel = (r: { name: string; description?: string | null }, t: (key: string) => string) => (PRESET_LABEL[r.name] ? t(PRESET_LABEL[r.name]) : r.name);
const presetSummary = (r: { description?: string | null }) => {
  const d = String(r.description ?? "");
  const i = d.indexOf(" — ");
  return d.startsWith(PRESET_PREFIX) && i > 0 ? d.slice(i + 3) : d;
};
export const isPresetRole = (r: { name: string; description?: string | null }) => r.name !== "superadmin" && String(r.description ?? "").startsWith(PRESET_PREFIX);
