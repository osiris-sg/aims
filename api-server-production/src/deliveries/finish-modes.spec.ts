import { awaitsVerification, finishModeProblem, initialVerification, isCompletionMode, isVerifiedJob } from './finish-modes';

describe('WCT finish modes', () => {
  it('signature: required as always, flag or not', () => {
    expect(finishModeProblem({ mode: 'signature', flagOn: false, partial: false })).toBe('Customer signature is required');
    expect(finishModeProblem({ mode: 'signature', flagOn: true, signature: 'data:x', partial: true })).toBeNull();
  });

  it('stamped DO / paper: only with the flag, only for a full finish; a stamped DO needs its photo', () => {
    expect(finishModeProblem({ mode: 'paper', flagOn: false, partial: false })).toMatch(/not enabled/);
    expect(finishModeProblem({ mode: 'paper', flagOn: true, partial: true })).toMatch(/Only a customer signature/);
    expect(finishModeProblem({ mode: 'paper', flagOn: true, partial: false })).toBeNull();
    expect(finishModeProblem({ mode: 'stamped_do', flagOn: true, photos: [' '], partial: false })).toMatch(/photo of the stamped DO/);
    expect(finishModeProblem({ mode: 'stamped_do', flagOn: true, photos: ['k.jpg'], partial: false })).toBeNull();
  });

  it('a signature is verified at once; the others wait', () => {
    const at = new Date('2026-11-01T00:00:00Z');
    expect(initialVerification('signature', at)).toEqual({ verificationState: 'verified', verifiedAt: at, verifiedByUserId: null, verifiedByName: 'Customer signature' });
    expect(initialVerification('stamped_do').verificationState).toBe('pending');
    expect(initialVerification('paper').verificationState).toBe('pending');
  });

  it('verified = completed and checked (or finished before verification existed)', () => {
    expect(isVerifiedJob({ status: 'completed', verificationState: null })).toBe(true);
    expect(isVerifiedJob({ status: 'completed', verificationState: 'verified' })).toBe(true);
    expect(isVerifiedJob({ status: 'completed', verificationState: 'pending' })).toBe(false);
    expect(isVerifiedJob({ status: 'in_progress', verificationState: 'verified' })).toBe(false);
    expect(awaitsVerification({ status: 'completed', verificationState: 'rejected' })).toBe(true);
    expect(awaitsVerification({ status: 'completed', verificationState: null })).toBe(false);
  });
});

describe('sign_link (SiteClock "Skip", 2026-11-11)', () => {
  it('is a completion mode that waits for verification, behind the flag, never partial', () => {
    expect(isCompletionMode('sign_link')).toBe(true);
    expect(initialVerification('sign_link').verificationState).toBe('pending');
    expect(finishModeProblem({ mode: 'sign_link', flagOn: true, partial: false })).toBeNull();
    expect(finishModeProblem({ mode: 'sign_link', flagOn: false, partial: false })).toMatch(/not enabled/);
    expect(finishModeProblem({ mode: 'sign_link', flagOn: true, partial: true })).toMatch(/Only a customer signature/);
  });
});
