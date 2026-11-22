import { MAX_BEACON_BYTES, ignoreReason, visitFromBeacon } from './beacon.js';
import { classifyNetwork } from './network.js';
import { isTorExit, refreshTorExits, torListAge } from './tor.js';
import { groupVisits, summarize, visitorKey } from './visitors.js';
import { addIgnoredIp, insertVisit, listIgnoredIps, pruneVisits, removeIgnoredIp, visitsAfter, visitsSince } from './store.js';
// The beacon script served at /visit.js (generated from client/visit.js)
import BEACON_SCRIPT from './beacon-script.js';

/**
 * edge-visitor-log: a privacy-friendly visitor log on Cloudflare Workers + D1.
 *
 *   POST /v                 page-view beacon from your site (see client/visit.js)
 *   GET  /visit.js          the beacon script
 *   GET  /api/visitors      visitors of the last ?days= days, grouped, with totals   (Bearer API_TOKEN)
 *   GET  /api/visits        raw visits after ?after=<id>, for copying elsewhere        (Bearer API_TOKEN)
 *   GET|POST|DELETE /api/ignored-ips   your own IPs, left out of /api/visitors         (Bearer API_TOKEN)
 *   GET  /health
 *
 * Cron: refreshes the Tor exit list every 6 hours and deletes visits older than RETENTION_DAYS.
 */

const TOR_REFRESH_MS = 6 * 60 * 60 * 1000;
const encoder = new TextEncoder();

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(encoder.encode(a), encoder.encode(b));
};

const isAuthorized = (env, request) => !!env.API_TOKEN && safeEqual(request.headers.get('Authorization') || '', `Bearer ${env.API_TOKEN}`);

const allowedOrigins = (env) => String(env.SITE_ORIGINS || '').split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean);

const isIp = (value) => /^[0-9a-f:.]{2,45}$/i.test(value) && (value.includes('.') || value.includes(':'));

export const handleBeacon = async (request, env) => {
  // Nothing for the browser to read: no CORS headers needed, the beacon is fire-and-forget
  const done = new Response(null, { status: 204 });
  const origin = request.headers.get('Origin') || '';
  const ip = request.headers.get('CF-Connecting-IP');
  const userAgent = request.headers.get('User-Agent') || '';
  const reason = ignoreReason({
    origin,
    allowedOrigins: allowedOrigins(env),
    userAgent,
    ip,
    dnt: request.headers.get('DNT'),
    gpc: request.headers.get('Sec-GPC'),
    respectDnt: env.RESPECT_DNT !== 'false'
  });
  if (reason) return done;

  const body = await request.text();
  if (body.length > MAX_BEACON_BYTES) return done;
  let beacon;
  try {
    beacon = JSON.parse(body);
  } catch {
    return done;
  }

  const visit = visitFromBeacon(beacon || {}, { ip, cf: request.cf || {}, userAgent, origin });
  const tor = await isTorExit(env.DB, ip);
  const network = classifyNetwork(visit, { isTorExit: () => tor });
  await insertVisit(env.DB, visit, await visitorKey(ip, userAgent), network);
  return done;
};

const handleVisitors = async (env, url) => {
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 30, 1), 366);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const visits = await visitsSince(env.DB, since, { includeIgnored: url.searchParams.get('includeIgnored') === '1' });
  const visitors = groupVisits(visits);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 200, 1), 1000);
  return json({ days, stats: summarize(visits, visitors), visitors: visitors.slice(0, limit) });
};

const handleVisits = async (env, url) => {
  const after = Math.max(parseInt(url.searchParams.get('after'), 10) || 0, 0);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 500, 1), 1000);
  const visits = await visitsAfter(env.DB, after, limit);
  return json({ visits, next: visits.length === limit ? visits.at(-1).id : null });
};

const handleIgnoredIps = async (request, env, url) => {
  if (request.method === 'GET') return json({ ignored: await listIgnoredIps(env.DB) });
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    // No ip in the body = "the IP I'm calling from"
    const ip = String(body.ip || request.headers.get('CF-Connecting-IP') || '').trim();
    if (!isIp(ip)) return json({ error: 'Send {"ip": "<address>"}' }, 400);
    await addIgnoredIp(env.DB, ip, typeof body.label === 'string' ? body.label.slice(0, 100) : undefined);
    return json({ ignored: ip });
  }
  if (request.method === 'DELETE') {
    const ip = url.searchParams.get('ip') || '';
    return (await removeIgnoredIp(env.DB, ip)) ? json({ removed: ip }) : json({ error: 'Not in the list' }, 404);
  }
  return json({ error: 'Method not allowed' }, 405);
};

export const runCron = async (env, now = new Date()) => {
  const result = { torExits: null, pruned: 0 };
  if ((await torListAge(env.DB, now.getTime())) > TOR_REFRESH_MS) result.torExits = await refreshTorExits(env.DB);
  const days = parseInt(env.RETENTION_DAYS, 10);
  if (days > 0) result.pruned = await pruneVisits(env.DB, days, now);
  return result;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/v' && request.method === 'POST') return handleBeacon(request, env);
    if (path === '/visit.js' && request.method === 'GET') {
      return new Response(BEACON_SCRIPT, {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' }
      });
    }
    if (path === '/health') return json({ ok: true });

    if (path.startsWith('/api/')) {
      if (!isAuthorized(env, request)) return json({ error: 'Unauthorized' }, 401);
      if (path === '/api/visitors' && request.method === 'GET') return handleVisitors(env, url);
      if (path === '/api/visits' && request.method === 'GET') return handleVisits(env, url);
      if (path === '/api/ignored-ips') return handleIgnoredIps(request, env, url);
    }
    return json({ error: 'Not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  }
};
