/** Month-end recurrence must not skip short months (31 Jan -> 28 Feb, not 3 Mar). */
function nextMonthly(from: Date, anchorDay?: number): Date {
  const d = new Date(from);
  const day = anchorDay || d.getUTCDate();
  const target = new Date(d);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  target.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), 0, 0);
  return target;
}

// Jerry is "every 31st" — walk a year and confirm it lands on month-end each time.
let d = new Date(Date.UTC(2026, 7, 31, 1, 0)); // 31 Aug 2026, 09:00 SGT
console.log('Jerry (31st) across a year:');
for (let i = 0; i < 8; i++) {
  d = nextMonthly(d, 31);
  console.log('  ' + d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
}

// A normal day-of-month should stay put.
let c = new Date(Date.UTC(2026, 8, 2, 1, 0)); // 2 Sept
console.log('\nClaire (2nd):');
for (let i = 0; i < 3; i++) {
  c = nextMonthly(c, 2);
  console.log('  ' + c.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
}
