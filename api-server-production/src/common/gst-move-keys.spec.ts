import { readFileSync } from 'fs';
import { join } from 'path';
import { GST_MOVE_KEYS, withoutGstMove } from './gst-move-keys';

// Fix batch 2026-11-25b: a duplicate / a document made from a moved one is new (no "Previously <no.>"); WCT invoices
// and DOs made from another document take their own type's terms.
describe('GST move markers never carry to a new document', () => {
  it('strips previousNumber, movedFrom and gstMove (top level and documentInfo), keeps the rest', () => {
    const src = { previousNumber: 'QOB202611-0004', movedFrom: [{ number: 'QOB202611-0004' }], gstMove: { x: 1 }, subject: 'S', documentInfo: { previousNumber: 'X', date: '2026-11-25' } };
    const out: any = withoutGstMove(src);
    for (const k of GST_MOVE_KEYS) expect(out[k]).toBeUndefined();
    expect(out.documentInfo).toEqual({ date: '2026-11-25' });
    expect(out.subject).toBe('S');
    expect(src.previousNumber).toBe('QOB202611-0004'); // the source is not mutated
  });

  it('null / undefined pass through', () => {
    expect(withoutGstMove(null)).toBeNull();
    expect(withoutGstMove(undefined)).toBeUndefined();
  });

  it('wired: createBasicDocument strips unless keepGstMove (only the GST switch credit note), duplicate strips and keeps terms', () => {
    const svc = readFileSync(join(__dirname, '..', 'documents', 'documents.service.ts'), 'utf8');
    expect(svc).toMatch(/if \(!opts\.keepGstMove\) config = withoutGstMove\(config\)/);
    expect(svc).toMatch(/for \(const k of GST_MOVE_KEYS\) delete duplicatedConfig\[k\]/);
    expect(svc).toMatch(/\{ keepTerms: true \}/);
    expect(svc).toMatch(/OWN_TERMS_TYPES\.has\(String\(type\)\.toUpperCase\(\)\)/);
    const gs = readFileSync(join(__dirname, '..', 'gst-switch', 'gst-switch.service.ts'), 'utf8');
    expect(gs).toMatch(/keepGstMove: true/);
  });
});
