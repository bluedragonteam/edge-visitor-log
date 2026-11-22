import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { visitFromBeacon } from '../src/beacon.js';
import { CHROME, beaconRequest, makeEnv } from './helpers.js';

test('a page view is stored with what Cloudflare knows about the connection', async () => {
  const env = makeEnv();
  const response = await worker.fetch(beaconRequest(), env);
  assert.equal(response.status, 204);
  const [row] = env.DB.query('SELECT * FROM visits');
  assert.equal(row.ip, '203.0.113.7');
  assert.equal(row.city, 'Austin');
  assert.equal(row.org, 'Comcast Cable Communications, LLC');
  assert.equal(row.asn, 7922);
  assert.equal(row.path, '/pricing');
  assert.equal(row.title, 'Pricing');
  assert.equal(row.referrer, 'https://www.google.com/');
  assert.deepEqual(JSON.parse(row.utm), { source: 'newsletter' });
  assert.equal(row.network_kind, null);
  assert.match(row.visitor_key, /^[0-9a-f]{16}$/);
});

test('VPN, data-centre and Tor visitors are labelled when stored', async () => {
  const env = makeEnv();
  env.DB.query("INSERT INTO tor_exits (ip) VALUES ('185.220.101.1')");
  await worker.fetch(beaconRequest({ ip: '198.51.100.1', cf: { asOrganization: 'M247 Europe SRL', asn: 9009 } }), env);
  await worker.fetch(beaconRequest({ ip: '198.51.100.2', cf: { asOrganization: 'Amazon.com, Inc.', asn: 16509 } }), env);
  await worker.fetch(beaconRequest({ ip: '185.220.101.1', cf: { asOrganization: 'Some Host', asn: 1 } }), env);
  const kinds = Object.fromEntries(env.DB.query('SELECT ip, network_kind FROM visits').map((row) => [row.ip, row.network_kind]));
  assert.deepEqual(kinds, { '198.51.100.1': 'vpn', '198.51.100.2': 'hosting', '185.220.101.1': 'tor' });
});

test('other sites, bots, Do Not Track and junk are ignored without an error', async () => {
  const cases = [
    beaconRequest({ origin: 'https://evil.example' }),
    beaconRequest({ ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }),
    beaconRequest({ ua: 'Mozilla/5.0 HeadlessChrome/120.0' }),
    beaconRequest({ headers: { 'Sec-GPC': '1' } }),
    beaconRequest({ headers: { DNT: '1' } }),
    beaconRequest({ body: 'not json' }),
    beaconRequest({ body: 'x'.repeat(5000) })
  ];
  for (const request of cases) {
    const env = makeEnv();
    assert.equal((await worker.fetch(request, env)).status, 204);
    assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM visits')[0].n, 0);
  }
});

test('RESPECT_DNT=false records Do Not Track browsers', async () => {
  const env = makeEnv({ RESPECT_DNT: 'false' });
  await worker.fetch(beaconRequest({ headers: { DNT: '1' } }), env);
  assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM visits')[0].n, 1);
});

test('a link within the same site is not a referrer', () => {
  const visit = visitFromBeacon({ u: '/about', r: 'https://example.com/#team' }, { ip: '1.2.3.4', origin: 'https://example.com', userAgent: CHROME });
  assert.equal(visit.path, '/about');
  assert.equal(visit.referrer, undefined);
  assert.equal(visit.utm, undefined);
});
