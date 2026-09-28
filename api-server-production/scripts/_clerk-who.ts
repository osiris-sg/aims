/** Resolve Clerk user ids to names/emails. Read-only. */
const IDS = process.argv.slice(2).filter((a) => a.startsWith('user_'));
(async () => {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error('CLERK_SECRET_KEY not set in the loaded env');
  for (const id of IDS) {
    const r = await fetch(`https://api.clerk.com/v1/users/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { console.log(`${id}  -> ${r.status} ${j?.errors?.[0]?.message || ''}`); continue; }
    const email = (j.email_addresses || []).find((e: any) => e.id === j.primary_email_address_id)?.email_address
      || j.email_addresses?.[0]?.email_address || '-';
    const phone = (j.phone_numbers || [])[0]?.phone_number || '';
    console.log(`${id}`);
    console.log(`   ${[j.first_name, j.last_name].filter(Boolean).join(' ') || j.username || '(no name)'}   ${email}${phone ? '   ' + phone : ''}`);
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
