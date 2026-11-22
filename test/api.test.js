import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import BEACON_SCRIPT from '../src/beacon-script.js';
import { apiRequest, beaconRequest, makeEnv } from './helpers.js';

const visit = (env, ip, path, extra = {}) => worker.fetch(beaconRequest({ ip, body: JSON.stringify({ u: path }), ...extra }), env);

test('/api needs the bearer token', async () => {
  const env = makeEnv();
  assert.equal((await worker.fetch(apiRequest('/api/visitors', { token: null }), env)).status, 401);
  assert.equal((await worker.fetch(apiRequest('/api/visitors', { token: 'wrong-token' }), env)).status, 401);
  assert.equal((await worker.fetch(apiRequest('/api/visitors', { token: null }), makeEnv({ API_TOKEN: '' }))).status, 401);
});

test('/api/visitors groups page views per visitor with totals', async () => {
  const env = makeEnv();
  await visit(env, '198.51.100.1', '/');
  await visit(env, '198.51.100.1', '/pricing');
  await visit(env, '198.51.100.2', '/', { cf: { asOrganization: 'M247 Europe SRL', asn: 9009, country: 'NL' } });
  const body = await (await worker.fetch(apiRequest('/api/visitors?days=7'), env)).json();
  assert.equal(body.stats.views, 3);
  assert.equal(body.stats.visitors, 2);
  assert.deepEqual(body.stats.masked, { vpn: 1 });
  assert.deepEqual(body.stats.connections, { datacenter: 1, residential: 1 });
  assert.ok(body.visitors.every((visitor) => visitor.connection === (visitor.network ? 'datacenter' : 'residential')));
  assert.deepEqual(body.stats.topPages[0], { name: '/', count: 2 });
  const comcast = body.visitors.find((v) => v.ip === '198.51.100.1');
  assert.equal(comcast.views, 2);
  assert.equal(comcast.browser, 'Chrome on macOS');
  assert.deepEqual(comcast.pages.map((p) => p.path).sort(), ['/', '/pricing']);
  assert.equal(body.visitors.find((v) => v.ip === '198.51.100.2').network.kind, 'vpn');
});

test('ignored IPs are left out, and "no ip" means the caller\'s own', async () => {
  const env = makeEnv();
  await visit(env, '198.51.100.1', '/');
  await visit(env, '198.51.100.9', '/');
  const added = await worker.fetch(apiRequest('/api/ignored-ips', { method: 'POST', body: { label: 'office' }, ip: '198.51.100.9' }), env);
  assert.deepEqual(await added.json(), { ignored: '198.51.100.9' });
  let body = await (await worker.fetch(apiRequest('/api/visitors'), env)).json();
  assert.deepEqual(body.visitors.map((v) => v.ip), ['198.51.100.1']);
  body = await (await worker.fetch(apiRequest('/api/visitors?includeIgnored=1'), env)).json();
  assert.equal(body.visitors.length, 2);
  const list = await (await worker.fetch(apiRequest('/api/ignored-ips'), env)).json();
  assert.equal(list.ignored[0].label, 'office');
  assert.equal((await worker.fetch(apiRequest('/api/ignored-ips?ip=198.51.100.9', { method: 'DELETE' }), env)).status, 200);
  assert.equal((await worker.fetch(apiRequest('/api/ignored-ips?ip=198.51.100.9', { method: 'DELETE' }), env)).status, 404);
  assert.equal((await worker.fetch(apiRequest('/api/ignored-ips', { method: 'POST', body: { ip: 'nonsense' } }), env)).status, 400);
});

test('/api/visits pages through raw visits by id', async () => {
  const env = makeEnv();
  for (let i = 0; i < 5; i++) await visit(env, `198.51.100.${i}`, `/p${i}`);
  const first = await (await worker.fetch(apiRequest('/api/visits?limit=3'), env)).json();
  assert.deepEqual(first.visits.map((v) => v.path), ['/p0', '/p1', '/p2']);
  assert.equal(first.next, first.visits[2].id);
  const rest = await (await worker.fetch(apiRequest(`/api/visits?after=${first.next}&limit=3`), env)).json();
  assert.deepEqual(rest.visits.map((v) => v.path), ['/p3', '/p4']);
  assert.equal(rest.next, null);
});

test('/visit.js serves the beacon script, identical to client/visit.js', async () => {
  const response = await worker.fetch(new Request('https://visits.example.com/visit.js'), makeEnv());
  assert.match(response.headers.get('Content-Type'), /javascript/);
  const served = await response.text();
  assert.equal(served, readFileSync(new URL('../client/visit.js', import.meta.url), 'utf8'));
  assert.equal(served, BEACON_SCRIPT, 'run npm run sync-script after editing client/visit.js');
});
