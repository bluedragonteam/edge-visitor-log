/**
 * Turning a page-view beacon into a stored visit, and deciding which beacons to ignore.
 * Pure functions: usable in a Worker, in Node, or in your own backend.
 */

export const MAX_BEACON_BYTES = 4096;

const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'];

// Crawlers, link previews and automation that run JavaScript - not people
export const BOT_AGENTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|phantom|puppeteer|playwright|selenium|facebookexternalhit|embedly|whatsapp|python-requests|curl\/|wget/i;

const clip = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : undefined);

/**
 * Why a beacon should not be recorded, or null to record it.
 * @param {{ origin: string, allowedOrigins: string[], userAgent?: string, ip?: string, dnt?: string|null, gpc?: string|null, respectDnt?: boolean }} request
 * @returns {null | 'origin' | 'bot' | 'do-not-track' | 'no-ip'}
 */
export const ignoreReason = ({ origin, allowedOrigins, userAgent, ip, dnt, gpc, respectDnt = true }) => {
  if (!allowedOrigins.includes(origin)) return 'origin';
  if (!userAgent || BOT_AGENTS.test(userAgent)) return 'bot';
  if (respectDnt && (dnt === '1' || gpc === '1')) return 'do-not-track';
  if (!ip) return 'no-ip';
  return null;
};

/**
 * What to store for one page view. The browser only says which page and where it came from;
 * the IP, location and network come from Cloudflare (request.cf), never from the browser.
 * @param {{ u?: string, r?: string, t?: string }} beacon - page path + query, referrer, title
 * @param {{ ip: string, cf?: object, userAgent?: string, origin: string, now?: Date }} context
 */
export const visitFromBeacon = (beacon, { ip, cf = {}, userAgent, origin, now = new Date() }) => {
  let page;
  try {
    page = new URL(String(beacon?.u || ''), origin);
  } catch {
    page = new URL('/', origin);
  }
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = page.searchParams.get(`utm_${key}`);
    if (value) utm[key] = value.slice(0, 200);
  }
  const ref = page.searchParams.get('ref');
  if (ref) utm.ref = ref.slice(0, 200);
  const referrer = typeof beacon?.r === 'string' ? beacon.r : '';
  return {
    at: now.toISOString(),
    ip,
    country: clip(cf.country, 8),
    region: clip(cf.region, 100),
    city: clip(cf.city, 100),
    org: clip(cf.asOrganization, 200),
    asn: Number.isInteger(cf.asn) ? cf.asn : undefined,
    host: page.host,
    path: page.pathname.slice(0, 500),
    title: clip(beacon?.t, 200),
    // Only where they came from, not a page of the same site
    referrer: referrer && !referrer.startsWith(origin) ? referrer.slice(0, 500) : undefined,
    utm: Object.keys(utm).length > 0 ? utm : undefined,
    userAgent: clip(userAgent, 400)
  };
};
