import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

// Cloudflare adds timingSafeEqual to crypto.subtle; Node doesn't have it
if (!crypto.subtle.timingSafeEqual) {
  crypto.subtle.timingSafeEqual = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * A minimal D1 binding on in-memory SQLite (node:sqlite) loaded with the real schema.sql,
 * so the Worker's SQL runs for real. Implements prepare().bind().first()/all()/run() and batch().
 */
export class FakeD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(SCHEMA);
  }

  prepare(sql) {
    return new FakeStatement(this.sqlite, sql, []);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  query(sql, ...params) {
    return this.sqlite.prepare(sql).all(...params).map((row) => ({ ...row }));
  }
}

class FakeStatement {
  constructor(sqlite, sql, params) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new FakeStatement(this.sqlite, this.sql, params);
  }

  async first(column) {
    const row = this.sqlite.prepare(this.sql).get(...this.params);
    if (!row) return null;
    return column ? row[column] : { ...row };
  }

  async all() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.params).map((row) => ({ ...row })), meta: {} };
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

export const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export const makeEnv = (overrides = {}) => ({
  DB: new FakeD1(),
  SITE_ORIGINS: 'https://example.com,https://www.example.com',
  RETENTION_DAYS: '365',
  API_TOKEN: 'test-token',
  ...overrides
});

/** A beacon request as Cloudflare would hand it to the Worker (with request.cf) */
export const beaconRequest = ({
  origin = 'https://example.com',
  ua = CHROME,
  ip = '203.0.113.7',
  body = JSON.stringify({ u: '/pricing?utm_source=newsletter', r: 'https://www.google.com/', t: 'Pricing' }),
  cf = { country: 'US', region: 'Texas', city: 'Austin', asOrganization: 'Comcast Cable Communications, LLC', asn: 7922 },
  headers = {}
} = {}) => {
  const request = new Request('https://visits.example.com/v', {
    method: 'POST',
    headers: { Origin: origin, 'User-Agent': ua, 'CF-Connecting-IP': ip, 'Content-Type': 'text/plain', ...headers },
    body
  });
  Object.defineProperty(request, 'cf', { value: cf });
  return request;
};

export const apiRequest = (path, { method = 'GET', token = 'test-token', body, ip } = {}) => new Request(`https://visits.example.com${path}`, {
  method,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(ip ? { 'CF-Connecting-IP': ip } : {})
  },
  body: body ? JSON.stringify(body) : undefined
});
