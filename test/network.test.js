import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNetwork } from '../src/network.js';
import { parseTorList, refreshTorExits, isTorExit } from '../src/tor.js';
import { runCron } from '../src/index.js';
import { makeEnv } from './helpers.js';

const kind = (network, options) => classifyNetwork(network, options)?.kind ?? null;

test('VPN providers are recognised by ASN or name', () => {
  assert.equal(kind({ org: 'M247 Europe SRL', asn: 9009 }), 'vpn');
  assert.equal(kind({ org: 'Tefincom S.A.', asn: 136787 }), 'vpn');
  assert.equal(kind({ org: 'Mullvad VPN AB', asn: 999999 }), 'vpn');
  assert.equal(classifyNetwork({ org: 'x', asn: 136787 }).provider, 'NordVPN (Tefincom)');
});

test('cloud and hosting networks are data centres; Cloudflare/Akamai/Fastly are relays', () => {
  assert.equal(kind({ org: 'Amazon.com, Inc.', asn: 16509 }), 'hosting');
  assert.equal(kind({ org: 'DIGITALOCEAN-ASN', asn: 14061 }), 'hosting');
  assert.equal(kind({ org: 'Some Hosting Ltd', asn: 1 }), 'hosting');
  assert.equal(kind({ org: 'Cloudflare, Inc.', asn: 13335 }), 'relay');
  assert.equal(kind({ org: 'Akamai Technologies', asn: 36183 }), 'relay');
});

test('home, office and mobile networks are ordinary', () => {
  for (const network of [
    { org: 'Comcast Cable Communications, LLC', asn: 7922 },
    { org: 'Verizon Business', asn: 701 },
    { org: 'T-Mobile USA, Inc.', asn: 21928 },
    { org: 'Google Fiber Inc.', asn: 16591 },
    { org: 'NTT Communications', asn: 4713 },
    {}
  ]) assert.equal(kind(network), null, network.org);
});

test('the Tor list parses and refreshes atomically, keeping the old list on failure', async () => {
  assert.deepEqual([...parseTorList('# exits\n185.220.101.1\n\n171.25.193.25\r\n')], ['185.220.101.1', '171.25.193.25']);
  const env = makeEnv();
  const ips = Array.from({ length: 250 }, (_, i) => `10.0.${Math.floor(i / 250)}.${i}`);
  assert.equal(await refreshTorExits(env.DB, { fetchImpl: async () => new Response(ips.join('\n')) }), 250);
  assert.equal(await isTorExit(env.DB, '10.0.0.42'), true);
  assert.equal(await isTorExit(env.DB, '10.9.9.9'), false);
  assert.equal(await refreshTorExits(env.DB, { fetchImpl: async () => new Response('', { status: 503 }) }), -1);
  assert.equal(await isTorExit(env.DB, '10.0.0.42'), true);
});

test('cron deletes visits past RETENTION_DAYS and skips a fresh Tor list', async () => {
  const env = makeEnv({ RETENTION_DAYS: '30' });
  env.DB.query("INSERT INTO meta (key, value) VALUES ('tor_updated_at', ?)", new Date().toISOString());
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  const recent = new Date().toISOString();
  for (const at of [old, recent]) {
    env.DB.query("INSERT INTO visits (at, visitor_key, ip) VALUES (?, 'k', '1.2.3.4')", at);
  }
  const result = await runCron(env);
  assert.deepEqual(result, { torExits: null, pruned: 1 });
  assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM visits')[0].n, 1);
});
