/**
 * Give Denzel his own AIMS tenant.
 *
 * Osiris Technology was doing double duty: its single WhatsAppConnection slot
 * (one per org) held Denzel's PA number, and its agent was trained with
 * Denzel's insurance persona. Now that the Osiris Technology number occupies
 * that slot, Denzel's PA needs its own org, and the CRM data has to follow it.
 *
 * Moves: agent config, QnA training, contacts/messages/suggestions/scheduled
 * for Denzel's counterparties, plus any captured appointments. Creates a
 * WhatsAppConnection for Denzel's PA under the new org. Leaves everything else
 * (customers, documents, journals, the Osiris Technology connection) alone.
 *
 * Dry run first — nothing is written without --apply:
 *   npx ts-node -r dotenv/config --transpile-only scripts/move-crm-to-denzel-org.ts dotenv_config_path=.env.production
 *   npx ts-node -r dotenv/config --transpile-only scripts/move-crm-to-denzel-org.ts --apply dotenv_config_path=.env.production
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SOURCE_ORG = 'd068f159-e45a-4da8-beaf-62e903f44141'; // Osiris Technology
const NEW_ORG_NAME = 'Denzel Office';

// Denzel's PA, as connected in Meta (see whatsapp-integration memory note).
const DENZEL_WABA = '1496736761842573';
const DENZEL_PHONE_ID = '1131633336700579';
const DENZEL_DISPLAY = '+65 8789 9862';
const DENZEL_VERIFIED_NAME = "Denzel's PA";

// Counterparties that belong to Denzel's PA rather than the Osiris number.
// Group chats always do; these direct numbers are Denzel/guru's own test chats.
const DENZEL_DIRECT = ['6591151041', '6596275834'];

const APPLY = process.argv.includes('--apply');
const log = (s: string) => console.log(`${APPLY ? '' : '[dry-run] '}${s}`);

/** Group chats plus the known Denzel-side direct numbers. */
function isDenzelCounterparty(counterparty: string): boolean {
  if (counterparty.endsWith('@g.us')) return true;
  const digits = counterparty.replace(/\D/g, '');
  return DENZEL_DIRECT.some((d) => digits.endsWith(d.slice(-8)));
}

