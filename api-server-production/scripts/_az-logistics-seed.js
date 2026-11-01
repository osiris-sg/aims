// Round AZ — prod: seed Clients → Logistics with Mitsui Soko (warehouse + customs broker + trucking) and ISEWAN
// (forwarder / 乙仲 + customs broker), from ADH's own mail signatures and the Hoei B/L (VKTCB25000562). Adds a company
// only when its code is not on the list yet (never overwrites); every write goes to the Activity Log. Dry run by default.
// Usage (after nest build): DBURL=… node scripts/_az-logistics-seed.js [--apply]
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { cleanShippingLine } = require(path.join(__dirname, '..', 'dist', 'src', 'shipments', 'clients-company.js'));
const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
const APPLY = process.argv.includes('--apply');
const ORG = process.env.ORG || '056ed6da-42d3-438e-895b-84bb4df47a4c';
const SEED = {
  MITSUI_SOKO: {
    name: 'Mitsui-Soko Co., Ltd.',
    nameJa: '三井倉庫株式会社',
    types: ['CUSTOMS_BROKER', 'WAREHOUSE', 'TRUCKING'],
    address: '〒103-0015 東京都中央区日本橋箱崎町19番21号 MSH日本橋箱崎ビル8階（関東支社 営業部 営業第4課）',
    emailDomains: ['mitsui-soko.co.jp'],
    agents: [
      { name: '榎本 若菜 (Wakana Enomoto)', company: '関東支社 営業部 営業第4課', email: 'wakana_enomoto@mitsui-soko.co.jp', phone: '090-1659-6988' },
      { name: '鶴淵 大輔 (Daisuke Tsurubuchi)', company: '関東支社 営業部 営業第4課', email: 'daisuke_tsurubuchi@mitsui-soko.co.jp', phone: '+81-80-7454-8187' },
      { name: '細江 (Fumio Hosoe)', company: '関東支社 関東第1支店 大黒事務所（A号）', email: 'fumio_hosoe@mitsui-soko.co.jp', phone: '045-501-6232' },
      { name: '諸橋 勇虎 (Yuto Morohashi)', company: '関東支社 関東第1支店 大黒事務所（A号）', email: 'yuto_morohashi@mitsui-soko.co.jp', phone: '045-501-6232' },
      { name: '吉田 (Yoshie Yoshida)', company: '三井倉庫', email: 'yoshie_yoshida@mitsui-soko.co.jp' },
      { name: '間瀬 瑞季 (Mizuki Mase)', company: '中部支社 営業部 営業第2課', email: 'mizuki_mase@mitsui-soko.co.jp', phone: '052-972-0630' },
    ],
    notes: [
      'Customs clearance, warehousing and domestic trucking in one (一貫作業) — e.g. Nagoya port → Kato (海部郡), Yokohama 大黒ふ頭 for SUS.',
      'Offices: 関東第1支店 大黒事務所（A号）〒230-0054 横浜市鶴見区大黒ふ頭15, TEL 045-501-6232, FAX 045-501-6272; 中部支社 〒460-0002 名古屋市中区丸の内3-22-24 名古屋桜通ビル10階, TEL 052-972-0630.',
      'Their vendor invoices are filed on step 12 (transport & storage); DET / detention costs discussed with them.',
    ].join('\n'),
  },
  ISEWAN: {
    name: 'Isewan Co., Ltd.',
    nameJa: '伊勢湾海運株式会社',
    types: ['FORWARDER', 'CUSTOMS_BROKER'],
    phone: '052-661-5187',
    address: '〒455-0032 名古屋市港区入船一丁目7番40号（輸入事業部 営業課 第2チーム）',
    emailDomains: ['isewan.co.jp', 'isewanthai.co.th'],
    agents: [
      { name: '垰村 (Taomura)', company: '伊勢湾海運 輸入事業部 営業課 第2チーム', email: 'taomura@isewan.co.jp', phone: '052-661-5187' },
      { name: 'Ms. Anuchita', company: 'ISEWAN (THAILAND) CO., LTD.', email: 'anuchita@isewanthai.co.th', phone: '038-347-111 ext. 209' },
    ],
    notes: [
      "Hoei's notify party / forwarder in Thailand: ISEWAN (THAILAND) CO., LTD., 159/32 Serm-Mitr Tower 19th Fl, Unit 1903/1, Sukhumvit 21 (Asoke), North-Klongtoey, Wattana, Bangkok 10110 (B/L VKTCB25000562).",
      'Japan: アルミインゴット輸入の件 (import enquiry, Nagoya) — TEL 052-661-5187, FAX 052-661-6585.',
    ].join('\n'),
  },
};
(async () => {
  const set = await p.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { id: true, shippingLines: true } });
  if (!set) throw new Error('no TradeSetting for the org');
  const stored = { ...(set.shippingLines || {}) };
  const add = {};
  for (const [code, raw] of Object.entries(SEED)) {
    const clash = stored[code] || Object.values(stored).find((v) => v.name?.toLowerCase() === raw.name.toLowerCase());
    if (clash) { console.log(`skip ${code}: already on the list`); continue; }
    add[code] = { ...cleanShippingLine(raw, { name: '', custom: true }, (m) => { throw new Error(`${code}: ${m}`); }), custom: true };
    console.log(`add ${code}: ${add[code].name} [${add[code].types.join(', ')}] · ${add[code].agents.length} contacts · domains ${add[code].emailDomains.join(', ')}`);
  }
  if (!APPLY || !Object.keys(add).length) { console.log(APPLY ? 'nothing to add' : 'Dry run — nothing written.'); return p.$disconnect(); }
  await p.tradeSetting.update({ where: { id: set.id }, data: { shippingLines: { ...stored, ...add } } });
  for (const [code, v] of Object.entries(add)) {
    await p.actionLog.create({ data: { organizationId: ORG, actorType: 'SYSTEM', actorId: 'system:round-az', actorName: 'System creation', channel: 'cron', action: 'CREATE', resource: 'LogisticsPartner', resourceId: code, details: { name: v.name, types: v.types, contacts: v.agents.length, source: 'mail signatures + B/L VKTCB25000562' } } });
    console.log(`WRITE TradeSetting.shippingLines.${code} (+ActionLog)`);
  }
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message.slice(0, 300)); process.exit(1); });
