/**
 * Config keys the GST switch (gst-switch/) stamps on a moved document: "Previously <no.>", the move history and the
 * credit / re-issue links. They belong to that one document; a duplicate or a document made from it is new and never
 * carries them (WCT group, 2026-11-25).
 */
export const GST_MOVE_KEYS = ['previousNumber', 'movedFrom', 'gstMove'] as const;

/** A copy of `config` without the GST move markers (top level and documentInfo). */
export function withoutGstMove<T extends Record<string, any> | null | undefined>(config: T): T {
  if (!config || typeof config !== 'object') return config;
  const c: any = { ...config };
  for (const k of GST_MOVE_KEYS) delete c[k];
  if (c.documentInfo && typeof c.documentInfo === 'object') {
    const di = { ...c.documentInfo };
    for (const k of GST_MOVE_KEYS) delete di[k];
    c.documentInfo = di;
  }
  return c;
}
