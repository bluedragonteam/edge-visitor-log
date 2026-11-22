/**
 * D1 queries. Rows are converted to plain visit objects in camelCase.
 */

const MAX_VISITS_READ = 20000;

export const insertVisit = (db, visit, visitorKey, network) => db
  .prepare(`INSERT INTO visits (at, visitor_key, ip, country, region, city, org, asn, host, path, title, referrer, utm, user_agent, network_kind, network_provider)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
  .bind(
    visit.at, visitorKey, visit.ip, visit.country ?? null, visit.region ?? null, visit.city ?? null, visit.org ?? null,
    visit.asn ?? null, visit.host ?? null, visit.path ?? null, visit.title ?? null, visit.referrer ?? null,
    visit.utm ? JSON.stringify(visit.utm) : null, visit.userAgent ?? null, network?.kind ?? null, network?.provider ?? null
  )
  .first('id');

export const rowToVisit = (row) => ({
  id: row.id,
  at: row.at,
  visitorKey: row.visitor_key,
  ip: row.ip,
  country: row.country ?? undefined,
  region: row.region ?? undefined,
  city: row.city ?? undefined,
  org: row.org ?? undefined,
  asn: row.asn ?? undefined,
  host: row.host ?? undefined,
  path: row.path ?? undefined,
  title: row.title ?? undefined,
  referrer: row.referrer ?? undefined,
  utm: row.utm ? JSON.parse(row.utm) : undefined,
  userAgent: row.user_agent ?? undefined,
  network: row.network_kind ? { kind: row.network_kind, provider: row.network_provider } : null
});

/**
 * Visits since a time, newest first. Ignored IPs are left out unless includeIgnored.
 */
export const visitsSince = async (db, sinceIso, { includeIgnored = false } = {}) => {
  const filter = includeIgnored ? '' : 'AND ip NOT IN (SELECT ip FROM ignored_ips)';
  const { results } = await db
    .prepare(`SELECT * FROM visits WHERE at >= ? ${filter} ORDER BY at DESC LIMIT ?`)
    .bind(sinceIso, MAX_VISITS_READ)
    .all();
  return results.map(rowToVisit);
};

/**
 * Raw visits after an id, oldest first - for copying them into your own database incrementally
 */
export const visitsAfter = async (db, afterId, limit) => {
  const { results } = await db.prepare('SELECT * FROM visits WHERE id > ? ORDER BY id LIMIT ?').bind(afterId, limit).all();
  return results.map(rowToVisit);
};

export const pruneVisits = async (db, retentionDays, now = new Date()) => {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { meta } = await db.prepare('DELETE FROM visits WHERE at < ?').bind(cutoff).run();
  return meta.changes;
};

export const listIgnoredIps = async (db) => (await db.prepare('SELECT ip, label, created_at FROM ignored_ips ORDER BY created_at').all()).results
  .map((row) => ({ ip: row.ip, label: row.label ?? undefined, createdAt: row.created_at }));

export const addIgnoredIp = (db, ip, label) => db
  .prepare('INSERT INTO ignored_ips (ip, label) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET label = excluded.label')
  .bind(ip, label ?? null).run();

export const removeIgnoredIp = async (db, ip) => (await db.prepare('DELETE FROM ignored_ips WHERE ip = ?').bind(ip).run()).meta.changes > 0;
