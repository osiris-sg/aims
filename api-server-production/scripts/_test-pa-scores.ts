/** Shows the raw template-match score for borderline messages, so the gate
 *  threshold (WHATSAPP_TEMPLATE_MATCH_THRESHOLD, default 0.5) can be tuned. */
const API = 'https://aims-ahwy.onrender.com/whatsapp/group-agent';
const TOKEN = 'd208e35f7826f9cf6aedcf9646228cb61a3e25d3231ba17d';
const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';

const MSGS = [
  'thank you so much!',
  'thanks!',
  'im quite upset about how this was handled',
  'im not happy with this',
  'im frustrated about something',
  // true off-template, for contrast
  'can you help me fix my car engine',
  'what is the weather like today',
  'do you sell air conditioners',
];

(async () => {
  for (const body of MSGS) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Group-Bridge-Token': TOKEN },
      body: JSON.stringify({ organizationId: ORG, groupId: 't@g.us', from: '6591151041', body }),
    });
    const j: any = await res.json().catch(() => ({}));
    const d = j?.data ?? j;
    const score = typeof d?.confidence === 'number' ? d.confidence.toFixed(3) : '?';
    console.log(`${d?.reply ? 'REPLY ' : 'SILENT'} score=${score}  "${body}"`);
  }
})();
