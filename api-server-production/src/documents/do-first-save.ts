/**
 * DO first (manual order flow, 2026-11-13): the editor's save-time stock block
 * (every DO row must name a unit; each unit set to rental on every save) does
 * not apply to a DO on an order: it carries service lines and product rows
 * without a unit, and moves stock only through Complete DO (or its job).
 */
export function skipsDoSaveStockRule(type: string | null | undefined, orderId: unknown, manualFlow: boolean): boolean {
  return manualFlow && ['DO', 'DELIVERY_ORDER'].includes(String(type || '').toUpperCase()) && typeof orderId === 'string' && orderId.length > 0;
}
