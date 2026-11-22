/**
 * Grouping page views into visitors and summarising them. Pure functions.
 * A visitor is one IP + browser: no cookie or fingerprint, so a person on two devices is two visitors.
 */

const MAX_PAGES_PER_VISITOR = 50;

const encoder = new TextEncoder();

/** Same visitor = same IP and browser. Hashed, so the key itself reveals nothing. */
export const visitorKey = async (ip, userAgent = '') => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${ip}|${userAgent}`));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** "Chrome on macOS" */
export const browserName = (userAgent = '') => {
  const ua = userAgent || '';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' on ') || 'Unknown browser';
};

/** "github.com" from "https://www.github.com/x", or null */
export const referrerHost = (referrer) => {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

/**
 * Page views -> visitors, most recent activity first.
 * @param {Array<{ visitorKey: string, at: string|Date, ip: string, path: string, ... }>} visits - any order
 */
export const groupVisits = (visits) => {
  const sorted = [...visits].sort((a, b) => new Date(b.at) - new Date(a.at));
  const visitors = new Map();
  for (const visit of sorted) {
    let visitor = visitors.get(visit.visitorKey);
    if (!visitor) {
      visitor = {
        key: visit.visitorKey,
        ip: visit.ip,
        country: visit.country,
        region: visit.region,
        city: visit.city,
        org: visit.org,
        asn: visit.asn,
        network: visit.network || null,
        // 'datacenter' (VPN, Tor, relay, cloud or hosting) or 'residential' (home, office or mobile network)
        connection: visit.network ? 'datacenter' : 'residential',
        browser: browserName(visit.userAgent),
        firstAt: visit.at,
        lastAt: visit.at,
        views: 0,
        referrer: undefined,
        utm: undefined,
        pages: []
      };
      visitors.set(visit.visitorKey, visitor);
    }
    visitor.views++;
    if (new Date(visit.at) < new Date(visitor.firstAt)) visitor.firstAt = visit.at;
    // Newest first, so the last referrer seen is where they arrived from
    if (visit.referrer) visitor.referrer = visit.referrer;
    if (visit.utm) visitor.utm = visit.utm;
    if (visitor.pages.length < MAX_PAGES_PER_VISITOR) visitor.pages.push({ path: visit.path, title: visit.title, at: visit.at });
  }
  return [...visitors.values()];
};

const countBy = (items, keyOf, limit = 10) => {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
};

/**
 * Totals and top lists for a period
 */
export const summarize = (visits, visitors, now = new Date()) => {
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  return {
    views: visits.length,
    visitors: visitors.length,
    visitorsLast24h: visitors.filter((visitor) => new Date(visitor.lastAt).getTime() >= dayAgo).length,
    // Visitors whose IP hides the person, by kind: { vpn, tor, relay, hosting }
    masked: visitors.reduce((counts, visitor) => {
      if (visitor.network) counts[visitor.network.kind] = (counts[visitor.network.kind] || 0) + 1;
      return counts;
    }, {}),
    // Data centre vs residential visitors
    connections: visitors.reduce((counts, visitor) => {
      counts[visitor.network ? 'datacenter' : 'residential']++;
      return counts;
    }, { datacenter: 0, residential: 0 }),
    topPages: countBy(visits, (visit) => visit.path),
    topReferrers: countBy(visits, (visit) => referrerHost(visit.referrer)),
    countries: countBy(visitors, (visitor) => visitor.country)
  };
};
