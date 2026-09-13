import { PrismaClient } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
const p = new PrismaClient();
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const CIEL = '09e55c23-e031-4254-8152-a373597b2cb3';
const OSIRIS = 'd068f159-e45a-4da8-beaf-62e903f44141';
const LEAD_ID = '96376950-cae7-43ac-a29c-935ecf85812a';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const line: any = await p.whatsAppConnection.findFirst({ where: { organizationId: OSIRIS, status: 'CONNECTED' } });
  const send = async (to: string, payload: any, body: string) => {
    const res = await fetch(`https://graph.facebook.com/v23.0/${line.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${line.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
    });
    const j: any = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(j?.error || j));
    await p.whatsAppMessage
      .create({ data: { organizationId: OSIRIS, direction: 'OUTBOUND', counterparty: to, phoneNumberId: line.phoneNumberId, waMessageId: j?.messages?.[0]?.id || null, body, status: 'sent', payload } })
      .catch(() => null);
  };

  const lead: any = await p.lead.findUnique({ where: { id: LEAD_ID } });
  const roles = await p.userRole.findMany({ where: { organizationId: CIEL, isActive: true, role: { name: 'Designer' } }, select: { userId: true } });
  const designers: any[] = [];
  for (const id of [...new Set(roles.map((r) => r.userId))]) {
    const u = await clerk.users.getUser(id).catch(() => null);
    const prof = await p.organizationMemberProfile.findUnique({ where: { organizationId_userId: { organizationId: CIEL, userId: id } } });
    designers.push({ id, name: [u?.firstName, u?.lastName].filter(Boolean).join(' ') || id.slice(0, 12), whatsappNumber: prof?.whatsappNumber || null });
  }

  const summary = `🆕 New lead — ${lead.name}\nSource: MANUAL · Phone: ${lead.phone}\n${lead.propertyType} · ${lead.budget}\nTap below to assign.`;
  await send('6582289608', {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: summary },
      footer: { text: 'Tap to assign a designer' },
      action: {
        button: 'Assign designer',
        sections: [{ title: 'Designers', rows: designers.slice(0, 10).map((d) => ({ id: `leadassign:${LEAD_ID}:${d.id}`.slice(0, 200), title: String(d.name).slice(0, 24), ...(d.whatsappNumber ? { description: `+${d.whatsappNumber}` } : {}) })) }],
      },
    },
  }, summary);
  console.log('📤 card sent to Mike — watching for the tap...');

  const since = new Date();
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const tap: any = await p.whatsAppMessage.findFirst({
      where: { organizationId: OSIRIS, direction: 'INBOUND', counterparty: { contains: '82289608' }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    const tid = tap?.payload?.interactive?.list_reply?.id;
    if (tid && /^leadassign:/.test(tid)) {
      const m = tid.match(/^leadassign:([^:]+):(.+)$/);
      const userId = m[2];
      const d = designers.find((x) => x.id === userId);
      console.log('👆 TAP:', tap.payload.interactive.list_reply.title, '→ assigning...');
      await p.lead.update({ where: { id: LEAD_ID }, data: { assignedToUserId: userId, assignedToName: d?.name || null, assignedAt: new Date(), status: 'engaging' } });
      await send('6582289608', { type: 'text', text: { body: `✅ ${lead.name} assigned to ${d?.name || 'designer'}` } }, 'confirm');
      const dnum = String(d?.whatsappNumber || '').replace(/\D/g, '');
      if (dnum) {
        const intro = `Hi ${String(lead.name || '').split(' ')[0]}, this is ${d?.name || 'your designer'} from CIEL Interior — thanks for your enquiry! When would be a good time to chat about your renovation?`;
        const waUrl = `https://wa.me/${lead.phone}?text=${encodeURIComponent(intro)}`;
        const brief = `📋 New lead assigned to you — ${lead.name}\nPhone: ${lead.phone}\n${lead.propertyType} · ${lead.budget}\nContact them within 24h.`;
        await send(dnum, { type: 'interactive', interactive: { type: 'cta_url', body: { text: brief }, action: { name: 'cta_url', parameters: { display_text: '💬 Message the lead', url: waUrl } } } }, brief);
        console.log('📨 designer', d?.name, 'notified at', dnum, 'with the Message-the-lead button');
      } else {
        console.log('designer has no WhatsApp number on profile — no notify sent');
      }
      console.log('🏁 assignment complete — lead is ENGAGING, assigned to', d?.name);
      return;
    }
    if (i % 6 === 5) console.log(`…still waiting (${(i + 1) * 5}s)`);
  }
  console.log('⏱ no tap detected in 3 minutes — the card is on his phone; rerun me after he taps');
})().finally(() => p.$disconnect());
