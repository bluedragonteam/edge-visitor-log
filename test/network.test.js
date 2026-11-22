import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNetwork, connectionType } from '../src/network.js';
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

test('VPNs on rented servers are caught by the server company: Astrill on Limestone Networks', () => {
  // A real Astrill exit in Tokyo: Cloudflare reports the server company, never "Astrill"
  const astrill = classifyNetwork({ org: 'Limestone Networks, Inc.', asn: 46475, ip: '216.144.245.174' });
  assert.equal(astrill.kind, 'hosting');
  assert.equal(astrill.provider, 'Limestone Networks');
  // Same companies by name only, when the ASN isn't on the list
  for (const org of ['Limestone Networks, Inc.', 'WholeSale Internet, Inc.', 'Interserver, Inc', 'HostPapa', 'B2 Net Solutions Inc.',
    'SAKURA Internet Inc.', 'IDC Frontier Inc.', 'G-Core Labs S.A.', 'Voxility LLP', 'Servers.com, Inc.', 'DediPath', 'Selectel']) {
    assert.equal(kind({ org, asn: 999999 }), 'hosting', org);
  }
  for (const asn of [32097, 19318, 29802, 30633, 59253, 36351, 54290, 55286, 9370, 4694, 7979, 3214]) {
    assert.equal(kind({ org: 'x', asn }), 'hosting', `AS${asn}`);
  }
});

test('home, office and mobile networks are ordinary', () => {
  for (const network of [
    { org: 'Comcast Cable Communications, LLC', asn: 7922 },
    { org: 'Verizon Business', asn: 701 },
    { org: 'T-Mobile USA, Inc.', asn: 21928 },
    { org: 'Google Fiber Inc.', asn: 16591 },
    { org: 'NTT Communications', asn: 4713 },
    { org: 'SoftBank Corp.', asn: 17676 },
    { org: 'KDDI CORPORATION', asn: 2516 },
    { org: 'Sony Network Communications Inc.', asn: 2527 },
    { org: 'Charter Communications Inc', asn: 20115 },
    { org: 'AT&T Services, Inc.', asn: 7018 },
    {}
  ]) assert.equal(kind(network), null, network.org);
});

test('connectionType answers data centre or residential', () => {
  assert.deepEqual(connectionType({ org: 'Comcast Cable Communications, LLC', asn: 7922 }), { type: 'residential', label: 'Residential', network: null });
  const astrill = connectionType({ org: 'Limestone Networks, Inc.', asn: 46475 });
  assert.equal(astrill.type, 'datacenter');
  assert.equal(astrill.label, 'Data centre');
  assert.equal(astrill.network.kind, 'hosting');
  // VPNs, Tor exits and relays are all data-centre IPs
  assert.equal(connectionType({ org: 'M247 Europe SRL', asn: 9009 }).type, 'datacenter');
  assert.equal(connectionType({ org: 'Cloudflare, Inc.', asn: 13335 }).type, 'datacenter');
  assert.equal(connectionType({ ip: '185.220.101.1' }, { isTorExit: () => true }).network.kind, 'tor');
  assert.equal(connectionType().type, 'residential');
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
