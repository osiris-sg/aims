// Ported from siteclock backend/src/lib/geocode.ts @62b7d9d. Only change: a generic User-Agent (no contact address).
/**
 * Reverse geocoding via OSM Nominatim, used to stamp a human-readable address
 * onto punches. Cached by ~11 m grid; requests serialized >=1.1 s apart per
 * Nominatim usage policy. Failures degrade to null — never block a punch.
 */
const cache = new Map<string, string | null>();
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

export function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const run = chain.then(async () => {
    if (cache.has(key)) return cache.get(key)!;
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`,
        { headers: { "User-Agent": "AIMS-Field/1.0" }, signal: ctl.signal },
      );
      clearTimeout(to);
      const data: any = res.ok ? await res.json() : null;
      const addr = typeof data?.display_name === "string" ? data.display_name : null;
      if (addr) {
        cache.set(key, addr);
        if (cache.size > 5000) cache.delete(cache.keys().next().value!);
      }
      return addr;
    } catch {
      return null; // transient — deliberately not cached, so it can be retried
    }
  });
  chain = run.catch(() => {});
  return run as Promise<string | null>;
}

const fwdCache = new Map<string, { label: string; lat: number; lng: number }[]>();

/** Forward geocoding (address search) via Nominatim, same queue and etiquette. */
export function searchAddress(q: string): Promise<{ label: string; lat: number; lng: number }[]> {
  const key = q.trim().toLowerCase();
  if (fwdCache.has(key)) return Promise.resolve(fwdCache.get(key)!);
  const run = chain.then(async () => {
    if (fwdCache.has(key)) return fwdCache.get(key)!;
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`,
        { headers: { "User-Agent": "AIMS-Field/1.0" }, signal: ctl.signal },
      );
      clearTimeout(to);
      const data: any = res.ok ? await res.json() : [];
      const out = (Array.isArray(data) ? data : []).map((r: any) => ({
        label: String(r.display_name ?? ""),
        lat: Number(r.lat),
        lng: Number(r.lon),
      })).filter((r: any) => r.label && !isNaN(r.lat) && !isNaN(r.lng));
      fwdCache.set(key, out);
      if (fwdCache.size > 2000) fwdCache.delete(fwdCache.keys().next().value!);
      return out;
    } catch {
      return [];
    }
  });
  chain = run.catch(() => {});
  return run as Promise<{ label: string; lat: number; lng: number }[]>;
}

const sgCache = new Map<string, { label: string; lat: number; lng: number }[]>();

/**
 * Singapore address search via OneMap (SLA) — far better than OSM for SG
 * building names, blocks and 6-digit postal codes. Works without a token
 * today; ONEMAP_TOKEN is sent when set. Never throws: [] on any failure.
 */
export async function searchSingapore(q: string): Promise<{ label: string; lat: number; lng: number }[]> {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  if (sgCache.has(key)) return sgCache.get(key)!;
  // Keyless OneMap rate-limits with a non-JSON reply: retry once, and never
  // cache a failed lookup (only real answers, including real "no results").
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt) await new Promise((r) => setTimeout(r, 800));
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(
        `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(q.trim())}&returnGeom=Y&getAddrDetails=Y&pageNum=1`,
        { headers: process.env.ONEMAP_TOKEN ? { Authorization: process.env.ONEMAP_TOKEN } : {}, signal: ctl.signal },
      );
      clearTimeout(to);
      if (!res.ok) continue;
      const data: any = await res.json();
      if (!Array.isArray(data?.results)) continue;
      // Best match first: the building's own name ("JURONG POINT") beats a
      // fuzzy hit that merely mentions it ("… TAMAN JURONG SHOPPING CENTRE").
      const want = key.replace(/[^a-z0-9]+/g, " ").trim();
      const rank = (r: any) => {
        const name = String(r.SEARCHVAL ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        return name === want ? 0 : name.startsWith(want) ? 1 : ` ${name} `.includes(` ${want} `) ? 2 : 3;
      };
      const out = data.results
        .slice(0, 10)
        .map((r: any, i: number) => ({ r, i, k: rank(r) }))
        .sort((a: any, b: any) => a.k - b.k || a.i - b.i)
        .slice(0, 6)
        .map(({ r }: any) => ({
          label: String(r.ADDRESS ?? r.SEARCHVAL ?? "").replace(/\s+/g, " ").trim(),
          lat: Number(r.LATITUDE),
          lng: Number(r.LONGITUDE),
        }))
        .filter((r: any) => r.label && !isNaN(r.lat) && !isNaN(r.lng));
      sgCache.set(key, out);
      if (sgCache.size > 2000) sgCache.delete(sgCache.keys().next().value!);
      return out;
    } catch {
      /* timeout / network — retry */
    }
  }
  return [];
}

// OneMap matches full street words ("UBI ROAD 1"), not "Ubi Rd 1".
const SG_ABBREV: [RegExp, string][] = [
  [/\bblk\b\.?/gi, ""], [/\brd\b\.?/gi, "Road"], [/\bave?\b\.?/gi, "Avenue"], [/\bst\b\.?(?=\s*\d)/gi, "Street"],
  [/\bdr\b\.?/gi, "Drive"], [/\bind\b\.?/gi, "Industrial"], [/\blor\b\.?/gi, "Lorong"], [/\bcres\b\.?/gi, "Crescent"],
  [/\bctrl\b\.?/gi, "Central"], [/\bnth\b\.?/gi, "North"], [/\bsth\b\.?/gi, "South"], [/\bupp?\b\.?/gi, "Upper"],
];
const expandSgAbbrev = (s: string) => SG_ABBREV.reduce((acc, [re, to]) => acc.replace(re, to), s);

/**
 * Best single match for a job address: a 6-digit postal code first (exact in
 * SG), then OneMap on the query, then OSM. Unit numbers (#02-346) are noise
 * to both geocoders and are stripped.
 */
export async function geocodeJobAddress(q: string): Promise<{ label: string; lat: number; lng: number } | null> {
  const clean = expandSgAbbrev(q.replace(/#\s*[\w-]+/g, " ")).replace(/\s+/g, " ").trim();
  const postal = q.match(/(?:^|\D)(\d{6})(?:\D|$)/)?.[1];
  if (postal) {
    const [hit] = await searchSingapore(postal);
    if (hit) return hit;
  }
  const [sg] = await searchSingapore(clean);
  if (sg) return sg;
  // OSM answers a bare postal code or vague text with the middle of Singapore —
  // a pin like that is worse than none (the admin is asked for a better address).
  const [osm] = await searchAddress(`${clean}, Singapore`);
  if (!osm || /^\s*singapore\s*$/i.test(osm.label) || osm.label.split(",").length < 3) return null;
  return osm;
}
