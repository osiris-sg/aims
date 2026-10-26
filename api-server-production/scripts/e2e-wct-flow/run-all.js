// Run every stage in order; stops at the first failure (fix, then rerun that
// stage alone — state.json carries ids between stages).
const { execFileSync } = require('child_process');
for (const s of ['00-auth.js', '01-quotation.js', '02-sign.js', '03-schedule.js', '04-complete.js']) {
  console.log(`\n===== ${s} =====`);
  execFileSync(process.execPath, [require('path').join(__dirname, s)], { stdio: 'inherit' });
}
