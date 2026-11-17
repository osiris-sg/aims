// Customer UEN as saved (task D, 2026-11-17): trimmed, upper case, blank ->
// null. Only touches the key when the caller sent it (the enableCustomerUen
// forms); a payload without `uen` (every other org's forms) passes through
// unchanged.
export function normalizeUenInput<T extends { uen?: string | null }>(data: T): T {
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'uen')) return data;
  const raw = data.uen;
  const v = typeof raw === 'string' ? raw.trim().toUpperCase() : raw;
  return { ...data, uen: v ? v : null };
}
