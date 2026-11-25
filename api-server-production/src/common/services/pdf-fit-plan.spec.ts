import { planFit } from './pdf-generator.service';

// Server fit-to-page (signed DO PDF) mirrors portal lib/printScale.ts (DO202611114, 2026-11-25).
describe('planFit', () => {
  it('fits already: nothing to do', () => {
    expect(planFit(200, 285, false)).toBeNull();
    expect(planFit(200, 285, true)).toBeNull();
  });
  it('default sheets (every other org): unchanged, floor 0.7', () => {
    expect(planFit(470.7, 285, false)).toEqual({ scale: 0.7, needed: 0.605 });
    expect(planFit(300, 285, false)).toEqual({ scale: 0.95, needed: 0.95 });
  });
  it('Biofuel flow layout: tall DO is not shrunk (prints across pages)', () => {
    expect(planFit(470.7, 285, true)).toBeNull();
    expect(planFit(402.4, 285, true)).toBeNull();
  });
  it('Biofuel flow layout: mild shrink when it fits one page', () => {
    expect(planFit(300, 285, true)).toEqual({ scale: 0.95, needed: 0.95 });
  });
});
