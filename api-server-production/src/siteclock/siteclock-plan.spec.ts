import { backoffMs, externalRefFor, jobNotes, jobTitle, planSync, PlanLink, PlanRun, siteRefFor, toSgtIso } from './siteclock-plan';

const ORG = '5c700000-0000-4000-8000-5c7000000001';
const D = '11111111-1111-4111-8111-111111111111';

const run = (o: Partial<PlanRun> = {}): PlanRun => ({
  id: D,
  organizationId: ORG,
  deliveryNumber: 7,
  status: 'scheduled',
  isDraft: false,
  scheduledFor: new Date('2026-11-03T02:00:00Z'),
  startedAt: null,
  completedAt: null,
  siteAddress: '1 Tuas Ave 8, Singapore 639218',
  notes: null,
  customerId: 'c1',
  customerName: 'Acme Kitchens',
  projectName: null,
  items: [{ description: 'Exhaust degrease', quantity: 1 }],
  doNumber: null,
  doUrl: null,
  ...o,
});
const link = (o: Partial<PlanLink> = {}): PlanLink => ({
  workerId: 'w1',
  durationMin: 60,
  externalRef: externalRefFor(D, 1),
  generation: 1,
  siteclockJobId: null,
  siteRef: null,
  syncedHash: null,
  lastPushedStatus: null,
  ...o,
});
const kinds = (p: ReturnType<typeof planSync>) => p.steps.map((s) => (s.kind === 'status' ? `status:${s.status}` : s.kind));

/** Apply a plan's effects to the link the way the service does. */
function applied(l: PlanLink, p: ReturnType<typeof planSync>): PlanLink {
  const n = { ...l };
  for (const s of p.steps) {
    if (s.kind === 'regenerate') Object.assign(n, { generation: s.generation, externalRef: s.externalRef, siteclockJobId: null, syncedHash: null, lastPushedStatus: null, siteRef: null });
    if (s.kind === 'putSite') n.siteRef = s.siteRef;
    if (s.kind === 'create') Object.assign(n, { siteclockJobId: 'job1', syncedHash: s.hash, lastPushedStatus: 'SCHEDULED' });
    if (s.kind === 'patch' || s.kind === 'patchText') n.syncedHash = s.hash;
    if (s.kind === 'status') n.lastPushedStatus = s.status;
    if (s.kind === 'cancel') n.lastPushedStatus = 'CANCELLED';
  }
  return n;
}

