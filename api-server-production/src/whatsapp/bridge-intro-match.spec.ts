import { sameMessage } from './whatsapp.service';

// The intro leaving the line is what turns a conversation into a lead, so a
// near-miss must FAIL rather than open a lead for the wrong person.
describe('sameMessage (bridge lead intro)', () => {
  const INTRO = 'Hi! Please let us know how we can help you.';

  it('matches the intro as sent', () => {
    expect(sameMessage(INTRO, INTRO)).toBe(true);
  });

  it('survives the ways the same text reaches us', () => {
    expect(sameMessage('  Hi! Please let us know how we can help you.  ', INTRO)).toBe(true);
    expect(sameMessage('hi! please let us know how we can help you.', INTRO)).toBe(true);
    expect(sameMessage('Hi! Please let us know  how we can help you.', INTRO)).toBe(true);
    expect(sameMessage('Hi! Please let us know how we can help you.'.replace("'", '’'), INTRO)).toBe(true);
  });

  it('refuses a different message', () => {
    expect(sameMessage('Hi! How can we help?', INTRO)).toBe(false);
    expect(sameMessage('Hi! Please let us know how we can help you. Our office is closed.', INTRO)).toBe(false);
    expect(sameMessage('Noted, our designer will call you', INTRO)).toBe(false);
  });

  it('never matches on emptiness', () => {
    expect(sameMessage('', INTRO)).toBe(false);
    expect(sameMessage(null, INTRO)).toBe(false);
    expect(sameMessage('   ', '')).toBe(false);
  });
});