async function main() {
  const source = await prisma.organization.findUnique({ where: { id: SOURCE_ORG }, select: { name: true } });
  if (!source) throw new Error('Source org not found');
  console.log(`Source: ${source.name}\nTarget: ${NEW_ORG_NAME}\n`);

  // ── 1. The target org ─────────────────────────────────────────────────────
  let target = await prisma.organization.findFirst({ where: { name: NEW_ORG_NAME }, select: { id: true, name: true } });
  if (target) {
    log(`org already exists: ${target.name} [${target.id}]`);
  } else if (APPLY) {
    target = await prisma.organization.create({
      data: { name: NEW_ORG_NAME },
      select: { id: true, name: true },
    });
    log(`created org ${target.name} [${target.id}]`);
  } else {
    log(`would create org "${NEW_ORG_NAME}"`);
  }
  const targetId = target?.id;

  // ── 2. CRM module + permissions, so the org's users can actually use it ───
  const CRM_SUBMENUS = [
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'contacts', label: 'Contacts' },
    { key: 'agent', label: 'AI Agent' },
    { key: 'suggestions', label: 'Suggestions' },
    { key: 'scheduled', label: 'Scheduled' },
  ];
  if (APPLY && targetId) {
    await prisma.organizationModule.upsert({
      where: { organizationId_moduleCode: { organizationId: targetId, moduleCode: 'CRM' } },
      update: { enabled: true },
      create: {
        organizationId: targetId,
        moduleCode: 'CRM',
        enabled: true,
        displayName: 'CRM',
        icon: 'SupportAgent',
        sortOrder: 14,
        config: { route: '/portal/crm', subMenus: CRM_SUBMENUS },
      },
    });
    log('CRM module enabled');
  } else {
    log('would enable the CRM module');
  }

  // ── 3. Move the CRM rows ──────────────────────────────────────────────────
  const qna = await prisma.whatsAppQnA.count({ where: { organizationId: SOURCE_ORG } });
  const config = await prisma.whatsAppAgentConfig.count({ where: { organizationId: SOURCE_ORG } });
  log(`move ${qna} training pair(s) and ${config} agent config`);

  const allMessages = await prisma.whatsAppMessage.findMany({
    where: { organizationId: SOURCE_ORG },
    select: { id: true, counterparty: true },
  });
  const moveMessageIds = allMessages.filter((m) => isDenzelCounterparty(m.counterparty)).map((m) => m.id);
  log(`move ${moveMessageIds.length} of ${allMessages.length} message(s) (group chats + Denzel's own numbers)`);

  const allContacts = await prisma.whatsAppContact.findMany({
    where: { organizationId: SOURCE_ORG },
    select: { id: true, waId: true },
  });
  const moveContactIds = allContacts.filter((c) => isDenzelCounterparty(c.waId)).map((c) => c.id);
  log(`move ${moveContactIds.length} of ${allContacts.length} contact(s)`);

  const suggestions = await prisma.whatsAppSuggestion.count({ where: { organizationId: SOURCE_ORG } });
  const scheduled = await prisma.whatsAppScheduledMessage.count({ where: { organizationId: SOURCE_ORG } });
  const appointments = await prisma.whatsAppAppointment.count({ where: { organizationId: SOURCE_ORG } });
  log(`move ${suggestions} suggestion(s), ${scheduled} scheduled message(s), ${appointments} appointment(s)`);

  if (APPLY && targetId) {
    await prisma.$transaction([
      prisma.whatsAppAgentConfig.updateMany({ where: { organizationId: SOURCE_ORG }, data: { organizationId: targetId } }),
      prisma.whatsAppQnA.updateMany({ where: { organizationId: SOURCE_ORG }, data: { organizationId: targetId } }),
      prisma.whatsAppMessage.updateMany({ where: { id: { in: moveMessageIds } }, data: { organizationId: targetId } }),
      prisma.whatsAppContact.updateMany({ where: { id: { in: moveContactIds } }, data: { organizationId: targetId } }),
      prisma.whatsAppSuggestion.updateMany({ where: { organizationId: SOURCE_ORG }, data: { organizationId: targetId } }),
      prisma.whatsAppScheduledMessage.updateMany({
        where: { organizationId: SOURCE_ORG },
        data: { organizationId: targetId },
      }),
      prisma.whatsAppAppointment.updateMany({ where: { organizationId: SOURCE_ORG }, data: { organizationId: targetId } }),
    ]);
    log('CRM rows moved');
  }

  // ── 4. Denzel's PA connection under the new org ───────────────────────────
  const token = process.env.WHATSAPP_SU_TOKEN;
  if (!token) {
    log('⚠️  WHATSAPP_SU_TOKEN not set — cannot create the connection (run the seed script separately)');
  } else if (APPLY && targetId) {
    await prisma.whatsAppConnection.upsert({
      where: { organizationId: targetId },
      update: {
        wabaId: DENZEL_WABA,
        phoneNumberId: DENZEL_PHONE_ID,
        displayPhoneNumber: DENZEL_DISPLAY,
        verifiedName: DENZEL_VERIFIED_NAME,
        accessToken: token,
        status: 'CONNECTED',
        lastError: null,
        connectedAt: new Date(),
      },
      create: {
        organizationId: targetId,
        wabaId: DENZEL_WABA,
        phoneNumberId: DENZEL_PHONE_ID,
        displayPhoneNumber: DENZEL_DISPLAY,
        verifiedName: DENZEL_VERIFIED_NAME,
        accessToken: token,
        status: 'CONNECTED',
      },
    });
    log(`connected ${DENZEL_DISPLAY} (${DENZEL_VERIFIED_NAME}) to ${NEW_ORG_NAME}`);
  } else {
    log(`would connect ${DENZEL_DISPLAY} (${DENZEL_VERIFIED_NAME}) to ${NEW_ORG_NAME}`);
  }

  // ── 5. What the operator still has to do ──────────────────────────────────
  console.log('\nAfter applying:');
  console.log(`  • Set the bridge AIMS_ORG_ID to the new org id (local .env AND the Render worker)`);
  console.log('  • Grant users access: UserOrganization + UserRole rows for whoever should see this org');
  console.log('  • Osiris Technology now has NO agent config/training — train it separately if its number needs an AI');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
