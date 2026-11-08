import { nameFromReply } from './leads.service';

// The second message on a bridged line decides whether the lead gets a name
// or keeps its phone number as a label. Getting this wrong is visible to Mike
// on every card, so the judgement is pinned down here.
describe('nameFromReply', () => {
  it('takes a bare name', () => {
    expect(nameFromReply('Jasmine')).toBe('Jasmine');
    expect(nameFromReply('Jasmine Tan')).toBe('Jasmine Tan');
  });

  it('strips the lead-in people actually type', () => {
    expect(nameFromReply('Hi, my name is Jasmine')).toBe('Jasmine');
    expect(nameFromReply("I'm Jasmine Tan")).toBe('Jasmine Tan');
    expect(nameFromReply('this is Mike.')).toBe('Mike');
    expect(nameFromReply('Name: Siti')).toBe('Siti');
  });

  it('keeps names that are not plain ASCII', () => {
    expect(nameFromReply('Nurul A’isyah')).toBe('Nurul A’isyah');
    expect(nameFromReply('陈美玲')).toBe('陈美玲');
  });

  it('refuses an enquiry', () => {
    expect(nameFromReply('I want to redo my kitchen')).toBeNull();
    expect(nameFromReply('how much for a 4 room hdb?')).toBeNull();
    expect(nameFromReply('can you call me')).toBeNull();
  });

  it('refuses anything with digits, and empty input', () => {
    expect(nameFromReply('91151041')).toBeNull();
    expect(nameFromReply('Unit 5 Jurong')).toBeNull();
    expect(nameFromReply('')).toBeNull();
    expect(nameFromReply(null)).toBeNull();
  });
});
