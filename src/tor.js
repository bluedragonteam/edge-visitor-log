/**
 * The Tor Project's public list of Tor exit node IPs.
 * parseTorList is pure; the D1 helpers keep the list in the Worker's database, refreshed by the cron trigger.
 */

export const TOR_LIST_URL = 'https://check.torproject.org/torbulkexitlist';
const INSERT_CHUNK = 100;

/** One IP per line; blank lines and # comments ignored */
export const parseTorList = (text) => new Set(
  String(text || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
);

/**
 * Download the list and replace the tor_exits table. Keeps the old list if the download fails or is empty.
 * @returns {Promise<number>} exits stored, or -1 when the old list was kept
 */
export const refreshTorExits = async (db, { fetchImpl = fetch } = {}) => {
  let exits;
  try {
    const response = await fetchImpl(TOR_LIST_URL, { signal: AbortSignal.timeout(15 * 1000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    exits = [...parseTorList(await response.text())];
  } catch (error) {
    console.warn(`Tor exit list not updated: ${error.message}`);
    return -1;
  }
  if (exits.length === 0) return -1;

  const statements = [db.prepare('DELETE FROM tor_exits')];
  for (let i = 0; i < exits.length; i += INSERT_CHUNK) {
    const chunk = exits.slice(i, i + INSERT_CHUNK);
    statements.push(db.prepare(`INSERT OR IGNORE INTO tor_exits (ip) VALUES ${chunk.map(() => '(?)').join(',')}`).bind(...chunk));
  }
  statements.push(db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('tor_updated_at', ?)").bind(new Date().toISOString()));
  // One batch = one transaction: readers never see an empty list
  await db.batch(statements);
  return exits.length;
};

export const isTorExit = async (db, ip) => !!(await db.prepare('SELECT 1 AS hit FROM tor_exits WHERE ip = ?').bind(ip).first('hit'));

export const torListAge = async (db, now = Date.now()) => {
  const updated = await db.prepare("SELECT value FROM meta WHERE key = 'tor_updated_at'").first('value');
  return updated ? now - new Date(updated).getTime() : Infinity;
};