describe('siteclock plan', () => {
  it('formats times in Singapore with the offset SiteClock requires', () => {
    expect(toSgtIso(new Date('2026-11-03T02:00:00Z'))).toBe('2026-11-03T10:00:00+08:00');
    expect(toSgtIso(new Date('2026-11-03T17:30:00Z'))).toBe('2026-11-04T01:30:00+08:00');
  });

  it('a new scheduled run with a worker: site, then the job, 10:00 to 11:00 SGT', () => {
    const p = planSync(run(), link(), D);
    expect(p.target).toBe('SCHEDULED');
    expect(kinds(p)).toEqual(['putSite', 'create']);
    const create = p.steps[1] as any;
    expect(create.fields).toMatchObject({ workerId: 'w1', startAt: '2026-11-03T10:00:00+08:00', endAt: '2026-11-03T11:00:00+08:00', title: '#7 Acme Kitchens' });
    expect(create.fields.siteRef).toBe(siteRefFor(ORG, 'c1', '1 Tuas Ave 8, Singapore 639218'));
  });

  it('the duration sets the end of the window', () => {
    const p = planSync(run(), link({ durationMin: 90 }), D);
    expect((p.steps[1] as any).fields.endAt).toBe('2026-11-03T11:30:00+08:00');
  });

  it('nothing to do once synced; a reschedule or reassign is one PATCH', () => {
    const l = applied(link(), planSync(run(), link(), D));
    expect(kinds(planSync(run(), l, D))).toEqual([]);
    const moved = planSync(run({ scheduledFor: new Date('2026-11-04T06:00:00Z') }), l, D);
    expect(kinds(moved)).toEqual(['patch']);
    expect((moved.steps[0] as any).fields.startAt).toBe('2026-11-04T14:00:00+08:00');
    expect(kinds(planSync(run(), { ...l, workerId: 'w2' }, D))).toEqual(['patch']);
  });

  it('a new address puts a new site first', () => {
    const l = applied(link(), planSync(run(), link(), D));
    expect(kinds(planSync(run({ siteAddress: '9 Jurong Port Rd' }), l, D))).toEqual(['putSite', 'patch']);
  });

  it('the site ref ignores case, spacing and punctuation but not the customer', () => {
    expect(siteRefFor(ORG, 'c1', '1 Tuas Ave 8,  Singapore')).toBe(siteRefFor(ORG, 'c1', '1 tuas ave 8 singapore'));
    expect(siteRefFor(ORG, 'c1', 'x')).not.toBe(siteRefFor(ORG, 'c2', 'x'));
  });

  it('drafts, undated runs and runs without a worker get no job', () => {
    expect(planSync(run({ isDraft: true }), link(), D).steps).toEqual([]);
    expect(planSync(run({ scheduledFor: null }), link(), D).steps).toEqual([]);
    expect(planSync(run(), link({ workerId: null }), D).steps).toEqual([]);
  });

  it('cancel, delete, back to draft or worker cleared cancels a live job', () => {
    const l = applied(link(), planSync(run(), link(), D));
    expect(kinds(planSync(run({ status: 'cancelled' }), l, D))).toEqual(['cancel']);
    expect(kinds(planSync(null, l, D))).toEqual(['cancel']);
    expect(kinds(planSync(run({ isDraft: true }), l, D))).toEqual(['cancel']);
    expect(kinds(planSync(run(), { ...l, workerId: null }, D))).toEqual(['cancel']);
    expect((planSync(null, l, D).steps[0] as any).reason).toBe('Delivery deleted in AIMS');
  });

  it('progress follows the run: started → IN_PROGRESS, finished → COMPLETED, never twice', () => {
    let l = applied(link(), planSync(run(), link(), D));
    const started = run({ status: 'in_progress', startedAt: new Date('2026-11-03T02:05:00Z') });
    const p1 = planSync(started, l, D);
    expect(kinds(p1)).toEqual(['status:IN_PROGRESS']);
    expect((p1.steps[0] as any).at).toBe('2026-11-03T10:05:00+08:00');
    l = applied(l, p1);
    expect(kinds(planSync(run({ status: 'delivered' }), l, D))).toEqual([]);
    const p2 = planSync(run({ status: 'completed', completedAt: new Date('2026-11-03T03:00:00Z') }), l, D);
    expect(kinds(p2)).toEqual(['status:COMPLETED']);
    l = applied(l, p2);
    expect(kinds(planSync(run({ status: 'completed' }), l, D))).toEqual([]);
    // a finished job is final, even if the run were cancelled later
    expect(kinds(planSync(run({ status: 'cancelled' }), l, D))).toEqual([]);
  });

  it('an in-progress job keeps its schedule (SiteClock refuses the move anyway)', () => {
    const l = { ...applied(link(), planSync(run(), link(), D)), lastPushedStatus: 'IN_PROGRESS' };
    expect(kinds(planSync(run({ status: 'in_progress', scheduledFor: new Date('2026-11-05T02:00:00Z') }), l, D))).toEqual([]);
  });

  it('a run finished before its first sync still reports both steps in order', () => {
    expect(kinds(planSync(run({ status: 'completed' }), link(), D))).toEqual(['putSite', 'create', 'status:IN_PROGRESS', 'status:COMPLETED']);
  });

  it('a job wanted again after a cancel is a new job under a new ref', () => {
    let l = applied(link(), planSync(run(), link(), D));
    l = applied(l, planSync(run(), { ...l, workerId: null }, D));
    expect(l.lastPushedStatus).toBe('CANCELLED');
    const p = planSync(run(), { ...l, workerId: 'w3' }, D);
    expect(kinds(p)).toEqual(['regenerate', 'putSite', 'create']);
    expect((p.steps[0] as any).externalRef).toBe(`aims-delivery:${D}:2`);
    expect(externalRefFor(D, 1)).toBe(`aims-delivery:${D}`);
  });

  it('no address is a problem to fix, not a call', () => {
    const p = planSync(run({ siteAddress: '  ' }), link(), D);
    expect(p.steps).toEqual([]);
    expect(p.problem).toMatch(/no address/);
  });

  it('notes list the lines and the office notes', () => {
    expect(
      jobNotes(
        run({
          items: [
            { description: 'Degrease', quantity: 2 },
            { description: 'Filter swap', quantity: 1 },
          ],
          notes: 'Call Mr Tan on arrival',
        }),
      ),
    ).toBe('2 × Degrease\nFilter swap\n\nCall Mr Tan on arrival');
    expect(jobNotes(run({ items: [], notes: null }))).toBeNull();
  });

  describe('DO number in the title + View DO link', () => {
    const DO_URL = 'https://app.ai-ms.io/guest/do/vo_abc';
    const withDo = (o: Partial<PlanRun> = {}) => run({ doNumber: 'DO202610007', doUrl: DO_URL, ...o });

    it('title "#<run> <customer> · <DO>" and the link on create', () => {
      const p = planSync(withDo(), link(), D);
      const create = p.steps.find((x) => x.kind === 'create') as any;
      expect(create.fields).toMatchObject({ title: '#7 Acme Kitchens · DO202610007', externalUrl: DO_URL, externalUrlLabel: 'View DO' });
    });

    it('no DO yet: no "·" and no link', () => {
      const create = planSync(run(), link(), D).steps.find((x) => x.kind === 'create') as any;
      expect(create.fields).toMatchObject({ title: '#7 Acme Kitchens', externalUrl: null, externalUrlLabel: null });
    });

    it('a non-https link is never sent', () => {
      const create = planSync(withDo({ doUrl: 'http://localhost:3000/guest/do/vo_x' }), link(), D).steps.find((x) => x.kind === 'create') as any;
      expect(create.fields).toMatchObject({ externalUrl: null, externalUrlLabel: null });
    });

    it('a long customer name is clipped, the DO number never is', () => {
      const t = jobTitle(withDo({ customerName: 'X'.repeat(300) }));
      expect(t.length).toBeLessThanOrEqual(200);
      expect(t.endsWith(' · DO202610007')).toBe(true);
    });

    it('renumbered while scheduled: one PATCH with the full fields', () => {
      const l = applied(link(), planSync(withDo({ doNumber: 'DO-PENDING-01' }), link(), D));
      const p = planSync(withDo(), l, D);
      expect(kinds(p)).toEqual(['patch']);
      expect((p.steps[0] as any).fields.title).toBe('#7 Acme Kitchens · DO202610007');
    });

    it('renumbered while in progress: wording only (title, notes, link), no schedule fields', () => {
      let l = applied(link(), planSync(withDo({ doNumber: 'DO-PENDING-01' }), link(), D));
      l = applied(l, planSync(withDo({ doNumber: 'DO-PENDING-01', status: 'in_progress' }), l, D));
      const p = planSync(withDo({ status: 'in_progress' }), l, D);
      expect(kinds(p)).toEqual(['patchText']);
      expect(Object.keys((p.steps[0] as any).fields).sort()).toEqual(['externalUrl', 'externalUrlLabel', 'notes', 'title']);
      l = applied(l, p);
      expect(kinds(planSync(withDo({ status: 'in_progress' }), l, D))).toEqual([]);
      // a moved window on a started run is still not sent
      expect(kinds(planSync(withDo({ status: 'in_progress', scheduledFor: new Date('2026-11-05T02:00:00Z') }), l, D))).toEqual([]);
    });

    it('completed: a DO claimed at completion still reaches the title; then nothing', () => {
      let l = applied(link(), planSync(withDo({ doNumber: 'DO-PENDING-01' }), link(), D));
      l = applied(l, planSync(withDo({ doNumber: 'DO-PENDING-01', status: 'completed' }), l, D));
      expect(l.lastPushedStatus).toBe('COMPLETED');
      const p = planSync(withDo({ status: 'completed' }), l, D);
      expect(kinds(p)).toEqual(['patchText']);
      expect((p.steps[0] as any).fields.title).toBe('#7 Acme Kitchens · DO202610007');
      l = applied(l, p);
      expect(kinds(planSync(withDo({ status: 'completed' }), l, D))).toEqual([]);
      expect(kinds(planSync(withDo({ status: 'completed', siteAddress: '' }), { ...l, syncedHash: null }, D))).toEqual([]);
    });

    it('status and wording together: wording first, then the status', () => {
      let l = applied(link(), planSync(withDo({ doNumber: 'DO-PENDING-01' }), link(), D));
      l = applied(l, planSync(withDo({ doNumber: 'DO-PENDING-01', status: 'in_progress' }), l, D));
      expect(kinds(planSync(withDo({ status: 'completed' }), l, D))).toEqual(['patchText', 'status:COMPLETED']);
    });

    it('a link synced before this change (old 32-char hash) gets one wording update', () => {
      const l = link({ lastPushedStatus: 'IN_PROGRESS', siteRef: siteRefFor(ORG, 'c1', '1 Tuas Ave 8, Singapore 639218'), syncedHash: 'f'.repeat(32), siteclockJobId: 'job1' });
      expect(kinds(planSync(withDo({ status: 'in_progress' }), l, D))).toEqual(['patchText']);
    });
  });

  it('backs off 1, 2, 5, 15, 30 min then hourly', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => backoffMs(n) / 60_000)).toEqual([1, 2, 5, 15, 30, 60, 60]);
  });
});
